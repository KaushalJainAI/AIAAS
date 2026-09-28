# Presenter guide: AIAAS investor pitch

Use this with `AIAAS_Investor_Pitch.pptx` (41 slides). The audience is a
**technical investor**: someone who wants to know why this matters, and also
whether the engineering is real and hard to copy.

Learn the **Point** of each slide and the **Bridge** into the next one. Don't
read the script word for word.

The full deck runs about 40 minutes. For shorter versions, see section 4.

---

## 1. The story in one breath

> Every company is full of work that repeats: reports, inbox triage,
> reconciliations, follow-ups. Most of it is done by people who don't write
> code. AI can take that work over, but nobody hands an AI the company mailbox
> without brakes. AIAAS is a **no-code** platform that automates the
> repetitive work **without losing control**, and makes information and
> intelligence **abundant across the organisation, and controlled**.

### Two words to keep repeating

- **Abundant:** agents that do real work, files anyone can open, fixes the
  whole organisation can find again.
- **Controlled:** permissions, approvals, spend caps, locks, encryption,
  records.

At the end of each section, say which word it served.

### The thread

**Every guardrail sits in one place, so nothing can skip it.** You'll meet it
again and again: one entry point for runs, one place approvals are settled,
one resolver for secrets, one read path for an organisation's data. A
technical investor hears this as *defensibility*: control built into the
architecture, not added on top.

### The characters

- **You, the boss.** Approve, answer, steer.
- **The manager.** The chat. It reads, plans and hands out work.
- **The workers.** Agents, each with only the access it was given.

### The arc

| Part | Slides | What the investor learns | Time |
|---|---|---|---|
| The opportunity | 1–7 | The problem, who it's for, use cases, the product, why we win | 8 min |
| 1. Shape | 8–10 | It's a real, coherent system | 3 min |
| 2. Orchestration | 11–19 | The control model: the core IP | 9 min |
| 3. Context | 20–23 | Long tasks stay reliable | 4 min |
| 4. Files & apps | 24–30 | The work lands somewhere people use | 7 min |
| 5. Runtime | 31–33 | It's efficient and safe to operate | 3 min |
| 6. Trust | 34–37 | Why a company can say yes | 4 min |
| 7. Proof & next | 38–41 | Quality is measured, and where it goes next | 3 min |

---

## 2. Slide by slide

### The opportunity (1–7)

**1. Title.** *Point:* a no-code platform for automating an organisation's
repetitive work, with control. *Say:* the subtitle, then point at the
diagram: "You, a manager, and workers that each hold only what they were
given. Keep this picture in mind."

**2. Why AIAAS.** *Point:* automation without control isn't adoptable, and
control without automation isn't useful. *Say:* each problem, then its
answer. End on the dark strip and read it: *"make information and
intelligence abundant across an organisation, and controlled."* Pause.
*Bridge:* "And the people doing that work are mostly not programmers."

**3. Built for people who don't write code.** *Point:* the everyday path
needs no code, so it reaches the teams with the most repetitive work.
*Say:* go down the five rows. Describe an agent. Sign in with Google.
Pick "every Monday at 9". Tap an approval. Open the file in Docs or Sheets.
Then the dark panel: "Code is there if you want it, but the everyday path
never asks for it."

**4. Use cases.** *Point:* this is useful across the company from day one.
*Say:* "Nearly 50 ready-made agents across finance, operations, sales,
support, hiring and engineering. Install one, point it at your data, and it
runs." Pick one to make it concrete: "A finance team installs the
reconciler, points it at the month-end folder, and gets a checked workbook
back."

**5. The product.** *Point:* four parts working together.
*Say:* chat, agents, files, evaluation. Tap the numbers: five autonomy
levels, four permission axes, one entry point, and the whole backend in
384 MB.

**6. Why us.** *Point:* AIAAS sits in the gap between the three approaches
people use today.
*Say:* "Assistants are easy but can't be trusted with access. Workflow tools
act, but someone has to draw every step. Frameworks handle anything, but need
engineers. AIAAS is no-code, handles open-ended work, acts on real data, and
adds what none of them give by default: fine-grained control, organisation
memory that never leaves the organisation, and real files."
*Note:* these are categories, not named competitors. If asked about a
specific product, answer on the same rows.

**7. Agenda.** *Point:* three deep-dive parts. *Say:* "Orchestration,
context and files are where most of the engineering is."

### Part 1: Shape (8–10)

