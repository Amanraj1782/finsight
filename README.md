# FinSight — Financial Analytics Dashboard

A college-level MERN project with a responsive navy-and-indigo workspace, light/dark themes, private transactions, live financial charts, CSV imports, insights, downloadable reports and an optional local AI spending assistant. No paid cloud AI service is required. The web app remains MERN; optional inference runs in a separate local Ollama installation.

## Requirements

- Node.js 20.19+ or 22.12+ and npm
- MongoDB Community running locally, or a MongoDB Atlas connection string

## Run locally

Open a terminal in `financial-dashboard`:

```sh
npm install
npm run install:all
```

Copy `server/.env.example` to `server/.env`. Set `MONGODB_URI` to your MongoDB connection string and replace `JWT_SECRET` with a random secret. Generate one with:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Keep `CLIENT_ORIGIN=http://localhost:5173`. Start MongoDB before the application. Optionally load development data, then start both apps:

```sh
npm run seed
npm run dev
```

Open http://localhost:5173. Register a new account, or sign in to the seeded account: **demo@finsight.local / FinSight123!**. The seed inserts several months of transactions and does not delete existing records. Never use the demo account or seed on a public deployment.

## Pages and features

- **Login / Register:** bcrypt passwords, signed JWT in an HTTP-only cookie, verified-email requirement and protected workspace.
- **Dashboard:** revenue, expenses, profit and margin; monthly bar chart, category donut, recent transactions. Choose a reporting period or custom dates.
- **Transactions:** create/edit with the same form, confirmation before deletion, title search, exact category/type/date filters, table pagination.
- **Analytics:** monthly bars, revenue line, category donut and income/expense area charts.
- **Smart Insights:** deterministic comparisons, highest expense category and strongest income month. Comparisons require relevant data; empty accounts show no invented insights. Insights use all recorded transactions, with current month based on UTC.
- **Reports:** filtered totals, transactions, CSV download. Downloads include all matching rows even when the table spans pages.
- **Settings:** account information, persistent light/dark preference, fixed INR currency.
- **Security center (inside Settings):** optional authenticator 2FA, one-time recovery codes, active login sessions, sign-out controls, and security activity history.
- **AI Assistant / Ask FinSight:** ask how to spend less, understand expenses, or save more. A real local language model generates English or Hinglish explanations from a fresh, user-specific financial summary. AI answers and deterministic Smart Insights are clearly separated.

All financial totals and charts come from MongoDB through the Express API. There are no hardcoded KPI values. Charts refresh after mutations and CSV imports. Monetary amounts are integer paise in MongoDB and JSON; forms, CSV imports and reports use rupees. A zero revenue gives an unavailable margin.

## CSV import

Use `sample-transactions.csv` as a template. Required headers:

```csv
title,amount,type,category,date,description
Consulting,15000.50,income,Freelance,2026-10-10,Client project
```

Select a `.csv` file up to 2 MB / 5,000 rows. Preview shows up to 20 valid unique rows and row-level errors. Confirm to import **valid rows only**; invalid rows and duplicates are skipped with counts. Amounts must be positive, at most two decimals, and no more than ₹1 billion. Dates must be real `YYYY-MM-DD` dates. Identical title/amount/type/category/date/description rows are considered duplicates for that user. Confirmation revalidates the original file; a unique database index prevents concurrent repeated imports. Editing an imported row removes its old import identity, allowing the original data to be imported again if it no longer exists. Downloaded reports neutralize spreadsheet formulas in text cells.

## Project structure

```text
client/src/
  components/     Charts, transaction table, reusable form, CSV importer
  pages/          Authentication and financial workspace views
  context/        Authentication state
  services/       Axios client, currency/date formatting
  App.jsx         Protected navigation, theme and layout
  main.jsx
  index.css       Tailwind import and responsive component styles
server/
  config/         MongoDB connection
  models/         User and Transaction
  controllers/    Authentication, validation and financial calculations
  routes/         REST endpoints
  middleware/     JWT authentication and origin protection
  server.js
  seed.js
  finance.test.js
```

