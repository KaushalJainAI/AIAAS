"""
`decide` — ask a decision model for typed answers with probabilities.

The model the user picked in Settings (`llm/decisions.py::resolve`) answers
closed-set questions about a state: pick one of N options, yes/no, or a
position on a scale. It writes no prose, so it cannot answer outside the
options it was given — what it adds over the calling model's own judgement is
speed, near-zero cost and a probability per option that a threshold can be
set on.

`effect="read"`: it reaches one provider endpoint with text the run already
holds and changes nothing, so it is offered to the chat orchestrator (which
holds only read tools) and is safe in `plan` mode. Agents reach it through the
`decisions` grant. `parallel=True` because two decisions in one batch cannot
depend on each other.
"""
from __future__ import annotations

import json
from typing import Dict

from .registry import tool


@tool({
    'type': 'function',
    'function': {
        'name': 'decide',
        'description': (
            'Ask a fast decision model to classify, route, triage or rate '
            'something. Give it the facts (`state`) and up to 10 typed '
            'questions; it answers each with probabilities, never prose. '
            'Question types: "choice" (pick one of the `options`), "noul" '
            '(yes/no, answered as the probability of yes) and "score" (a '
            'position on `levels`, lowest first). Use it when the answer must '
            'be one of a known set, especially over many items or when you '
            'need a confidence to act on. Low confidence means look closer, '
            'not proceed. Not for open questions or for writing text.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'state': {
                    'type': 'string',
                    'description': (
                        'The facts the decision is about: plain text, or a '
                        'JSON object as text. Include only the fields that matter.'
                    ),
                },
                'questions': {
                    'type': 'array',
                    'description': 'The questions, answered together about the same state.',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'name': {'type': 'string',
                                     'description': 'Short id, e.g. team or is_urgent.'},
                            'type': {'type': 'string', 'enum': ['choice', 'noul', 'score']},
                            'instructions': {'type': 'string',
                                             'description': 'What is being asked.'},
                            'options': {
                                'type': 'array',
                                'description': 'choice only: 2-20 options.',
                                'items': {
                                    'type': 'object',
                                    'properties': {
                                        'name': {'type': 'string'},
                                        'description': {'type': 'string',
                                                        'description': 'When this option is right.'},
                                    },
                                    'required': ['name'],
                                },
                            },
                            'levels': {
                                'type': 'array',
                                'description': 'score only: 2-10 level descriptions, lowest first.',
                                'items': {'type': 'string'},
                            },
                            'yes': {'type': 'string', 'description': 'noul only: what counts as yes.'},
                            'no': {'type': 'string', 'description': 'noul only: what counts as no.'},
                        },
                        'required': ['name', 'type'],
                    },
                },
            },
            'required': ['state', 'questions'],
        },
    },
}, effect='read', parallel=True)
async def decide(args: Dict, context: Dict) -> str:
    from llm.decisions import DecisionError, decide as _decide, summarise

    user_id = context.get('user_id')
    if not user_id:
        return json.dumps({'error': 'Decisions need a signed-in user.'})
    try:
        # No `user=` from the context: a User object there may not have its
        # profile loaded, and reading it here would hit the ORM from async.
        # `decide` loads it with `select_related` on a worker thread.
        decision = await _decide(user_id, args.get('state'), args.get('questions'))
    except DecisionError as exc:
        return json.dumps({'error': str(exc)})
    payload = decision.to_dict()
    lines = summarise(decision)
    payload['rendered'] = '; '.join(lines) if lines else 'No answers.'
    return json.dumps(payload)
