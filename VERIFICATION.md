# Verification — 17 October 2026

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
