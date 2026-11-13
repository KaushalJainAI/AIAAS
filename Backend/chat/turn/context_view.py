"""
What the assistant sees in this conversation, as the user may inspect it.

`GET /api/chat/sessions/<id>/context/` answers "what goes to the model on the
next turn, and how much of it is reused from the provider's cache". It is
built from the **same functions the turn uses** — `prompts.build_system_message`,
`history.load_history_sync` + `to_wire_history`, `session_notes.for_prompt_sync`
— never from a second description of them, because a context view that drifts
from the real context is worse than none: it is believed.

What it cannot know until a turn runs is said, not guessed: the per-turn
update (clock, mode) and the tool list depend on the turn, so tools are an
estimate labelled as one, and attachments are counted as the history renders
them for a text-only model.

Read-only and owner-only; nothing here writes or calls a model.
"""
from __future__ import annotations

import json
from typing import Any

from llm.access import estimate_tokens
from workflow_backend.thresholds import MAX_CONTEXT_TOKENS

PREVIEW_CHARS = 160


def _tokens(text: str) -> int:
    return estimate_tokens(text or '')


def _rate(read: int, total: int) -> float | None:
    return round(read / total, 4) if total > 0 else None


def cache_stats(session) -> dict:
    """Prompt-cache reuse for the last turn and the whole conversation.

    `input_tokens` is the *uncached* part of a prompt (`llm/usage.py`), so a
    prompt's size is input + cached read + cached write, and the hit rate is
    the cached read over that. Only assistant rows carry usage.
    """
    from chat.models import ChatMessage

    rows = list(ChatMessage.objects
                .filter(session=session, role='assistant')
                .order_by('created_at', 'id')
                .values('id', 'input_tokens', 'cached_read_tokens',
                        'cached_write_tokens', 'output_tokens'))

    def summarise(items: list[dict]) -> dict:
        uncached = sum(r['input_tokens'] for r in items)
        read = sum(r['cached_read_tokens'] for r in items)
        write = sum(r['cached_write_tokens'] for r in items)
        prompt = uncached + read + write
        return {
            'turns': len(items), 'prompt_tokens': prompt, 'uncached_tokens': uncached,
            'cached_read_tokens': read, 'cached_write_tokens': write,
            'output_tokens': sum(r['output_tokens'] for r in items),
            'hit_rate': _rate(read, prompt),
        }

    priced = [r for r in rows if r['input_tokens'] or r['cached_read_tokens']
              or r['cached_write_tokens']]
    return {
        'last_turn': summarise(priced[-1:]) if priced else None,
        'conversation': summarise(priced),
        # The last ten turns' rates, oldest first, for a small trend line.
        'recent': [
            {'message_id': r['id'], 'hit_rate': _rate(
                r['cached_read_tokens'],
                r['input_tokens'] + r['cached_read_tokens'] + r['cached_write_tokens'])}
            for r in priced[-10:]
        ],
    }


def _plan(session) -> dict | None:
    """The newest plan (`update_todos`) any reply in this conversation left."""
    from chat.models import ChatMessage

    for metadata in (ChatMessage.objects
                     .filter(session=session, role='assistant')
                     .order_by('-created_at', '-id')
                     .values_list('metadata', flat=True)[:30]):
        todos = (metadata or {}).get('todos')
        if todos:
            history = (metadata or {}).get('todo_history') or []
            return {'todos': todos, 'revisions': len(history),
                    'worker_plans': (metadata or {}).get('worker_plans') or {}}
    return None


def _user_memory(user) -> str:
    """The same block `pipeline._user_memory_block` puts in the prompt."""
    from core.memory import for_prompt
    from core.preferences import about_user, for_user

    try:
        about = about_user(for_user(user.id))
    except Exception:  # noqa: BLE001
        about = ''
    try:
        memory = for_prompt(user.id)
    except Exception:  # noqa: BLE001
        memory = ''
    return '\n\n'.join(block for block in (about, memory) if block)


def _tool_estimate() -> dict:
    """What the tool list costs, roughly: chat's own tools, by schema size.

    Labelled an estimate because the real list depends on the turn — the
    mode, the connections switched on, what the session has archived.
    """
    try:
        from chat.tools import chat_orchestrator_allowed, schemas

        offered = [s for s in schemas() if chat_orchestrator_allowed(s['function']['name'])]
    except Exception:  # noqa: BLE001
        return {'count': 0, 'tokens': 0, 'estimate': True}
    return {'count': len(offered), 'tokens': _tokens(json.dumps(offered)), 'estimate': True}


def _context_window(model: str) -> int:
    from llm.models import AIModel

    if not model:
        return 0
    return AIModel.objects.filter(value=model).values_list(
        'context_window', flat=True).first() or 0


def describe(session) -> dict[str, Any]:
    """Everything the next turn would send, part by part, with token counts."""
    from chat.models import ChatMessage
    from chat.turn import history, prompts, session_notes

    memory_block = _user_memory(session.user)
    system = prompts.build_system_message(session, user_memory=memory_block)

    notes_text = ''
    past: list = []
    wire: list = []
    if session.memory_enabled:
        notes_text = session_notes.for_prompt_sync(session)
        past = history.load_history_sync(session, exclude_id=None)
        wire = history.to_wire_history(past, max_tokens=MAX_CONTEXT_TOKENS - 4_000)

    state = session_notes.clean_state(session.notes_state)
    focus = session_notes.focus(session.notes_state)
    replayed = []
    # `to_wire_history` keeps the newest that fit; map them back to rows.
    conversational = [m for m in past if m.role in ('user', 'assistant')]
    for message in conversational[len(conversational) - len(wire):]:
        summary = (message.metadata or {}).get('summary')
        shown = summary if (message.role == 'assistant' and summary) else message.content
        replayed.append({
            'id': message.id, 'role': message.role,
            'preview': (message.content or '')[:PREVIEW_CHARS],
            'tokens': _tokens(shown), 'summarised': bool(message.role == 'assistant' and summary),
        })
    total_messages = ChatMessage.objects.filter(
        session=session, role__in=('user', 'assistant')).count()

    tools = _tool_estimate()
    parts = {
        'system': _tokens(system),
        'notes': _tokens(notes_text),
        'history': sum(r['tokens'] for r in replayed),
        'tools': tools['tokens'],
    }
    window = _context_window(session.llm_model)

    return {
        'model': session.llm_model, 'provider': session.llm_provider,
        'memory_enabled': session.memory_enabled,
        'context_window': window,
        'tokens': {**parts, 'total': sum(parts.values())},
        'system_prompt': {
            'session_prompt': session.system_prompt or '',
            'user_memory': memory_block,
            'full': system,
            'tokens': parts['system'],
        },
        'notes': {
            'text': notes_text,
            'document_id': session.notes_document_id,
            'tasks': state['tasks'],
            'current': state['current'],
            'through': state['through'],
            'tokens': parts['notes'],
        },
        'history': {
            'mode': 'off' if not session.memory_enabled else (
                'task' if focus is not None else 'window'),
            'messages': replayed,
            'replayed': len(replayed),
            'total_messages': total_messages,
            'not_shown': max(0, total_messages - len(replayed)),
            'tokens': parts['history'],
        },
        'plan': _plan(session),
        'tools': tools,
        'cache': cache_stats(session),
        'not_included': [
            'The per-turn update (date and time, the approval mode) — a few dozen tokens.',
            'Attachments and file contents read during a turn.',
            'Tool results within a turn; earlier turns keep only their answers.',
        ],
    }
