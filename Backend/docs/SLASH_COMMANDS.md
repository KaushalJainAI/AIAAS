# Slash commands

A slash command is a short cut you type in the chat box. It starts with `/`.

It is structured input, not a prompt trick. The app reads it, checks it, then
runs it. The model never has to guess what you meant.

```
/agent Reporter summarise my inbox
```

Which thing (`Reporter`), and what to do (`summarise my inbox`). The app
checks that `Reporter` is really one of your agents before anything runs.

## How to use one

1. Type `/` at the start of the box. The palette opens.
2. Keep typing to filter. Pick with mouse, Enter, or Tab. Esc closes.
3. Fill the arguments. For people, files, agents, models, connections, a
   picker appears. A picked item becomes a chip carrying the id, so the name
   is never guessed twice.
4. Press Enter to send.

A `/` in the middle of a sentence is plain text. `/Chat/notes.md` never opens
the palette. Only a leading `/` is a command, and the backend parses the full
line the same way without the palette.

## The three kinds

**Client — runs in your browser.** No server call.

- `/new`, `/mode`, `/model`, `/effort`, `/help`

**Action — runs once on the server, returns a card.** No model call. Fast.

- `/cost`, `/status`, `/memory`, `/pause`, `/resume`, `/eval`, `/schedule`
- Sent as `POST /api/chat/commands/run/`. Turn and client commands are
  refused there with the reason.

**Turn — starts a normal chat turn with extra instructions.** The model still
answers.

- `/agent`, `/goal`, `/research`, `/search`, `/read`, `/code-review`, `/deck`,
  `/doc`, `/sheet`, `/chart`, `/image`, `/kb`, `/skill`,
  `/publish`, and more.
- These run through the normal message endpoints, not `/run/`.

If you type a client command as a message, the backend tells you to pick it
from the menu. It never runs in the model loop.

## What happens after you press Enter

```
1. Read the line      Split into name + rest
2. Find the command   Registry lookup, aliases included. Unknown name? Stop,
                      suggest the closest real name ("/agnt" -> "/agent?")
3. Check access       Guests see guest commands only. Hidden requirements stay
                      hidden; both doors checked (not listed AND refused typed)
4. Resolve each arg   Chips pass through. Names resolve case-insensitively
                      against your own rows only; a name that resolves to
                      nothing is refused here, never mangled into a run
5. Run the handler    Result is ok / confirm / error
6a. Action            Return the card. No model call
6b. Turn              Resolved command joins this turn as a trailing context
                      message (never the system prompt). May pin an intent or
                      narrow the toolbox. The turn then runs as normal
```

Failures show under the input with your text left in place. A failed command
is never sent to the model as plain chat. The resolved command is stored on
your message (`metadata.command`); the transcript shows a chip like
`/agent Reporter`, and regenerate replays the same command.

## The full list (by group)

**Agents**

- `/agent <name> <task>` — hand a task to one of your saved agents. The agent
  runs with its own model, tools and limits; its answer comes back as a run
  card, then as a message in this chat. Refused in `plan` mode.

**Goals (missions)**

- `/goal <text>` — start a long-horizon mission. Needs the confirm sheet
  (budget, deadline).

**Memory**

- `/memory <text>` — save a durable fact about you; `/memory forget <text>`
  shows the matching facts and asks which one to remove. Facts render in the
  system prompt. Agents can read but
  never write them.

**Code**

- `/code <project> <task>` — work inside a code project (needs workspace
  engine). `/code-review` — run the reviewer template read-only, returns a
  `findings` card.

**Browser**

- `/browse`, `/search`, `/read`, `/download` — search the web, read a page,
  fetch a URL as your file. Composed URLs are checked before fetch.

**Data and files**

- `/file`, `/kb`, `/extract`, `/sql`, `/api`, `/sheet`, `/chart`,
  `/dashboard`, `/diagram`, `/pdf`, `/export`, `/connect` — find files, search
  a knowledge base, pull structured rows, run a scoped query, draw from data,
  export a file type.

**Documents (office)**

- `/deck`, `/doc`, `/sheet`, `/pdf`, `/diagram` — describe slides, sheets or
  blocks. Our code renders the real `.pptx` / `.xlsx` / `.docx`; the model
  never writes markup. Limits refuse rather than shrink.

