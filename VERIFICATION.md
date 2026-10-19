# Verification record

## Busy / timeout follow-up to the 19 October 2026 release

| Check | Result |
| --- | --- |
| `npm run typecheck` and `npm run build` | Passed for the final source; Nitro/Vercel output generated. Local build skipped real database migration and admin seeding because no hosted database was configured. |
| `npm test` | Passed: 197 script tests and 59 TypeScript tests (256 total). |
| `npm run test:ai-rate-limit` | Passed: 19 scenarios. Includes a held 36-second lease producing a short capacity retry without releasing the active owner; timeout cleanup without duplicate POSTs; provider errors retaining safe diagnostics; no invented quota countdown; recovered credit availability; real Retry-After preservation; unexpected credential-store failure cleanup; and existing pacing/failover/lease/media checks. |
| `npm run test:factcheck` | Passed: 20 scenarios. Includes server-rendered pending state with no fabricated completed stages and distinct busy/quota/timeout messages in Indonesian and English, alongside the existing claim/evidence/report checks. |
| `npm run test:payments` | Passed: 14 scenarios. Includes repeated saved busy checks returning HTTP 503 / `busy` while keeping exactly one consumed attempt and one order; real provider rate-limit retries still return HTTP 429 and retain Retry-After. |
| Browser and live provider verification | Not run. The managed environment has no supported browser-control path. All provider responses were synthetic, and no live OpenAI key, Vercel database or deployment credentials were used. |

The observed production `busy` response established how the app classified the failure, not whether the original cause was an active worker, an interrupted worker or a transient-error pause. This patch distinguishes those origins for future failures and corrects request handling; it does not claim to prove the cause of the earlier production failure or guarantee live news checks succeed. Shared capacity remains one in-flight request; genuine provider waits and existing saved deadlines are not erased. New diagnostics omit submitted URLs, article content, keys, cookies and raw provider messages.

## 19 October 2026 — OpenAI and Real / Nah

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; Nitro/Vercel output generated with `maxDuration: 180`. No live database was configured. |
| `npm test` | Passed: 197 script unit tests and 59 TypeScript unit tests. |
| `npm run test:factcheck` | Passed: 19 targeted scenarios using synthetic search/model evidence and an isolated PGlite database. |
| `npm run test:ai-rate-limit` | Passed: 13 scenarios, including slow response bodies retaining their lease. |
| `npm run test:payments` | Passed: 13 account/payment/order scenarios with simulated OpenAI responses. |
| Report rendering | React server rendering passed for Indonesian and English Real, Nah and correction examples; evidence links, date context, strike-through, correction markers and removal of numeric scores were asserted. The standalone HTML uses the same Report component. |
| Brand assets / whitespace | Brand check passed against this project's actual root with no warnings; `git diff --check` passed. |
| Browser interaction, screenshots and responsive visual QA | **Not run for this update.** The current managed environment has no supported control-browser capability; its Sites workflow forbids an improvised preview/browser path. Earlier dated browser checks below apply only to earlier code. |
| Live OpenAI key, real news/video, Vercel deployment | **Not tested.** No user OpenAI key, hosted database or deployment credentials were provided. |

The fact-check scenarios cover: mixed true/false core claims, all-supported claims, minor corrections, material errors, unresolved causation, missing/fabricated evidence, publisher-only and homepage references, safe provenance URLs, incomplete input, separate link safety, structured article extraction, historical dates and metadata, forced web-search/strict-schema requests, truncated articles, incomplete/refused/malformed provider outputs, blocked articles and untranscribed video, multipart MP4 transcription, caption utilities, no legacy-provider fallback, and report/copy rendering. Related assertions are grouped in 19 scenarios.

Rate-limit tests cover Retry-After seconds/dates, OpenAI request/token resets, exponential backoff and jitter, one in-flight call across shared database leases, slow-body and delayed-worker spacing, same-key 429 recovery, cross-key shared cooldown, exhausted credit/spend quota, bounded attempts, invalid-key cooldown, stale-lease recovery, no search-free 400 fallback, and stopping on a transcription 429.

These are deterministic integration and rendering checks, not a measurement of real-world fact-check accuracy. A source URL appearing in OpenAI's retrieved evidence establishes provenance, not proof that the source entails every assertion. Source relevance, event dates, numerical interpretation, and causation still depend on the model's evidence analysis. Hosted Postgres contention, Vercel scheduling, actual model/tool access, social-platform media accessibility, browser hydration, touch layouts, and real provider latency remain unverified in this update.

The standalone preview contains only explicitly labeled simulated IHSG cases; it has no live link checker and no API credentials. No real bank transfer or external message was sent. No screenshots are included in the artifacts.