## REST API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/auth/register | Register and set cookie |
| POST | /api/auth/login | Authenticate and set cookie |
| POST | /api/auth/logout | Clear cookie |
| GET | /api/auth/me | Current user |
| POST | /api/auth/verify-email | Verify the signed-in account's six-digit email OTP |
| POST | /api/auth/resend-verification | Request a fresh email for the signed-in account |
| POST | /api/auth/verify-2fa | Finish login using authenticator or recovery code |
| GET | /api/security/two-factor | 2FA status and remaining recovery-code count |
| POST | /api/security/two-factor/setup | Verify password and create a temporary setup key |
| POST | /api/security/two-factor/enable | Verify password and authenticator code; return recovery codes once |
| POST | /api/security/two-factor/disable | Verify password and second factor; disable protection |
| GET | /api/security/sessions | List owned active sessions |
| DELETE | /api/security/sessions/others | Sign out other sessions and invalidate pending challenges |
| DELETE | /api/security/sessions/:sessionId | Sign out one other owned session |
| GET | /api/security/activity?page=1 | Owned activity history, 20 events per page |
| GET / POST | /api/transactions | List / create |
| PUT / DELETE | /api/transactions/:id | Update / delete owned row |
| GET | /api/analytics/overview | Totals in paise; margin in percent |
| GET | /api/analytics/monthly | Monthly income/expense in paise |
| GET | /api/analytics/categories | Expense category sums in paise |
| GET | /api/insights | Supported financial observations |
| GET | /api/assistant/status | Check the configured local model |
| GET | /api/assistant/context?month=YYYY-MM | Calculated financial snapshot for the current user |
| POST | /api/assistant/ask | Ask the local AI a question using a fresh financial snapshot |
| POST | /api/upload/csv | Multipart file; confirm=false previews, true imports |
| GET | /api/reports/export | Download CSV |

Read endpoints accept `start`, `end`, `type`, `category`, and `search` query parameters. `search` matches titles and is treated as literal text. All private queries include the authenticated user ID; clients cannot assign ownership. Create/update JSON uses `amount` in **paise**. CSV upload is multipart with a `file` field. State-changing API requests must include an `Origin` header equal to `CLIENT_ORIGIN` (browsers set this automatically).

## Checks and build

```sh
npm test
npm run build
```

Optional integration tests against a **disposable test database** (PowerShell):

```powershell
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/finsight_security_test'
npm test
Remove-Item Env:TEST_MONGODB_URI
```

Without `TEST_MONGODB_URI`, unit tests run and the database integration test is marked skipped. Integration tests start a separate API on port 5019, create uniquely named test accounts and clean up their records. They verify 2FA activation and login, secret encryption, replay prevention, single-use recovery codes, expired/exhausted challenges, session revocation, logout invalidation, activity logging and cross-user isolation.

## Using the security features

1. Open **Settings → Security center → Set up authenticator** and enter your current password.
2. In an authenticator app, add a time-based account manually using the private setup key. Use your FinSight email as the account name. The settings are SHA1, 6 digits, 30 seconds. No QR or external service is required.
3. Enter the code from the app and your current password to activate protection. Setup expires after ten minutes. Other sessions are signed out when protection is enabled or disabled.
4. Save the ten recovery codes when shown. They can be downloaded once from the confirmation screen; each works once in place of an authenticator code, alongside the account password. Keep them private and separate from your password.
5. Future sign-ins first ask for email/password and then an authenticator or recovery code. The second step expires after five minutes and permits up to five attempts per challenge. If a code was just used, wait for the next code in your authenticator.
6. Under **Active sessions**, view approximate browser details, IP, creation, expiry and last activity (updated about once a minute). Sign out one other session or all other sessions. Use the normal Log out button for your current session. Sessions are seven days long; revoked or expired sessions cannot use the API even with a copied cookie.
7. Under **Security activity**, review account creation, successful/failed login attempts for existing accounts, pending second-factor logins, failed code checks, 2FA setup/changes, logouts, session revocations and transaction deletions. Events record time, request IP and user agent; passwords, tokens, setup keys, recovery codes and financial details are never included. Events expire after approximately 90 days using MongoDB TTL cleanup. These records are application history, not tamper-proof external audit storage.

Existing accounts require no migration and keep 2FA disabled until explicitly activated. Old stateless JWTs are intentionally rejected, so users must sign in again after updating. Two small collections (`Session` and `SecurityEvent`) support revocation and activity history; financial records remain unchanged. Expired sessions are rejected immediately even before MongoDB's asynchronous TTL cleanup removes them.

## Email verification and mail delivery

Configure a real mail provider in `server/.env` to send verification emails:

```env
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_FROM=FinSight <your-authorized-sender@example.com>
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
```

