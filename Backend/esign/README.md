# `esign/`: documents out for signature

The user sees this as the `request_signature` and `signature_status` tools
(`chat/tools/esign.py`). **Off by default:** `ESIGN_ENGINE=none` (the setting
lives in `workflow_backend/settings/base.py`). With no engine the tools are not
offered.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `SignatureRequest` | A document sent for signing, and its status |

## Files

| File | What it does |
|---|---|
| `provider.py` | Sends the document through the engine named by `ESIGN_ENGINE`. Documenso is the v1 engine |
| `views.py` | `signature_hook`: the webhook the provider calls when a document is signed or declined. CSRF-exempt, so it checks the secret in the URL |
| `urls.py` | Route for that webhook |
| `apps.py` | App registration |

## Rules

- Completion arrives only by webhook. A request stays pending until the provider calls back.
- The webhook answers 404 for every refusal (bad secret, unknown event, already-closed request), so it cannot be used to probe.

## Tests

`esign/tests/test_esign.py`.
