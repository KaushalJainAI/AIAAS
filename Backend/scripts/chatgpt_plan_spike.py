"""
Phase 0 of docs/CHATGPT_PLAN_PROVIDER_PLAN.md: does ChatGPT plan usage work
for this app at all, and exactly how?

Run it on your own machine, with your own ChatGPT account:

    python scripts/chatgpt_plan_spike.py              # callback on port 1455
    python scripts/chatgpt_plan_spike.py --port 8000  # what the app will use

It opens the ChatGPT consent page, waits for the redirect on a loopback
listener, and then asks the questions the docs did not answer:

  1. Can an unregistered app sign in (`dynamic_agent_client`)?
  2. Which model does the account list, and what does an entry look like?
  3. Does a plain streamed answer work?
  4. Are function tools accepted?            (agents need this)
  5. Is an image accepted?
  6. Is `reasoning.effort` accepted?
  7. Is the `developer` role accepted?

It prints PASS / FAIL per question and writes the raw answers to
`scripts/chatgpt_spike_out/` (git-ignored) so the handler's tests can replay
real streams. **Tokens are never printed or written**; the access token lives
in this process's memory and the refresh token is revoked at the end.

No Django, no database: this file stands alone on purpose, so a failure here
is about OpenAI's side and never about ours. It uses the same endpoints and
parameters as `credentials/chatgpt.py` — if you change one, change the other.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import pathlib
import secrets
import sys
import threading
import urllib.parse
import uuid
import webbrowser

import requests

ISSUER = 'https://auth.openai.com'
AUTHORIZE_URL = f'{ISSUER}/api/accounts/authorize'
TOKEN_URL = f'{ISSUER}/api/accounts/oauth/token'
DISCOVERY_URL = f'{ISSUER}/.well-known/openid-configuration'
RESOURCE = 'https://api.openai.com/v1'
SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
DYNAMIC_CLIENT = 'dynamic_agent_client'

OUT = pathlib.Path(__file__).resolve().parent / 'chatgpt_spike_out'

# A 1x1 red PNG.
PIXEL = ('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4'
         '2mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==')

TOOL = {
    'type': 'function', 'name': 'get_weather',
    'description': 'Get the weather for a city.',
    'parameters': {'type': 'object', 'properties': {'city': {'type': 'string'}},
                   'required': ['city']},
}

results: list[tuple[str, bool, str]] = []


def report(question: str, ok: bool, detail: str = '') -> None:
    results.append((question, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {question}{' — ' + detail if detail else ''}")


def save(name: str, payload) -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(json.dumps(payload, indent=2), encoding='utf-8')


def wait_for_callback(port: int) -> dict:
    """Serve one request on 127.0.0.1:<port>/auth/callback; return its query."""
    received: dict = {}
    done = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 — the stdlib's name
            parsed = urllib.parse.urlsplit(self.path)
            if parsed.path != '/auth/callback':
                self.send_response(404)
                self.end_headers()
                return
            received.update({k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()})
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'<p>Done. You can close this window and go back to the terminal.</p>')
            done.set()

        def log_message(self, *args):  # keep the code out of the terminal
            pass

    server = http.server.HTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    if not done.wait(timeout=600):
        server.shutdown()
        sys.exit('No callback arrived within 10 minutes.')
    server.shutdown()
    return received


def sign_in(port: int, agent_name: str) -> tuple[str, str, str]:
    """Returns (access_token, refresh_token, client_id). Exits on refusal."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    redirect_uri = f'http://127.0.0.1:{port}/auth/callback'
    host_id = str(uuid.uuid4())

    url = AUTHORIZE_URL + '?' + urllib.parse.urlencode({
        'response_type': 'code', 'client_id': DYNAMIC_CLIENT, 'scope': SCOPE,
        'resource': RESOURCE, 'redirect_uri': redirect_uri,
        'code_challenge': challenge, 'code_challenge_method': 'S256',
        'state': state, 'nonce': nonce,
        'agent_name_hint': agent_name, 'ext_agent_host_id': host_id,
    })
    print(f'\nOpening the ChatGPT consent page. If no browser opens, visit:\n\n{url}\n')
    print(f'(ext_agent_host_id used: a random UUID — {host_id})')
    webbrowser.open(url)
    query = wait_for_callback(port)

    if query.get('error') or not query.get('code'):
        report('1. Sign-in with dynamic_agent_client', False,
               f"callback said: {query.get('error') or 'no code'} "
               f"{query.get('error_description', '')}".strip())
        finish()
    if query.get('state') != state:
        sys.exit('The callback carried a different state. Stopping.')

    client_id = query.get('client_id') or ''
    save('callback_keys.json', sorted(query))   # names only, never the code
    response = requests.post(TOKEN_URL, data={
        'grant_type': 'authorization_code', 'client_id': client_id or DYNAMIC_CLIENT,
        'code': query['code'], 'code_verifier': verifier,
        'redirect_uri': redirect_uri, 'resource': RESOURCE,
    }, timeout=30)
    try:
        tokens = response.json()
    except ValueError:
        tokens = {}
    if response.status_code != 200 or not tokens.get('access_token'):
        report('1. Sign-in with dynamic_agent_client', False,
               f'token exchange answered HTTP {response.status_code}: '
               f"{tokens.get('error', response.text[:200])}")
        finish()

    save('token_response_keys.json', sorted(tokens))
    report('1. Sign-in with dynamic_agent_client', True,
           f"port {port} accepted; callback {'returned' if client_id else 'did NOT return'} "
           f"a client_id; expires_in={tokens.get('expires_in')}")
    return tokens['access_token'], tokens.get('refresh_token', ''), client_id


