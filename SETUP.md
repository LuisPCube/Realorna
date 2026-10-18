# Realorna: accounts, bank transfers, and admin attempts

This update replaces the active Midtrans checkout with manual bank transfers, adds username/password accounts, and lets admins send one Regular or Advance attempt to a registered username. The existing checker design is retained.

The code has not been connected to your existing live Vercel database. Your database URL, bank details, Gemini keys, and site URL are not available in the supplied ZIP. Configure them below before deploying.

## 1. Configure Vercel

Use your existing Vercel project. If importing the extracted project into a new repository, set the project root to the folder containing `package.json`.

1. Connect a Postgres database to the project. Vercel supports Postgres providers such as Neon through its Marketplace. If you already have a Postgres database, keep it.
2. In **Project → Settings → Environment Variables**, add the following variables to the deployment environment you intend to use.
3. Use **Node.js 22 or newer** and the build command `npm run build`. The existing Nitro configuration produces Vercel server output.
4. Deploy again after changing environment variables. Do not put private variables behind the `VITE_` prefix: that prefix exposes values to browsers.

| Variable | Value / purpose |
| --- | --- |
| `DATABASE_URL` | Your Postgres connection string. If the integration provided a differently named variable, add `DATABASE_URL` with the same appropriate Postgres connection string. |
| `BETTER_AUTH_URL` | Your site's exact HTTPS origin, for example `https://your-project.vercel.app`. Do not include `/login` or another path. Configure Preview separately if its origin differs. |
| `BETTER_AUTH_SECRET` | The generated value in the separate private `admin-credentials.txt` file, or your own random secret of at least 32 characters. Keep this stable across deployments. |
| `ADMIN_USERNAME` | `realorna_admin`, or your chosen unique bootstrap username. |
| `ADMIN_PASSWORD` | The generated value in the separate private credentials file, or your own 16–128 character password. |
| `ADMIN_EMAIL` | The credentials file supplies `admin@realorna.local`. You may use your own email before first deployment. No email delivery is configured. |
| `TRANSFER_BANK_NAME` | Your receiving bank's name. |
| `TRANSFER_ACCOUNT_NUMBER` | Your actual receiving account number, as text. |
| `TRANSFER_ACCOUNT_HOLDER` | The actual account holder name. |
| `TRANSFER_NOTE` | Optional additional instructions displayed to customers. |
| `GEMINI_MODEL` | An exact model ID currently available to your project in Google AI Studio. The code deliberately has no implicit model or paid model fallback. |
| `GEMINI_API_KEYS` | Your authorized Gemini keys, in priority order, separated by commas. See section 5. |

`VITE_AUTH_ENABLED` is already `true` in `.grok/app-env.json`. Do not override it with `false`.

`npm run build` builds the app, applies unapplied SQL migrations, then bootstraps the admin in the configured database. The database credentials therefore need permission to create the app's schema. The build refuses a Vercel deployment without `DATABASE_URL`; account endpoints also require `BETTER_AUTH_SECRET`.

Vercel Marketplace reference: https://vercel.com/docs/marketplace-storage

## 2. Sign in as admin

The generated initial login is in the separately supplied **admin-credentials.txt**. Set its variables before deployment, then visit **`/login`** and sign in with the username and password.

The bootstrap script stores a password hash, not a plaintext password. It runs safely again on later builds without overwriting an existing admin password. Changing `ADMIN_PASSWORD` after the account already exists does not reset that account's password. It refuses to promote a conflicting existing non-admin account.

Keep the private credentials file out of your repository. It is intentionally excluded from the source ZIP. Public signup reserves the bootstrap username, `realorna_admin`, `admin`, and `administrator`.

## 3. Send a Regular or Advance attempt

1. The recipient registers at `/login` using the **Register / Daftar** option.
2. Sign in as admin and open **Admin** in the header.
3. In **Send attempts / Kirim kesempatan**, enter the recipient's username.
4. Press **Send Regular** or **Send Advance**. Each press successfully completing adds one attempt.
5. The recipient sees the attempt in their account. The admin can also copy the generated attempt link and share it manually.

The link requires the recipient's login and cannot be redeemed by a different account. Registration treats `Alex`, `ALEX`, and `alex` as the same username; the database enforces this with a unique index, including racing registrations. Regular and Advance attempts are separate. One Regular attempt cannot buy an Advance check.

For your QRIS demo, show the payment QR from your banking or merchant app. Use that app's one-time QR feature if it supports one. After checking the actual incoming transaction there, send the appropriate attempt from the admin screen. Realorna does not generate or enforce the lifetime of that external QR.

Admin accounts can run either plan without buying or consuming attempts. This privilege is enforced on the server.

## 4. Bank transfer verification

1. A signed-in customer with no available attempt presses **Check** and creates an invoice.
2. Realorna displays your configured bank account, the exact amount, invoice ID, and a 24-hour expiry.
3. The customer transfers and submits a transfer reference or sender name. Their button requests verification; it does not confirm payment.
4. The admin opens **Admin → Transfer approvals** and checks the receiving account's actual transaction history.
5. Enter the amount actually received and the bank's transaction reference, confirm that you checked the transaction, then approve. Approval adds exactly one attempt.

