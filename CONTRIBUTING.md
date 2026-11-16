# Contributing to AIAAS

Thanks for taking a look. Bug reports, ideas and pull requests are all welcome.

## Ways to help

- **Try it and tell us what broke.** Open an issue: what you did, what you expected, what happened.
- **Suggest an idea.** Open an issue that describes the problem first, then the change you have in mind.
- **Send a pull request.** Small, focused changes are easiest to review.

## Run it locally

See [START_HERE.md](START_HERE.md), section 3.

## Before you open a pull request

Run the checks for the part you changed.

```bash
# Backend (from Backend/). Includes the import-contract test.
python -m pytest                 # or: python manage.py test

# Frontend (from better-n8n-frontend/)
npx tsc -b --force               # type check (plain tsc --noEmit checks nothing here)
npm run lint
npm test
npm run build

# Mobile (from mobile-native/)
npx tsc --noEmit
npm run lint
```

Also:

- Put backend tests in `<app>/tests/test_<topic>.py`, and frontend tests in `src/<dir>/__tests__/`.
- If you add or change a route, update `Backend/docs/API.md` in the same change.
- Match the style of the code around your change.
- Describe what changed and why in the pull request.

## Where things live

[START_HERE.md](START_HERE.md) maps the codebase. Each backend app has its own
`README.md`. [`Backend/docs/README.md`](Backend/docs/README.md) indexes the design
docs, and [`better-n8n-frontend/BEGINNER_GUIDE.md`](better-n8n-frontend/BEGINNER_GUIDE.md)
covers the frontend.

## Security

Please do not open a public issue for a security problem. Contact the maintainer directly instead.

## Licence

By contributing, you agree that your contribution is released under the project's [MIT licence](LICENSE).