These are placeholders: use the host, credentials and an authorized sender from your provider. Never paste passwords into chat or commit `.env`. Port 465 uses implicit TLS; other remote ports require STARTTLS. Local plain SMTP is allowed only for a development/test mail catcher on a loopback host. Production does not disable TLS certificate validation. Restart the backend after updating settings. Provider acceptance does not guarantee inbox delivery; check spam folders and your provider's delivery logs.

Registration creates an **unverified account with a restricted session**. It attempts to send a six-digit email OTP and clearly reports if SMTP is not configured or delivery failed; the OTP is never returned in an API response or printed in logs. The restricted session can submit its OTP, check account status, resend to its own registered address or sign out, but cannot read or modify finances, call the AI assistant or access security controls. Signing in again retains the restriction until email ownership is verified. Two-factor authentication is still required for accounts that already have it enabled.

Read the code in the latest email, enter it in **Email OTP**, and choose **Verify OTP**. Codes expire in **10 minutes** and can be used once. They are generated with `crypto.randomInt`, preserving leading zeros. Only a keyed HMAC-SHA256 digest is stored, bound to the user ID and a random challenge identifier; the key is the server's `JWT_SECRET`. Changing that secret invalidates pending codes, and users must sign in again and resend. The database does not store plaintext OTPs. A new email rotates the challenge and replaces the prior code. Resend has a **60-second** database-backed cooldown and shares the request limiter. Failed sends clear the undelivered challenge so the account can retry.

OTP submission requires an authenticated session. The server verifies only that session's account and ignores any email/user ID supplied in the request body. Attempts are claimed atomically in MongoDB; after **5 incorrect attempts**, verification and resend are locked for **15 minutes**. Resend cannot clear an active lock. Correct verification is also atomic, so parallel requests cannot consume the code twice. A correct code updates the current user's state and opens the dashboard without creating a new session or bypassing password/2FA. Never share your OTP. If the page was open during the upgrade, refresh it and request a new code. Previously issued verification links no longer work; the old `/verify-email` page directs users to sign in and use the OTP screen.

**Existing real accounts also need to verify** after this update. They are not silently marked verified and their transactions are retained. The development seed explicitly exempts only the synthetic `demo@finsight.local` account, whose mailbox cannot receive email. Running `npm run seed` in development updates that demo account; the seed is forbidden in production. There is no general verification bypass or API that accepts an `emailVerified` value from the browser. A typo in the registered email requires signing out and registering the correct address; changing account email is not included.