Do not approve from a screenshot or a customer-supplied note alone. This integration has no bank API or automatic bank webhook. Payment authentication comes from the admin comparing the invoice with a real incoming bank transaction.

Prices and promo discounts are calculated on the server. Repeated approvals cannot add a second credit, and a bank transaction reference cannot be used on two invoices. Approval, credit creation, and the audit record are one atomic database statement. Expired invoices cannot be approved; reconcile any late payment manually before granting an attempt.

The old demo payment endpoint and Midtrans webhook return HTTP 410. They cannot mark a payment as paid. Old unowned Midtrans orders remain unowned and are not assigned to new users.

An AI check uses an attempt once. If analysis fails, retry that same saved check from the account's **Payments & recent checks → Resume / retry** control. Repeating Check with the unchanged input in the same browser session also reuses the saved check. The consumed attempt stays attached to its original URL and plan; a failed AI request does not require another payment for that check.

## 5. Where to put your API keys

For **Vercel**, enter keys in **Project → Settings → Environment Variables**. Do not paste them into a `.tsx` file.

For **local development**, the npm scripts read a private **`.env.local`** in the project root, beside `package.json`. This file is gitignored and intentionally not supplied. The same server variable names apply locally.

Example values (replace the placeholders):

```text
GEMINI_API_KEYS=your-first-key,your-second-key,your-third-key
GEMINI_MODEL=model-id-available-in-your-project
```

In Vercel's value field, paste only `your-first-key,your-second-key,your-third-key`, without the variable name or surrounding quotes. A JSON array or newline-separated list is also accepted. `GEMINI_API_KEY` remains supported for a single key and is appended after the list when both are set. Duplicate keys are removed; at most 12 distinct keys are used.

The reader and ordered failover implementation are in **`src/realorna/backend/key-pool.ts`**. Actual Gemini requests are in **`src/realorna/backend/gemini.ts`**. These are server modules; the keys stay out of the browser bundle.

Gemini calls now pass through a **Postgres-backed request gate** shared by Vercel instances. By default, only one outbound Gemini call runs at a time, with at least 12 seconds between call starts. This covers both video transcription and fact checking. Authentication failures can select the next authorized key, with the same pacing. HTTP 429 does **not** immediately switch to another key: keys in the same project may share the exhausted quota.

Transient failures use bounded exponential backoff with positive jitter. Realorna honors both the `Retry-After` header and Google's structured `RetryInfo.retryDelay`. Each provider operation gets at most three attempts by default, within its existing request time budget. A long cooldown is returned to the browser instead of keeping a Vercel request asleep indefinitely. The browser displays a countdown, and the saved check's retry time is also enforced in the database, including after reloads. Recognized daily/zero-quota failures are not automatically retried.

Optional server environment settings (leave unset to use the defaults):

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_MIN_INTERVAL_MS` | `12000` | Minimum time between Gemini call starts across this app's database. Increase it if your project's model allows fewer requests per minute. |
| `GEMINI_MAX_ATTEMPTS` | `3` | Total attempts per provider operation, including the first call; allowed range 1–5. |
| `GEMINI_MAX_QUEUE_WAIT_MS` | `15000` | Maximum wait for a shared slot within an operation. Longer waits return a retry countdown. Allowed range 0–30000. |
| `GEMINI_RETRY_BASE_MS` | `2000` | Initial backoff before jitter; subsequent transient failures increase it exponentially. |

The default spacing is a starting point, not a guarantee for every Gemini model or project. Match it to your active AI Studio limits. Pacing does not increase daily or token quotas. A video check may need both a transcription call and a fact-check call; retries and a supported search-compatibility fallback can add calls. Google usage from other applications sharing your project is outside this app's request gate.

The gate and credential cooldowns are stored in new tables from `migrations/0004_ai_throttle.sql`; raw API keys are never written there. All configured keys share one conservative request gate. Deploy the whole updated project and let `npm run build` apply this migration before testing. No new service or API key is required for the gate.

Google applies Gemini rate limits **per project, not per API key**. Several keys in the same project share its allowance. Failover does not increase that allowance or guarantee additional free usage. Configure only keys your team is authorized to use, within the provider's applicable limits. The code does not create accounts or projects.

Official Gemini rate-limit reference: https://ai.google.dev/gemini-api/docs/rate-limits

## 6. Local use and verification

Install dependencies with `npm install`, configure your local server variables, and start with `npm run dev`. Without a local `DATABASE_URL`, development uses an in-memory Postgres database that resets on restart. For a persistent local test against your Vercel-connected database, explicitly configure its `DATABASE_URL`, run `npm run db:migrate`, then `npm run admin:seed`. Use a separate development database when possible.

Commands included in this project:

```text
npm run typecheck
npm test
npm run test:payments
npm run test:ai-rate-limit
npm run build
```

The payment and rate-limit integration suites always use isolated in-memory databases and refuse to run with `DATABASE_URL` or `VERCEL` set. They include synthetic Gemini responses; they never verify a real payment or spend real model quota. Run them from an environment without those variables.

The key setup, admin bootstrap, and receiving account settings must still be checked on your own deployment. See `VERIFICATION.md` for what was actually tested.