**8. Request path.** *Point:* a clean, modern architecture. *Say:* a React
app, streaming both ways, one async Django backend, Postgres and Redis, the
model providers, Google's APIs, and a code sandbox with no network access.

**9. One entry point.** *Point:* one door, so the checks can't be skipped.
*Say:* five ways to start a run (chat, another agent, a schedule, the API, a
test), one entry point, and four checks done once for everyone.

**10. The turn loop.** *Point:* each step has a job. *Say:* agent → tools →
curate → steering. Approvals settle before anything runs. Curation keeps
long runs in bounds. Steering lets a person redirect a run without stopping
it.

### Part 2: Orchestration (11–19): the control model

**11. Roles.** *Point:* the chat gets the least power, because it's the part
you can't configure. *Say:* it reads, plans and delegates. Anything that
writes, sends, publishes or spends goes to an agent the user set up. This is
checked when tools are offered and again when one is called.

**12. An agent is a configuration.** *Point:* no flowcharts. An agent is a
prompt, a model and its permissions. *Say:* the card, then the four
properties: composable, structured outputs, one validated save path,
portable templates.

**13. Delegation limits.** *Point:* cost and risk can't run away. *Say:*
depth 2, the budget split before workers start, and size limits in both
directions. Then the dark strip: "We refuse long instructions going down and
trim results coming up, and nothing trimmed is lost."

**14. Workers hand back files.** *Point:* results come back as files, which
keeps long jobs efficient. *Say:* the worker writes into the folder its
caller shares with it, and answers with a path.

**15. Detached dispatch.** *Point:* a lead can manage a team in real time.
*Say:* follow the timeline. Workers run in the background, and the lead
wakes on each event: steer, stop or undo.

**16. Escalation.** *Point:* the manager handles what it can, and you decide
what matters. *Say:* questions are answered by the manager. Approvals reach
you in ask mode. In auto mode the manager decides, under the same safety
floor. Reminders follow up if nobody answers.

**17. Exactly-once approvals.** *Point:* an approved action happens once,
even after a pause. *Say:* "Pausing replays the step. If checks and actions
were mixed, a safe action would run twice. We settle every approval first,
then act."

**18. The autonomy ladder.** *Point:* five levels, because two options push
people to "never ask". *Say:* from plan-only to fully unattended. Unknown
tools are always treated as the risky kind.

**19. Four permission axes.** *Point:* permissions narrow in four
independent ways. *Say:* capabilities, which data, which tools, and
allow/ask/deny for each tool. When work is handed down, the stricter setting
wins.
*Bridge:* "Control is one half. The other is reliability on long tasks."

### Part 3: Context (20–23)

**20. What the model sees.** *Point:* the request is built deliberately,
with stable parts first so they can be cached, and everything else one tool
call away. *Say:* go top to bottom, then the right column: plan, archive,
files, solved problems.

**21. Curation.** *Point:* long runs stay inside the model's window without
losing anything. *Say:* wait until 70% full, then cut to 45%, in whole
pieces, and archive what's cut. The chart is illustrative.

**22. The plan.** *Point:* the agent never loses track of the goal.
*Say:* the plan lives outside the transcript, so trimming can't touch it.
It's fed back every turn and keeps its history, including dropped steps.

**23. Budgets.** *Point:* every input has a limit and a defined behaviour
past it. *Say:* pick two rows. "A truncated result must never look like a
short one."

### Part 4: Files & apps (24–30): where the work lands

**24. Virtual filesystem.** *Point:* agents work on real files, safely.
*Say:* paths are walked folder by folder and `..` is clamped, so the worst
case is another database row, never the server. There are five access
modes. Most tasks want "read everything, write only here".

**25. Concurrency.** *Point:* an agent and a person can work on the same
file safely. *Say:* follow the sequence. The stale write is refused, the old
version is kept, and nothing is lost.

**26. Code workspaces.** *Point:* a coding team works in one repository
without stepping on each other. *Say:* leases on paths, plus a hash check on
every edit.

**27. Office files.** *Point:* consistent, professional output every time.
*Say:* the model writes a spec, and our renderer decides the look. Real,
editable charts. Formulas stay formulas.

**28. Fifteen apps.** *Point:* whatever an agent produces, people open and
edit in the product. *Say:* sweep the grid, then the strip: lightweight
open-source editors, with no office server to host or license.

**29. Autosave.** *Point:* no Save button, and no lost work. *Say:* edits
save as a draft instantly, the real file follows, and versions are kept.
Tabs, pages and zoom level come back when you return.