Email delivery requires the SMTP configuration above. Integration tests use an isolated SMTP fixture to check real Nodemailer message submission, keyed code storage, expiry, cooldown, account binding, rejection of old links, resend invalidation, single-use races, parallel attempts, lockout, restricted access, failed delivery and legacy accounts. No real email is sent by tests. Transport setup follows the [official Nodemailer SMTP documentation](https://nodemailer.com/smtp).

Authenticator secrets are encrypted with AES-256-GCM; recovery codes are random 80-bit values stored only as SHA-256 hashes. TOTP uses RFC 6238 HMAC-SHA1 and rejects reuse of an accepted time step. Pending challenges cannot access private endpoints. Account security versions invalidate sessions and challenges on 2FA changes and signing out all other sessions. Setup, enable and disable require the current password; disabling also requires a second factor. Setup and verification endpoints share the existing single-server request limiter.

Implementation references: [RFC 6238 and its reference vectors](https://www.rfc-editor.org/rfc/rfc6238) and [OWASP multifactor authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).

For a local project, the encryption key is derived from your existing `JWT_SECRET`, so **no new environment setting is required**. For production, set a separate random `MFA_ENCRYPTION_KEY` (32+ characters) **before** anyone enables 2FA. Back it up securely. Changing the effective encryption key without re-encrypting secrets breaks authenticator verification; recovery codes still work, allowing a user to sign in, disable, and re-enroll. Do not share `.env`, setup keys or recovery codes. If both the phone and recovery codes are lost, this project has no automated account-recovery service.

## Set up the real AI assistant (optional)

1. Install [Ollama for Windows](https://ollama.com/download/windows) and open a fresh terminal after installation.
2. To ensure inference stays local, configure Ollama's `OLLAMA_NO_CLOUD=1` environment variable and restart Ollama. See [Ollama's local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features). For a terminal-only session, quit any running Ollama desktop instance, then run:

   ```powershell
   $env:OLLAMA_NO_CLOUD = '1'
   ollama serve
   ```

   Keep that terminal open. If it says port 11434 is already in use, another Ollama instance is running; configure local-only mode for that instance and restart it rather than starting a second instance.
3. In another terminal, download the model:

   ```powershell
   ollama pull qwen2.5:1.5b
   ```

   This downloads a model to Ollama's normal model directory and requires disk space/RAM. CPU inference works but may be slow. You are responsible for the selected model's license. The default model is [Qwen2.5 1.5B](https://ollama.com/library/qwen2.5:1.5b).
4. FinSight defaults to `http://127.0.0.1:11434` and `qwen2.5:1.5b`, so no existing `.env` edits are required. Optional overrides in `server/.env`:

   ```env
   OLLAMA_URL=http://127.0.0.1:11434
   OLLAMA_MODEL=qwen2.5:1.5b
   ```

   Only a loopback host is accepted; cloud model names are rejected. Do not configure an Ollama model alias that proxies to a remote service. Local-only mode in Ollama is the authoritative way to disable cloud forwarding.
5. Start FinSight as usual. Open **AI Assistant** in the sidebar, choose a month with transactions and a reply language, then click a suggested question or enter your own. Click Refresh if you installed the model while the page was open.

Examples:

- “Main kharcha kam karke zyada savings kaise kar sakta hoon?”
- “Which categories should I review before setting a savings target?”
- “What do you need to know to help me set a realistic monthly budget?”

Each question sends **only the authenticated user's selected-month and prior-three-month summary**, limited top expense category totals, computed financial facts and the question to the local model. Titles, descriptions, database IDs, user names/emails, passwords and authentication secrets are not included. User-entered category labels and the question can still contain personal information; avoid putting account numbers or secrets in them. Money stays in integer paise in the snapshot. Summary facts use server calculations; the model supplies explanations and optional suggestions. A current month is labeled month-to-date; a three-month average appears only when all three prior months contain recorded transactions. Missing entries are not proof of zero real-world spending. The 10% reduction fact is a hypothetical calculation, not a forecast or achievable savings guarantee.

AI answers link to actual calculated fact IDs displayed under **View calculated facts used for this answer**. This validates references, not the correctness of every statement in a generated answer. Read the facts and check suggestions yourself. The assistant has no bank connection, transaction-editing tool or payment capability. It cannot see unrecorded spending, debts, income stability or family obligations. It gives general spending/saving suggestions, not personalized investment, tax or lending advice.

Questions are independent: previous chat messages are not sent to the model. Up to six recent answers remain in React memory and clear on page reload, month change or context refresh. There is no chat-history collection. Every answer reloads the current user's transaction summary from MongoDB; the server never trusts financial context or a user ID supplied by the browser. It permits one outstanding request per user, two globally and twelve questions per fifteen minutes per user on one Express process. Model calls time out after two minutes; offline/missing models, incomplete output and unknown source IDs produce explicit errors. There is **no pretend AI or rule-based fallback**. The existing dashboard and Smart Insights work without Ollama.

AI unit tests cover financial snapshots, missing history, output validation, local-only URL restrictions and readiness probes. The opt-in database integration test uses an **explicit fake Ollama protocol server** to test authentication, ownership, fresh data, prompt privacy and provider errors. It does not prove the quality of a real model's financial explanations. Run a real-model check after installing Ollama and the configured model. API integration follows the [official Ollama chat API](https://docs.ollama.com/api/chat).

Tests cover money conversion, date/range validation, search escaping, empty and populated analytics, missing months, insights, CSV formula escaping and duplicate identity. The production client is generated in `client/dist`. To preview the build with the API, run `npm start --prefix server` and `npm run preview --prefix client` in separate terminals. The local preview forwards `/api` to port 5000 and serves on port 5173.

## Deployment notes and project limits

Deploy the Express server and MongoDB separately from static assets, with a reverse proxy forwarding `/api` to Express on the same public origin. Set `CLIENT_ORIGIN` to that exact HTTPS origin, `NODE_ENV=production`, a private MongoDB URI and a strong secret. Secure cookies require HTTPS. Vite's development proxy handles `/api` locally; no permissive CORS is needed. Never commit `.env`.

### Single-service production deployment

The Express server can also serve the built React client itself on the **same HTTPS origin**, simplifying cookie authentication and origin checks. The production server serves `client/dist`, supports direct React routes and exposes `GET /api/health`. No development preview server is used in production.

- Project root: the `financial-dashboard` directory containing both `client` and `server`.
- Build command: `npm run build:deploy` (installs the server/client dependencies and builds React).
- Run command: `npm start`.
- Node runtime: 22.x.
- Port: use the hosting provider's injected `PORT`; expose that HTTP port and route `/` to it.
- Health check: `/api/health`.
- For Heroku-compatible Node buildpacks, `heroku-postbuild` runs the same deploy build.

Set **hosting secrets**, never committed source files:

```env
NODE_ENV=production
MONGODB_URI=<Atlas connection string with a database-scoped user>
JWT_SECRET=<a new random production secret, at least 32 characters>
MFA_ENCRYPTION_KEY=<a separate stable random encryption key>
CLIENT_ORIGIN=https://<your-exact-hosted-domain>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=FinSight <your-authorized-sender@gmail.com>
SMTP_USER=<your-authorized-sender@gmail.com>
SMTP_PASS=<your-app-password>
```

Set `TRUST_PROXY_HOPS=1` only when the hosting provider's trusted proxy configuration requires exactly one hop; otherwise leave it at 0. Only 0–2 hops are accepted. Do not replace TLS/cookie/origin protection with permissive CORS. Add the host's permitted outbound network range to Atlas access controls and use a user restricted to the `finsight` database. Creating a cloud database does not migrate local accounts or transactions automatically; data migration needs a separate decision. Do not run the development seed in production.

Hosting must permit the mail transport you use. [Render's free services block outbound SMTP ports 25, 465 and 587](https://render.com/docs/free); email OTP will fail there without an HTTPS mail provider or a compatible paid service. [Koyeb documents SMTP submission over port 587](https://www.koyeb.com/docs/faqs/general), making it a candidate for the existing Gmail transport. Check account requirements, current pricing and the selected plan before creating resources.

The local-only Ollama integration does **not** connect a deployed server to a model on your laptop. Public AI access requires an inference runtime co-hosted with the server or an explicitly approved cloud/provider integration. On a small host without Ollama, the assistant shows that the model is unavailable; financial tracking, charts and email verification continue to work. No cloud AI credentials have been configured and no financial data is automatically sent to a cloud model.

Deployment is not complete until the hosted `/api/health`, registration, OTP email delivery, verification, cookie login and required AI setup are checked. Keep local `.env` files, SMTP passwords and private database credentials out of Git and downloadable source archives.

This intentionally intermediate project loads a user's matching transactions into memory for analytics and paginates the table in the browser. For large datasets, replace these reads with MongoDB aggregations and server pagination. Login limits are in-memory for a single server; use durable account-aware rate limiting for a public, multi-server deployment. Request IPs are direct connection addresses unless a trusted reverse proxy is explicitly configured. User-agent strings describe a browser approximately and are not verified device identities. There is no password reset, role system, bank integration, forecasting, or PDF export. Authentication uses browser cookies rather than localStorage. For internet-facing production, add operational monitoring, backup policies and an independent security review.

## Viva talking points

React handles views and shared authentication state; Axios calls Express; middleware validates the cookie and identifies the user; Mongoose models persist owned records. Revenue is the sum of income, expenses are the sum of expense transactions, profit is revenue minus expenses, and profit margin is profit divided by revenue × 100. Integer paise avoid floating-point rounding in stored monetary values. Recharts visualizes aggregated API responses. CSV validation happens on the server during both preview and confirmation, and hashes identify repeat imports.


### Vercel deployment

Import the repository's codex/otp-production-deployment branch with Root Directory set to the repository root, not client or server. The committed vercel.json installs both packages, builds client/dist, serves React assets via the CDN and routes /api to a Node.js function. The API exports the same Express app used locally; it does not open a listening port on Vercel. MongoDB connections are shared by concurrent requests within a warm function, with a small pool.

Set the production secrets listed above in Vercel Environment Variables, including NODE_ENV=production and CLIENT_ORIGIN equal to the exact final HTTPS domain without a trailing slash. Add /finsight after the Atlas hostname in MONGODB_URI (before any query string). Use new JWT and MFA keys; never reuse keys shown in screenshots. Rotate the exposed Atlas password before deployment. Configure Atlas network access for the deployment's outbound connectivity. Never put secrets in vercel.json or variables prefixed VITE_. Keep preview deployments disconnected from production data unless separately configured with their own database and exact origin.

Vercel does not run the local Ollama service. The AI assistant remains unavailable online until a separate approved AI hosting/provider setup is completed. Login/AI throttles currently live in process memory and are not global across function instances; use shared durable throttling before opening registration to general public traffic. Check OTP delivery on the actual deployment. See [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js) and [project configuration](https://vercel.com/docs/project-configuration/vercel-json).
