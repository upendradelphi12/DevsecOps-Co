# Workspace guidance

- Keep the dashboard's seeded records clearly identified as demo data until a provider API is connected.
- Do not put provider tokens or client secrets in frontend code. Real authentication, repository access, and pull-request decisions must go through a backend with authorization and audit logging.
- Preserve the responsive operational dashboard and authentication entry flow when changing the UI.
- Run `npm run lint` and `npm run build` after code changes.