**Media**

- `/image` — make an image (asks first: it spends money). `/speak`,
  `/transcribe` — voice in and out (hidden with no speech engine). Audio and
  video generation stay off the tool surface.

**Session**

- `/help`, `/new` (alias `/clear`), `/mode` (Ask / Auto / Full auto / Plan),
  `/model`, `/effort`, `/skill`, `/research`, `/status`, `/pause`, `/resume`,
  `/approvals`, `/message`, `/sign`, `/publish`, `/run`, `/eval` — one per
  topic, gated by its own scope.

Unknown names get a suggestion, never a guess. `/reserach x` is an error with
a hint, not a search for `x`.

## Confirm sheets: the second tap

Some first actions spend money or leave the platform. They do nothing until
you press Start on a sheet that shows the resolved arguments:

- `/goal` — starts a mission (budget, deadline, agent).
- `/schedule` — arms a cron trigger.
- `/publish` — makes a page visible by link or publicly.

Pressing Start is the approval for the first action only. Everything after
that is gated as usual: every tool call still meets autonomy, grants,
scopes, and per-tool permissions.

## Rules worth knowing

**Consent covers the first action only.** `/agent Reporter …` starts the run
without the usual `run_agent` approval card, just like the Run button. The
worker's tool calls are gated normally.

**Plan mode withholds.** `/agent` refuses in `plan` mode; starting a run is
not a read. Switch to Ask or Auto first.

**Empty means default, not broken.** A fresh install lists every command with
no setup. An empty agent or connection scope means unrestricted. No silent
narrowing.

**Completion and validation share one predicate.** The picker offers only
what the validator accepts.

**One line, 2000 chars.** Longer pasted prose starting with `/` is refused as
too long to be a command.

**Aliases work everywhere.** `/clear` runs `/new`. Resolution, completion,
and help all know the aliases.

## Two walks

**Hand work to an agent:** `/agent Reporter summarise my inbox from today`

1. `Reporter` resolves to your agent id (case-insensitive, yours only).
2. Preflight checks the agent's model key and guardrails before anything
   streams.
3. A context block joins this turn: the user handed this to Reporter; use its
   answer, do not redo the work.
4. The run starts through the one door (`caller='chat'`); status, todos and
   files stream as `agent_run` frames.
5. The answer lands as a run card, then as a message from Reporter.

With `with_context`, the last few turns ride along as background, capped by
the delegation payload limits, marked as context not instructions.

**Start a mission with consent:** `/goal get 20 beta users in 2 weeks`

1. Resolves to `confirm` with a sheet: goal text, agent picker, budget,
   deadline.
2. You press Start. `POST /api/chat/commands/confirm/` runs the same service
   the model uses.
3. The mission row exists. Pause, resume, and cancel live on the Runs page
   (`/runs`, Missions section) and as commands.

## For developers: where it lives

- `Backend/chat/commands/registry.py` — `@command`, `Arg`, the three kinds.
- `Backend/chat/commands/resolve.py` — `split_leading_command`,
  `complete_arg`, `resolve_line`, `CommandError`. Parsing, picking, and
  validation in one module so they cannot disagree.
- `Backend/chat/commands/views.py` — `GET /api/chat/commands/`,
  `GET .../complete/`, `POST .../run/`, `POST .../confirm/`. Importing it
  registers every domain module.
- `Backend/chat/commands/<domain>.py` — one file per topic (`agents`,
  `missions`, `memory`, `review`, `session`, `library`, `shortcuts`, `web`,
  `media`, `knowledge`). Add a command by adding one block.
- `Backend/chat/turn/pipeline.py` — `TurnRequest.command`,
  `_resolve_command`, `_command_toolbox`, `_start_command_run`.
- Frontend: `src/lib/commands.ts` (pure parse, rank, chips),
  `src/api/commands.ts` (transport),
  `src/features/chat/hooks/useCommands.ts` (one catalogue per session),
  `src/features/chat/components/CommandPalette.tsx` and `CommandCard.tsx`.
- Tests: `Backend/chat/tests/test_commands.py`,
  `src/lib/__tests__/commands.test.ts`.

One copy only: the registry is backend code. The frontend ranks and renders;
the server decides.
