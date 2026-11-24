"""
Local Ollama inference, plus the skill/attachment helpers shared with the
OpenAI-protocol providers.

Ollama is the one supported provider that does not speak the OpenAI
chat-completions protocol — it posts to `/api/chat` and streams bare JSON
objects rather than SSE `choices[].delta` frames — so it keeps its own
wire format here while `openai_compatible.py` serves the other three. The
connection is the shared client (`workflow_backend.httpclient`), like every
other provider's, which is also the seam `llm/recorded.py` replays through.
The tests in `llm/tests/test_recorded_providers.py` pin the format.
"""
import json
import logging
import httpx
from typing import Any, TYPE_CHECKING

from .base import (
    BaseNodeHandler,
    NodeExecutionResult,
    build_json_schema_from_fields,
    format_schema_for_prompt,
)
from workflow_backend.httpclient import shared_client

from .openai_compatible import validate_attachment_path
from .llm_base import ReasoningSplitter

logger = logging.getLogger(__name__)

#: A local model can take minutes to load before its first token, so the read
#: timeout is long; a server that is not there still fails fast on connect.
OLLAMA_TIMEOUT = httpx.Timeout(300.0, connect=10.0)


def _ollama_tools(config: dict[str, Any]) -> list:
    """The tools to send. Ollama has no `tool_choice`, so "none" means send none.

    Tools come from the caller, never from a lookup here (see
    `OpenAICompatibleLLMNode._tools_for`).
    """
    if config.get("tool_choice") == "none":
        return []
    return list(config.get("tools") or [])


def ollama_usage(done_chunk: dict[str, Any]) -> dict[str, int]:
    """Token counts from Ollama's final chunk, in the OpenAI spelling the funnel reads.

    `prompt_eval_count` is the prompt, `eval_count` the reply. The durations
    beside them are nanoseconds, not tokens; they used to be sent as `usage`,
    so every Ollama call counted zero tokens.
    """
    prompt = int(done_chunk.get("prompt_eval_count") or 0)
    output = int(done_chunk.get("eval_count") or 0)
    return {"prompt_tokens": prompt, "completion_tokens": output,
            "total_tokens": prompt + output}



#: Attachment path validation is shared with the OpenAI-protocol handlers so a
#: fix to the traversal check reaches every provider at once.
_validate_attachment_path = validate_attachment_path

def format_skills_as_context(skills: list[dict]) -> str:
    """Format skill list into a context block for LLM prompts."""
    if not skills:
        return ""
    
    parts = ["\n[CONTEXT / SKILLS]"]
    for s in skills:
        parts.append(f"### {s['title']}\n{s['content']}")
    parts.append("[END CONTEXT]\n")
    return "\n".join(parts)


# Detect if a model is specifically for image generation.
def is_image_generation_model(model: str) -> bool:
    image_keywords = ['dall-e', 'midjourney', 'stable-diffusion', 'flux', 'imagen', 'recraft', 'leonardo', 'stable-image']
    return any(keyword in model.lower() for keyword in image_keywords)

# Detect if a model is specifically for video generation.
def is_video_generation_model(model: str) -> bool:
    video_keywords = [
        'veo', 'sora', 'kling', 'luma', 'dream-machine', 'runway', 
        'gen-3', 'gen-2', 'pika', 'haiper', 'mochi', 'cogvideo', 'ltx'
    ]
    return any(keyword in model.lower() for keyword in video_keywords)


async def resolve_node_skills(config: dict[str, Any]) -> list[dict]:
    """
    Resolve this call's skill IDs from config into `{title, content}` dicts.

    Deduplicates by title and skips ids that no longer resolve, so a deleted
    skill degrades to a warning rather than a failed call.

    This used to also merge `context.skills`, which was `[]` on every call ever
    made — the field was only ever populated by the DAG runtime. That is why
    `context` is no longer a parameter.
    """
    skill_ids = config.get('skills', [])
    if not skill_ids or not isinstance(skill_ids, list):
        return []

    valid_ids = []
    for sid in skill_ids:
        try:
            valid_ids.append(int(sid))
        except (ValueError, TypeError):
            logger.warning(f"Invalid skill ID: {sid}")
    if not valid_ids:
        return []

    skills: list[dict] = []
    seen_titles: set[str] = set()
    found_ids: set[int] = set()
    try:
        from skills.models import Skill
        async for skill in Skill.objects.filter(id__in=valid_ids):
            found_ids.add(skill.id)
            if skill.title not in seen_titles:
                skills.append({'title': skill.title, 'content': skill.content})
                seen_titles.add(skill.title)
    except Exception as e:
        logger.error(f"Failed to resolve skills: {e}")
        return skills

    if missing := set(valid_ids) - found_ids:
        logger.warning(f"Skills not found (may have been deleted): {missing}")
    return skills


