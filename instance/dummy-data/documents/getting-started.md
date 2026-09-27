# Getting started

Create an agent, give it a goal, hit run. Check Runs for the trace.

## Quick steps

1. Connections → enable what you need
2. Documents → upload a file
3. Agents → New agent → Save
4. Runs → Execute with a goal

Auth is a bearer JWT from `POST /api/auth/login/`. Token 360m, refresh 7d.
For SSE add `?token=<jwt>`.

This file is dummy seed data for `instance/` — safe to delete or re-seed.
