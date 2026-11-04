# DevSecOps Copilot

A React, TypeScript, and Node.js dashboard prototype for live GitHub repository/security data and demo Azure DevOps data.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` and configure an SMTP provider before testing password recovery. Open `http://127.0.0.1:5173` to create an account with a username, password, and recovery email. Accounts persist in the local SQLite database at `data/accounts.sqlite`; passwords are stored as salted scrypt hashes.

Only usernames with an account already created in this app can sign in. Provider PATs connect GitHub or Azure DevOps to an already signed-in account; a provider token alone cannot create a DevSecOps Copilot login session.

For password recovery, choose **Forgot password?**, enter the account email, and use the emailed 4-digit PIN with a new password. The PIN expires after 10 minutes, can be attempted five times, and is stored only as a keyed hash. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. Set a random `RESET_PIN_SECRET` with at least 32 characters. SMTP credentials and reset secrets belong only in the ignored `.env` file.

To connect GitHub, select **GitHub** under **Connected Sources**, paste a GitHub personal access token into the masked input, then choose **Verify and connect**. The backend verifies the token with GitHub and loads the profile, repositories, alerts, and pull requests.

To connect Azure DevOps, select **Azure DevOps** under **Connected Sources**, enter the organization name and a personal access token, then choose **Verify and connect**. The backend verifies organization access, loads Azure projects, Git repositories, and active pull requests, then displays them alongside GitHub data. Azure PATs are sent only to the backend and kept in the in-memory server session.

## GitHub token permissions

Prefer a fine-grained personal access token restricted to the repositories you want to monitor. Grant repository metadata read access and these repository permissions as needed:

- Code scanning alerts: read
- Dependabot alerts: read
- Secret scanning alerts: read
- Pull requests: read, to list open PRs
- Pull requests: write, only if you want to approve PRs or request changes from this portal

Some security features require an eligible GitHub plan and to be enabled on each repository. If a feature or permission is unavailable, the dashboard reports it instead of treating the missing response as zero risk. A token must also have access to the private repositories you expect to see.

For Azure DevOps, create a PAT for the selected organization. Grant **Project and Team: Read** and **Code: Read** to list projects, repositories, and pull requests. Grant **Code: Read & write** only if you want to cast approve/request-changes votes. Pull request votes are submitted as the PAT owner's reviewer vote; Azure does not post a GitHub-style review comment.

## Data and behavior

- Repository inventory is fetched live from `GET /user/repos`.
- Security alerts and open pull requests are fetched for up to the 25 most recently updated, non-archived repositories on each sync. The **Sync GitHub** button refreshes the data.
- Findings include code scanning, Dependabot, and secret scanning alerts returned by GitHub.
- Pull request approval and request-changes buttons submit reviews to GitHub. They require Pull requests: write permission; GitHub's response is shown if the token lacks permission or the action is not allowed.
- GitHub does not provide a code-quality grade or the displayed security score model through these endpoints, so those demo metrics are not represented as live measurements after connecting.
- Azure project and repository inventory plus active pull requests are live after the PAT is connected. Azure security-alert ingestion is not implemented yet; GitHub remains the live source for code scanning, Dependabot, and secret-scanning alerts.
- Manual GitHub or Azure DevOps syncs add a notification under the bell with the completed repository/pull-request counts or an error. Opening the notification center marks entries read; individual notifications or all notifications can be dismissed. Background five-minute auto-sync does not generate repeated notifications.
- GitHub check-run/status results are not loaded yet, so PR checks are explicitly shown as unavailable rather than passed.

## Token handling

Enter each provider PAT once after signing in. The backend encrypts it with AES-256-GCM and stores it in the local SQLite database, associated with the registered account. On a later sign-in, the provider connection is restored automatically; disconnecting that provider removes its saved token. Tokens are never written to browser storage or logs. The encryption key is generated locally at `data/provider-token.key` (or supplied via `PROVIDER_TOKEN_ENCRYPTION_KEY`) and is ignored by Git along with the database. Keep both files private and back them up together; losing the key makes saved PATs unreadable. The browser receives only a random HTTP-only, SameSite session cookie, and active sessions remain in memory until expiry or server restart. Do not expose this development server to the network. Production deployments should supply a dedicated secret-manager key, HTTPS, rate limiting, durable secure session storage, and operational hardening.

## Checks

```bash
npm run lint
npm run build
```