**30. The complete experience.** *Point:* one request, end to end.
*Say:* tell it as a story, from asking in chat to getting a deck in Slides
every Monday. *If you have a live demo, this is its script.*

### Part 5: Runtime (31–33)

**31. Built to run lean.** *Point:* efficiency is a product feature. It's
cheap to run and easy to deploy. *Say:* the three numbers (384 MB, about
11 s to restart, zero extra processes for Google), then the four points.

**32. Parallel tools.** *Point:* faster answers. Independent calls run
together, and results stay in order.

**33. Sandbox.** *Point:* model-written code runs somewhere with nothing to
steal and no way out.

### Part 6: Trust (34–37): why a company can say yes

**34. Prompt injection.** *Point:* we limit what injected text can do,
because detecting it reliably isn't possible. *Say:* six layers. Example:
"A link the agent builds itself can't carry data, so injected text can't
leak the inbox through a URL."

**35. Credentials.** *Point:* secrets are encrypted at rest, and the model
never sees one. *Say:* the five steps: stored with Fernet encryption,
referenced by name, approved as a reference, resolved after approval,
scrubbed from the result. Then: OAuth tokens are encrypted, every decrypt is
audited, connectors get only what they need, and our own keys are hashed.

**36. Solution memory.** *Point:* one person's fix becomes the whole
organisation's, with a shelf life on every fact. *This is "abundant" at its
clearest.*

**37. Isolation.** *Point:* abundant inside the organisation, never outside.
*Say:* one read path, membership checked live, the same 404 for everything
you can't see, enforced by tests.

### Part 7: Proof & next (38–41)

**38. Run records.** *Point:* every run is auditable, turn by turn. *Say:*
full reasoning per turn, each worker linked to the step that started it, and
each run tied to the configuration it ran with.

**39. Evaluation.** *Point:* quality is measured, not assumed. *Say:*
agents are tested in generated test worlds, through the same code as real
runs, with no real data touched. Human review is measured against the
automatic grader.

**40. What's next.** *Point:* the roadmap builds on what exists. *Say:*
long-running missions, every messaging channel, measured quality on every
release, and scale. "Each one reuses a foundation you've already seen."

**41. Engineering principles.** *Point:* the principles explain every
decision, and let a small team build something this broad safely. Close
with: "Abundant, and controlled. Thank you."

---

## 3. Questions a technical investor is likely to ask

| Question | Short answer |
|---|---|
| What's the moat? | The control model is part of the architecture: one entry point, four permission axes, five autonomy levels, exactly-once approvals, secrets the model never sees. Adding this to an existing tool means rebuilding its core. |
| Why won't a big AI lab just build this? | Labs build assistants for individuals. This is an organisation layer: permissions per agent, memory isolated per organisation, real files, and approvals routed to the right person. |
| Which models do you use? | Pluggable: OpenRouter, NVIDIA, OpenAI, Ollama and OpenCode Zen. Customers can bring their own keys. The default keeps working as individual models are retired. |
| How do you keep costs down? | A lean runtime (slide 31), spend caps per agent split across workers, prompt caching by design (slide 20), and cheap models for background work. |
| Is it secure enough for real company data? | Encrypted credentials the model never sees (35), per-organisation isolation (37), a no-network sandbox (33), injection limits (34), and audited records of every run (38). |
| How do you know the agents are good? | Generated test worlds, graders checked against human review, and repeated runs (39). |
| Is it no-code for real? | Yes for everyday use. Code is optional, for custom connectors, Python analysis, the coding team or the API (3). |

**If you don't know an answer:** "Good question. Let me come back to you with
specifics." Never guess a number.

---

## 4. Shorter versions

**20 minutes (the usual investor meeting):**
1, 2, 3, 4, 5, 6, 9, 11, 13, 16, 18, 19, 20, 22, 25, 28, 30, 31, 35, 37, 39, 40, 41.

**10 minutes:** 1, 2, 3, 4, 6, 11, 19, 30, 35, 40, 41.
Why → no code → use cases → why us → control → the journey → trust →
what's next.

---

## 5. Before you present

- [ ] Open the `.pptx` in PowerPoint and check the fonts. The preview was
      made in ONLYOFFICE.
- [ ] Practise slides 2, 3 and 6 until they're natural. They carry the
      pitch.
- [ ] Have a live demo ready for slide 30: an agent that will ask for one
      approval, and a file that opens in an app.
- [ ] Know which visuals are illustrative: the curation chart (21) and the
      two timelines (15, 32).