if TYPE_CHECKING:
    from llm.context import ExecutionContext



def ollama_think(effort: Any) -> dict[str, Any]:
    """Ollama's spelling of the effort knob, as fields to merge into the body.

    Ollama takes `think` at the top level rather than inside `options`, and it
    accepts both a boolean and — on the models that serve graded reasoning — a
    level string. So `none` is expressible here exactly as it is on OpenRouter,
    which is why neither needs the base class's degrade-to-`minimal` fallback.

    `minimal` has no Ollama equivalent and becomes `low`: the local models that
    take a level serve the same three rungs the hosted ones do, and the level
    has already been snapped to something this model's catalogue row declared.
    """
    from llm import effort as effort_levels

    level = effort_levels.normalize(effort)
    if level is None:
        return {}
    if level == "none":
        return {"think": False}
    return {"think": "low" if level == "minimal" else level}


def _build_ollama_messages(config: dict[str, Any], prompt: str,
                           skills: list[dict]) -> list[dict[str, Any]]:
    """The chat `messages` array for an Ollama request.

    Shared by `execute` and `stream_execute`. It used to be inlined in both,
    ~90 near-identical lines each, and the two copies had already drifted: one
    logged a skipped non-image attachment and the other dropped it silently,
    and they caught different exception sets around the same `open()`. A
    request built two ways is a request that can be right one way.

    Attachments are best-effort by design — one unreadable file must not fail
    a whole request — but never silent, because a dropped attachment looks to
    the user exactly like a model that ignored what they sent.
    """
    import base64

    messages: list[dict[str, Any]] = []

    system_message = config.get("system_message", "")
    if system_message or skills:
        messages.append({
            "role": "system",
            "content": f"{system_message}{format_skills_as_context(skills)}",
        })

    history = config.get("history", [])
    if history:
        messages.extend(_ollama_history_entry(entry) for entry in history)

    images: list[str] = []
    for att in config.get("attachments", []) or []:
        try:
            # Ollama's multimodal models take images only.
            if att.file_type != 'image':
                logger.info("Skipping unsupported attachment type %s for Ollama",
                            att.file_type)
                continue
            file_path = att.file.path if hasattr(att.file, 'path') else att.file.name
            if not _validate_attachment_path(file_path):
                logger.warning("Blocked path traversal in Ollama attachment")
                continue
            with open(file_path, "rb") as handle:
                images.append(base64.b64encode(handle.read()).decode('utf-8'))
        except Exception as exc:  # noqa: BLE001 - one bad file is not a failed request
            logger.warning("Skipping unreadable Ollama attachment: %s", exc)

    # Ollama's /api/chat takes `content` as a string and images beside it in
    # `images` (base64, no data: prefix). This used to send OpenAI-style
    # content parts, which is the shape of Ollama's /v1 compatibility route,
    # not of this one.
    question: dict[str, Any] = {"role": "user", "content": prompt}
    if images:
        question["images"] = images
    messages.append(question)
    return messages


def _ollama_history_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """One transcript entry in Ollama's spelling.

    The agent keeps its transcript in the OpenAI shape, where a tool call's
    `arguments` is a JSON *string*. Ollama's /api/chat takes it as an object,
    so a run's second pass, which replays the first pass's call, has to be
    translated. Anything else passes through unchanged.
    """
    calls = entry.get("tool_calls")
    if entry.get("role") != "assistant" or not calls:
        return entry
    translated = []
    for call in calls:
        function = dict(call.get("function") or {})
        arguments = function.get("arguments")
        if isinstance(arguments, str):
            try:
                function["arguments"] = json.loads(arguments) if arguments.strip() else {}
            except ValueError:
                function["arguments"] = {}
        translated.append({**call, "function": function})
    return {**entry, "tool_calls": translated}