def responses(token: str, body: dict, name: str) -> tuple[int, list[dict], str]:
    """One streamed call. Returns (status, events, error text)."""
    with requests.post(
        f'{RESOURCE}/responses',
        headers={'Authorization': f'Bearer {token}', 'Accept': 'text/event-stream'},
        json={'store': False, 'stream': True, **body}, stream=True, timeout=120,
    ) as response:
        if response.status_code != 200:
            text = response.text[:600]
            save(f'{name}.error.json', {'status': response.status_code, 'body': text})
            return response.status_code, [], text
        events = []
        for line in response.iter_lines(decode_unicode=True):
            if line and line.startswith('data:'):
                payload = line[5:].strip()
                if payload and payload != '[DONE]':
                    try:
                        events.append(json.loads(payload))
                    except ValueError:
                        pass
    save(f'{name}.events.json', events)
    return 200, events, ''


def text_of(events: list[dict]) -> str:
    return ''.join(e.get('delta', '') for e in events
                   if e.get('type') == 'response.output_text.delta')


def completed(events: list[dict]) -> bool:
    return any(e.get('type') == 'response.completed' for e in events)


def failure(events: list[dict]) -> str:
    for event in events:
        if event.get('type') in ('response.failed', 'error'):
            error = (event.get('response') or {}).get('error') or event.get('error') or {}
            return f"{error.get('code', '')} {error.get('message', '')}".strip()
    return ''


def user(text: str) -> dict:
    return {'role': 'user', 'content': [{'type': 'input_text', 'text': text}]}


def ask(token: str, number: str, question: str, body: dict, name: str, check) -> None:
    status, events, error = responses(token, body, name)
    if status != 200:
        report(f'{number}. {question}', False, f'HTTP {status}: {error[:160]}')
        return
    if problem := failure(events):
        report(f'{number}. {question}', False, problem[:160])
        return
    ok, detail = check(events)
    report(f'{number}. {question}', ok and completed(events), detail)


