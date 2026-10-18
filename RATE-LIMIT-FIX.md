# Gemini 429 fix — 18 October 2026

Deploy the updated project in your existing Vercel project. Keep your existing database, bank settings, admin credentials, `GEMINI_API_KEYS` / `GEMINI_API_KEY`, and `GEMINI_MODEL` settings.

1. Replace the old source with this updated source, keeping your private environment settings.
2. Use the existing Vercel build command: `npm run build`.
3. The build applies **`migrations/0004_ai_throttle.sql`** automatically. It adds the shared request gate, hashed-key cooldowns, and a retry-time column. It does not drop your existing accounts, attempts, or orders.
4. Redeploy, then retry the saved failed check from **Payments & recent checks**. A retry reuses that check's original attempt.

What changed:

- Gemini calls are serialized and spaced through Postgres, including across multiple Vercel instances. Default spacing: **12 seconds between call starts**.
- Transcription and fact checking use the same gate. A transcription 429 stops the rest of that analysis instead of trying more media and then immediately calling Gemini again.
- Transient failures use exponential backoff plus jitter, with **at most three attempts per provider operation** by default.
- Retry delays from Google's `Retry-After` header and `RetryInfo` are honored. Long delays return to the browser as a countdown instead of holding a server request indefinitely.
- 429 responses create a shared cooldown. The app no longer immediately switches keys after 429.
- Repeated clicks or direct analysis requests during a saved check's cooldown are rejected before another AI call. The cooldown survives page reloads.
- Generic HTTP 400 errors no longer cause an unnecessary second request without Google Search. That fallback is limited to explicit search/tool compatibility errors.

You do not need to add new rate-limit settings. The defaults are active automatically. If your model's request allowance is lower, increase `GEMINI_MIN_INTERVAL_MS` in **Vercel → Project → Settings → Environment Variables**, then redeploy. For example, a 2-request-per-minute allowance needs at least `30000` milliseconds between starts; allow some margin and account for other applications using the same project. See `SETUP.md` for all settings.

This prevents bursts; it cannot make an exhausted daily/token quota available. Recognized daily quota failures stop automatic retries. The UI may still show a handled 429 and countdown while the provider's limit is active. Your active model and project limits remain authoritative.

Core implementation:

| File | Responsibility |
| --- | --- |
| `src/realorna/backend/key-pool.ts` | Bounded provider attempts and credential failover. |
| `src/realorna/backend/gemini-throttle.ts` | Shared spacing, in-flight lease, and cooldown storage. |
| `src/realorna/backend/gemini-rate-policy.ts` | Retry delays, exponential backoff, jitter, and quota classification. |
| `migrations/0004_ai_throttle.sql` | Additive database schema for the gate and saved retry times. |
| `src/routes/api/analyze.ts` | HTTP 429 plus safe `Retry-After` feedback. |

Tests use simulated provider failures and an isolated PGlite database. They do not consume your live Gemini quota. See `VERIFICATION.md` for the validation record and limits.

Google references:

- https://ai.google.dev/gemini-api/docs/troubleshooting
- https://ai.google.dev/gemini-api/docs/rate-limits
