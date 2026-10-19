# Realorna: OpenAI, Real / Nah, accounts and transfers

The checker uses OpenAI web evidence to verify individual claims and returns Real / Nah with corrections. Existing username accounts, bank transfers, and admin-granted Regular/Advance attempts are retained.

The code has not been connected to your existing live Vercel database. Your database URL, bank details, OpenAI keys, and site URL are not available in the supplied ZIP. Configure them below before deploying.

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
| `OPENAI_MODEL` | Exact Responses API model ID with web search and Structured Outputs access. No implicit model fallback. Example: `gpt-4.1-mini` if enabled for your project. |
| `OPENAI_API_KEY` | Your server-side OpenAI key. For multiple authorized keys, see section 5. |

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

## 5. OpenAI configuration and evidence checks

In **Vercel → Project → Settings → Environment Variables**, add:

```text
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIBE_MODEL=gpt-transcribe
```

These are illustrative configuration values, not supplied credentials. Choose an exact model enabled for your OpenAI project that supports **Responses API + web_search + Structured Outputs**. The server requires `OPENAI_MODEL` and never silently substitutes a different model. `gpt-4.1-mini` is an example supported in OpenAI's web-search documentation; model access and limits depend on your project. `OPENAI_TRANSCRIBE_MODEL` enables transcription of directly downloadable audio/MP4 files; it is optional for articles and YouTube public captions. Use a transcription model available to your project, such as the documented `gpt-transcribe`.

Select the Production environment (and Preview if used), save, then redeploy the complete project. Gemini and xAI credentials are no longer used. Do not put keys in HTML, React files, `VITE_` variables, or public assets. Local npm scripts read private `.env.local`; no key file is bundled.

`OPENAI_API_KEYS` optionally accepts an ordered comma/newline-separated list or JSON array; `OPENAI_API_KEY` is appended if both exist. Duplicates are removed; at most 12 authorized keys are accepted. All keys share one conservative database gate. Authentication rejection can select the next key; 429 does not immediately hop keys.

The new request uses OpenAI Responses with mandatory live web search and strict JSON. There is **no model-memory-only fallback** when search is unavailable. The server accepts claim evidence links only if OpenAI's search output/citation annotations recorded them, removes the checked publisher's domain and generic home/search pages as sole comparison evidence, and marks unsupported claims unverified. This provenance check cannot independently prove that a source actually entails the claim; the model still interprets the evidence.

The result is derived from the claim statuses:

| Result | Rule |
| --- | --- |
| Real | The main claims are supported by comparison evidence. |
| Real, with correction | The main claims are supported; a minor detail needs a correction or remains unclear. |
| Nah (Hoax) | A main claim is contradicted by evidence. True and false parts are shown separately. |
| Not enough evidence | A main claim remains unresolved, no substantive claim is checkable, or only partial content is available. Lack of evidence is not proof of a hoax. |

Claims include ✓ supported, ✕ false, ~ minor correction, or ? unverified, with a short explanation, evidence links, and an evidence-backed correction where available. Publication time and check time are kept separate. Historical values are compared against the article's event date/session. The UI and copied/shared reports do not show a numeric trust score. URL safety is reported separately and cannot decide factual truth.

### Request pacing

The existing `0004_ai_throttle.sql` tables are reused under a new `openai` scope. No accounts, payments, or reports are deleted. Default behavior: one outbound request at a time, plus 12 seconds after a completed operation before the next begins. A request gate holds its lease until the provider body has been read. Transcription and checking share the gate across Vercel instances connected to the same database.

| Optional variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_MIN_INTERVAL_MS` | `12000` | Minimum spacing; increase for lower project limits. |
| `OPENAI_MAX_ATTEMPTS` | `3` | Total attempts per operation, including the first (1–5). |
| `OPENAI_MAX_QUEUE_WAIT_MS` | `30000` | Maximum in-request wait for a slot (0–60000 ms); occupied slots return `ai_busy` / HTTP 503 with a retry delay. |
| `OPENAI_RETRY_BASE_MS` | `2000` | Base for bounded exponential backoff with positive jitter. |

The code honors `Retry-After`, millisecond retry hints, and exhausted OpenAI request/token reset headers. Exhausted balance/spend quota errors stop automatic retries and return `ai_quota` / HTTP 503, without inventing a one-hour reset time. Any real provider retry hint remains honored. Busy slots are HTTP 503, temporary request/token limits HTTP 429, and timeouts HTTP 504. The saved check retains its attempt and any temporary retry time. The browser disables repeated requests during that cooldown, including after reloads, and follows updated server timestamps after an account refresh. Pacing does not increase token, spending, or account limits; other applications using your OpenAI project are outside this gate.

Each article check ordinarily uses one Responses request, with at most six search tool calls. Video may first need one transcription request. Provider retries can add usage; retries after a failed fact check may transcribe media again. Web search, transcription, and model usage can incur OpenAI API charges. A bounded operation has up to 120 seconds overall and up to 90 seconds per outbound attempt, limited by the remaining overall time (transcription also has its own shorter budget). A timed-out POST is not automatically repeated, since the provider may already have processed it. The request lease lasts for the permitted outbound time plus a 10-second cleanup margin; normal completion releases it immediately. Nitro's Vercel function configuration requests a 180-second maximum; your deployment plan must permit it.

Error responses include a support reference and safe diagnostic fields such as `error_origin`, provider HTTP status, provider error code and request ID when available. Match the reference to `[realorna] check_failed` in server logs. Keys, raw provider messages, article text and submitted URLs are not logged by this diagnostic path. See **RATE-LIMIT-FIX.md** for the error meanings and deployment steps. The pending screen shows elapsed time rather than timer-driven claims that stages have completed.

### Readability and video limits

Articles are extracted from article JSON-LD, `<article>` or `<main>` regions where available, with a plain-page fallback and bounded downloads. A blocked/paywalled/login page is not assumed true. A headline or caption alone cannot stand in for the article or video. Inaccessible content fails without an invented verdict and can be retried using the same saved order.

YouTube uses available public captions. Instagram/TikTok and other pages use directly exposed downloadable media when available (maximum 6 MB); media bytes are submitted to OpenAI's audio transcription endpoint. This is not a universal social-video downloader, does not log in to private posts, and does not send a YouTube page URL as an audio file. Missing captions/media remain unreadable. The current video check covers spoken claims, not unseen on-screen text, deepfake detection, or visual authenticity. Long truncated articles/transcripts remain unverified overall, even if individual readable claims have evidence.

The free examples are explicitly simulated; the IHSG 3,500/4,900 numbers and example closing times are not current market data. Examples never create orders, charge money, call OpenAI, or enter real check history.

Official references:
- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/guides/rate-limits
- https://developers.openai.com/api/docs/guides/error-codes

## 6. Local use and verification

Install dependencies with `npm install`, configure your local server variables, and start with `npm run dev`. Without a local `DATABASE_URL`, development uses an in-memory Postgres database that resets on restart. For a persistent local test against your Vercel-connected database, explicitly configure its `DATABASE_URL`, run `npm run db:migrate`, then `npm run admin:seed`. Use a separate development database when possible.

Commands included in this project:

```text
npm run typecheck
npm test
npm run test:payments
npm run test:ai-rate-limit
npm run test:factcheck
npm run build
```

The payment and rate-limit integration suites always use isolated in-memory databases and refuse to run with `DATABASE_URL` or `VERCEL` set. They include synthetic OpenAI responses; they never verify a real payment or spend real model quota. Run them from an environment without those variables.

The key setup, admin bootstrap, and receiving account settings must still be checked on your own deployment. See `VERIFICATION.md` for what was actually tested.