def finish() -> None:
    print('\nSummary')
    for question, ok, detail in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {question}")
    if OUT.exists():
        print(f'\nRaw answers (no tokens) are in {OUT}')
    print('Copy the PASS/FAIL lines into §10 of docs/CHATGPT_PLAN_PROVIDER_PLAN.md.')
    sys.exit(0 if results and all(ok for _, ok, _ in results) else 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--port', type=int, default=1455,
                        help='loopback port for the callback (default 1455)')
    parser.add_argument('--agent-name', default='AIAAS')
    parser.add_argument('--model', default='', help='model slug to test; default: first listed')
    args = parser.parse_args()

    token, refresh_token, client_id = sign_in(args.port, args.agent_name)

    try:
        listing = requests.get(f'{RESOURCE}/models',
                               headers={'Authorization': f'Bearer {token}'}, timeout=30)
        payload = listing.json() if listing.status_code == 200 else {}
        entries = payload.get('data') or payload.get('models') or [] if isinstance(payload, dict) else payload
        save('models.json', payload)
        slugs = [e.get('slug') or e.get('id') for e in entries if isinstance(e, dict)]
        report('2. The account lists models', bool(slugs),
               f"{len(slugs)} listed; fields on an entry: "
               f"{sorted(entries[0]) if entries and isinstance(entries[0], dict) else 'none'}")
        model = args.model or next(
            (e.get('slug') or e.get('id') for e in entries
             if isinstance(e, dict) and e.get('visibility', 'list') == 'list'), '')
        if not model:
            print('  No model to test with. Pass --model <slug>.')
            finish()
        print(f'  Testing with model: {model}')

        ask(token, '3', 'A plain streamed answer',
            {'model': model, 'instructions': 'Answer in one word.',
             'input': [user('Say hello.')]},
            'plain', lambda ev: (bool(text_of(ev)), f'answered {text_of(ev)[:40]!r}'))

        def called(events):
            names = [e['item'].get('name') for e in events
                     if e.get('type') == 'response.output_item.done'
                     and (e.get('item') or {}).get('type') == 'function_call']
            return bool(names), f'called {names}' if names else 'no function_call item came back'
        ask(token, '4', 'Function tools are accepted',
            {'model': model, 'instructions': 'Use the tool to answer.',
             'input': [user('What is the weather in Pune?')], 'tools': [TOOL]},
            'tool', called)

        ask(token, '5', 'An image is accepted',
            {'model': model, 'instructions': 'Answer in one word.',
             'input': [{'role': 'user', 'content': [
                 {'type': 'input_text', 'text': 'What colour is this image?'},
                 {'type': 'input_image', 'image_url': PIXEL}]}]},
            'image', lambda ev: (bool(text_of(ev)), f'answered {text_of(ev)[:40]!r}'))

        ask(token, '6', 'reasoning.effort is accepted',
            {'model': model, 'instructions': 'Answer in one word.',
             'input': [user('2+2?')], 'reasoning': {'effort': 'low', 'summary': 'auto'}},
            'effort', lambda ev: (bool(text_of(ev)), ''))

        ask(token, '7', 'The developer role is accepted',
            {'model': model, 'instructions': 'Follow developer notes.',
             'input': [{'role': 'developer', 'content': [
                 {'type': 'input_text', 'text': 'Reply with exactly: OK'}]}, user('Go.')]},
            'developer', lambda ev: (bool(text_of(ev)), f'answered {text_of(ev)[:40]!r}'))
    finally:
        # Leave nothing behind: this was a test, not a sign-in to keep.
        try:
            endpoint = requests.get(DISCOVERY_URL, timeout=15).json().get('revocation_endpoint')
            if endpoint and refresh_token:
                requests.post(endpoint, data={
                    'token': refresh_token, 'token_type_hint': 'refresh_token',
                    'client_id': client_id or DYNAMIC_CLIENT}, timeout=15)
                print('  (test sign-in revoked)')
        except Exception:  # noqa: BLE001
            print('  (could not revoke the test sign-in; remove it in ChatGPT settings)')
    finish()


if __name__ == '__main__':
    main()