class OllamaNode(BaseNodeHandler):
    """
    Call local Ollama instance for inference.
    
    No API key required - runs on localhost.
    """
    
    node_type = "ollama"

    async def stream_execute(
        self,
        input_data: dict[str, Any],
        config: dict[str, Any],
        context: 'ExecutionContext'
    ):
        model = config.get("model", "llama3.2")
        prompt = config.get("prompt", "")
        base_url = config.get("base_url", "http://localhost:11434")
        temperature = config.get("temperature", 0.7)
        show_thinking = config.get("thinking", False)

        effective_prompt = prompt
        is_native_reasoner = any(m in model.lower() for m in ["r1", "reasoning", "thought"])
        if show_thinking and not is_native_reasoner:
            effective_prompt += "\n\nIMPORTANT: Respond ONLY in JSON format with fields 'thinking' (your reasoning) and 'content' (your actual answer)."

        try:
            all_skills = await resolve_node_skills(config)
            messages = _build_ollama_messages(config, effective_prompt, all_skills)

            req_payload = {
                "model": model,
                "messages": messages,
                "stream": True,
                "options": {"temperature": temperature},
                **ollama_think(config.get("effort")),
            }
            # Agent turns stream, so the tools go here as well as on the
            # non-streamed path. They used to be sent only there, which meant
            # an Ollama agent never saw a tool it could call.
            if tools_payload := _ollama_tools(config):
                req_payload["tools"] = tools_payload

            splitter = ReasoningSplitter()
            calls_seen = 0
            # The shared client, like every other provider: one connection
            # pool, and the one seam tests replay recordings through.
            async with shared_client().stream(
                "POST",
                f"{base_url.rstrip('/')}/api/chat",
                json=req_payload,
                timeout=OLLAMA_TIMEOUT,
            ) as response:
                if response.status_code != 200:
                    body = (await response.aread()).decode("utf-8", "replace")
                    yield {"type": "error", "status": response.status_code,
                           "message": f"Ollama error: {response.status_code} {body[:300]}".strip()}
                    return

                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except ValueError:
                        continue
                    if chunk.get("error"):
                        yield {"type": "error", "message": f"Ollama error: {chunk['error']}"}
                        return
                    msg = chunk.get("message") or {}

                    # Ollama sends reasoning in `thinking` (older builds and
                    # some proxies: `reasoning_content`), in chunks whose
                    # content is empty, so it is read before the content check.
                    thought = msg.get("thinking") or msg.get("reasoning_content")
                    if thought:
                        yield {"type": "thinking", "content": thought}

                    if text := msg.get("content"):
                        for kind, chunk_text in splitter.feed(text):
                            yield {"type": kind, "content": chunk_text}

                    # Ollama sends each call whole: no id, arguments as an
                    # object. Shaped as the accumulator's indexed deltas.
                    deltas = []
                    for raw in msg.get("tool_calls") or []:
                        function = raw.get("function") or {}
                        if not function.get("name"):
                            continue
                        arguments = function.get("arguments")
                        deltas.append({
                            "index": calls_seen,
                            "id": raw.get("id") or f"call_{calls_seen}",
                            "function": {
                                "name": function["name"],
                                "arguments": arguments if isinstance(arguments, str)
                                else json.dumps(arguments or {}),
                            },
                        })
                        calls_seen += 1
                    if deltas:
                        yield {"type": "tool_calls", "tool_calls": deltas}

                    if chunk.get("done"):
                        yield {"type": "metadata", "usage": ollama_usage(chunk)}

                for kind, chunk_text in splitter.flush():
                    yield {"type": kind, "content": chunk_text}

        except httpx.ConnectError:
            yield {"type": "error",
                   "message": f"Cannot connect to Ollama at {base_url}. Is Ollama running?"}
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    name = "Ollama (Local)"
    description = "Generate text using local Ollama models"

    async def execute(
        self,
        input_data: dict[str, Any],
        config: dict[str, Any],
        context: 'ExecutionContext'
    ) -> NodeExecutionResult:
        model = config.get("model", "llama3.2")
        prompt = config.get("prompt", "")
        system_message = config.get("system_message", "")
        base_url = config.get("base_url", "http://localhost:11434")
        temperature = config.get("temperature", 0.7)
        show_thinking = config.get("thinking", False)
        
        # Structured output: build JSON schema from user-defined custom field defs
        custom_field_defs = config.get("customFieldDefs", [])
        output_schema = build_json_schema_from_fields(custom_field_defs)
        
        # Determine if we should use JSON mode
        response_format = config.get("response_format", "text")

        # Heuristic for native reasoning models in Ollama (e.g. DeepSeek R1)
        is_native_reasoner = any(m in model.lower() for m in ["r1", "reasoning", "thought"])
        force_json = (show_thinking and not is_native_reasoner) or (response_format == "json_object")

        effective_prompt = prompt
        if output_schema:
            effective_prompt += format_schema_for_prompt(output_schema)
        elif force_json:
            json_hint = "\n\nIMPORTANT: Respond ONLY in JSON format with fields 'thinking' (your reasoning) and 'content' (your actual answer)."
            effective_prompt += json_hint
        
        if not prompt:
            return NodeExecutionResult(
                success=False,
                error="Prompt is required",
            )
        
        try:
            # Resolve per-node + workflow-level skills
            all_skills = await resolve_node_skills(config)

            client = shared_client()
            messages = _build_ollama_messages(config, effective_prompt, all_skills)

            req_payload = {
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {
                    "temperature": temperature,
                },
                **ollama_think(config.get("effort")),
                # Use Ollama's native JSON format for structured output
                **({
                    "format": "json"
                } if output_schema or response_format == "json_object" else {}),
            }

            if tools_payload := _ollama_tools(config):
                req_payload["tools"] = tools_payload

            response = await client.post(
                f"{base_url.rstrip('/')}/api/chat",
                json=req_payload,
                timeout=OLLAMA_TIMEOUT,
            )

            if response.status_code != 200:
                return NodeExecutionResult(
                    success=False,
                    error=f"Ollama error: {response.text}",
                    status_code=response.status_code,
                )

            data = response.json()
            msg = data.get("message", {})
            content = msg.get("content", "")
            tool_calls = msg.get("tool_calls")

            # Capture thinking if enabled
            captured_thinking = None

            # If we forced JSON, parse it
            if force_json:
                try:
                    parsed = json.loads(content.strip().strip("```json").strip("```"))
                    captured_thinking = parsed.get("thinking")
                    content = parsed.get("content", content)
                except (ValueError, AttributeError, TypeError):
                    pass # Fallback

            if show_thinking and not captured_thinking:
                import re
                # Many local models (DeepSeek-R1, etc.) use <think> tags
                match = re.search(r"<think>(.*?)</think>", content, re.DOTALL)
                if match:
                    captured_thinking = match.group(1).strip()

            # Reasoning Ollama returned in its own field (`thinking`; older
            # builds and some proxies: `reasoning_content`). It is never part
            # of the answer, so it is kept whether or not thinking was asked for.
            if not captured_thinking:
                captured_thinking = msg.get("thinking") or msg.get("reasoning_content")

            result_data = {
                "content": content,
                "model": model,
                "total_duration": data.get("total_duration", 0),
                "eval_count": data.get("eval_count", 0),
                "usage": ollama_usage(data),
                "input": input_data,
            }

            if tool_calls:
                result_data["tool_calls"] = tool_calls

            # Parse structured output and spread fields into result
            if output_schema and content:
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, dict):
                        result_data.update(parsed)
                except Exception:
                    logger.warning("Ollama: Failed to parse structured output as JSON")

            if captured_thinking:
                result_data["thinking"] = captured_thinking

            return NodeExecutionResult(
                success=True,
                data=result_data,
            )

        except httpx.ConnectError:
            return NodeExecutionResult(
                success=False,
                error=f"Cannot connect to Ollama at {base_url}. Is Ollama running?",
            )
        except httpx.TimeoutException:
            return NodeExecutionResult(
                success=False,
                error="Ollama request timed out (model may be loading)",
            )
        except Exception as e:
            return NodeExecutionResult(
                success=False,
                error=f"Ollama error: {str(e)}",
            )

