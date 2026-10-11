# Contributing to AIAAS

Thanks for taking a look. Feedback, bug reports, ideas and pull requests are all welcome.

## Ways to help

- **Try it and tell us what broke.** Open an issue with what you did, what you expected and what happened.
- **Suggest an idea.** Open an issue describing the problem first, then the change you have in mind.
- **Send a pull request.** Small, focused changes are easiest to review.

## Run it locally

Start with `START_HERE.md` for a plain-language tour of how the project fits together.

Backend (`Backend/`):

```bash
python -m venv venv && source venv/Scripts/activate   # Windows (Git Bash)
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

Frontend (`better-n8n-frontend/`):

```bash
npm install
npm run dev          # http://localhost:5173
```

Copy `Backend/.env.local` to `Backend/.env` and fill in the keys it asks for. `OPENROUTER_API_KEY` is needed to run the default model.

## Before you open a pull request

Run the checks for the part you changed.

```bash
# Backend
python manage.py test            # or: pytest

# Frontend
npm run lint
npm run build                    # type-checks, then bundles
```

Please also:

- Put new backend tests in `<app>/tests/test_<topic>.py`, and frontend tests in `src/<dir>/__tests__/`.
- Keep `Backend/docs/API.md` current if you add or change a route.
- Match the style of the code around your change.
- Describe what changed and why in the pull request.

## Where things live

Each backend app has its own `README.md`, and `Backend/docs/README.md` sorts the design docs. `better-n8n-frontend/BEGINNER_GUIDE.md` covers the frontend.

## Security

Please do not open a public issue for a security problem. Contact the maintainer directly instead.

## Licence

By contributing, you agree that your contribution is released under the project's [MIT licence](LICENSE).