## 18 October 2026 — rate-limit update

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; Vercel/Nitro output generated with the new migration included. |
| `npm test` | Passed: 197 script unit tests and 59 TypeScript unit tests. |
| `npm run test:payments` | Passed: 13 isolated integration scenarios, including persisted 429 retry times and no additional attempt use. |
| `npm run test:ai-rate-limit` | Passed: 12 targeted rate-limit scenarios. |
| Desktop/mobile browser interaction | Passed: countdown display, disabled retry, cooldown restored after reload, direct repeat request rejected, and recovery to a saved report using the same order. |
| Development and production rendering | Passed at 1280 × 800 and 390 × 844, with visible content, no horizontal overflow or uncaught page errors. Homepage smoke checks had no console errors. |
| Existing brand assets and whitespace | Passed the brand check against the actual project directory and `git diff --check`. |

The 12 rate-limit scenarios cover `Retry-After` seconds and HTTP dates, Google `RetryInfo`, exponential backoff and jitter, conservative configuration defaults, concurrent shared pacing, spacing despite delayed workers, same-key recovery after 429, shared cooldowns across keys, daily quota handling, maximum attempts, persisted rejected-key cooldowns, stale-lease recovery, avoiding unnecessary generic-400 fallback calls, and stopping media processing after a transcription 429. Several related assertions are grouped into one scenario.

The browser recovery fixture produced exactly two model calls: the initial simulated 429 and one successful call after the cooldown. Repeated requests and reloading during the cooldown did not add a model call or create another check. The automatic body-text baseline comparison flagged a desktop snapshot difference; the development and production screenshots were inspected and showed matching app layout and content.

These checks used simulated Gemini responses and isolated PGlite databases. They did not call the live Gemini service, access your Vercel database, or consume live quota. Shared coordination is implemented through atomic Postgres statements; hosted PostgreSQL contention and real Vercel instance scheduling have not been load-tested here. Third-party fonts and platform chrome were stubbed in the restricted review browser, as in the earlier verification. The app's account, check, and retry requests ran normally.

## 17 October 2026 — initial account and transfer update

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; Vercel/Nitro output generated. |
| `npm test` | Passed: 197 script unit tests and 59 TypeScript unit tests. |
| `npm run test:payments` | Passed: 12 integration scenarios using an isolated PGlite database. |
| Desktop and mobile development rendering | Passed at 1280 × 800 and 390 × 844; visible content, no horizontal overflow or uncaught page errors. |
| Desktop and mobile production rendering | Passed with no divergence reported against the development smoke baseline. |
| Existing brand assets | Passed the project's brand check using the actual project directory. |
| Source whitespace check | `git diff --check` passed. |

The browser flows also passed:

1. Registration and login page rendering on desktop/mobile, including a real browser signup.
2. Creating and submitting a transfer invoice without prematurely receiving a credit.
3. Signing in with the supplied bootstrap admin credentials and granting an Advance attempt by username.
4. Approving the submitted invoice through the admin amount/reference form.
5. Opening the account-bound Advance link, failing a synthetic AI request, retrying without another payment or attempt, and recovering to a saved report.
6. Signing out and confirming that the session ends.

The integration scenarios cover case-insensitive and racing duplicate usernames, blocked privilege escalation, admin-only actions, account ownership of orders and attempts, atomic credit consumption, repeat approvals, bank reference reuse, expired payments, processing claims, free admin checks, ordered API-key failover, and stored-report reuse. Invalid-key cooldowns retain a configuration error rather than incorrectly becoming a quota error.

Test boundaries:

- No real bank transfer, bank API, or live Vercel database was accessed. The receiving bank details remain for you to configure.
- AI responses and key exhaustion were simulated; no real Gemini key or model quota was used. Your model's availability, grounding support, quotas, and key permissions must be verified with your project.
- Database tests use in-memory PGlite. They exercise repeated and simultaneous HTTP requests, but do not measure hosted PostgreSQL lock contention or serverless concurrency.
- Browser checks used Playwright because the template's interactive browser CLI was unavailable. Third-party fonts and platform chrome were stubbed in the restricted review browser; the app's local assets and all account/payment requests ran normally. Screenshots were inspected locally and are not included in the deliverable.
- The stock smoke helper looks for branding at `/workspace`, which is different from this extracted project's root. Its branding note was a path mismatch; the separate brand check against the actual project directory passed with no warnings.

During review, the login form was changed to remain disabled until its initial account state is loaded, preventing inputs typed before hydration from being cleared. The full browser flow passed after this change.
