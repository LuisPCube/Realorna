# Rate limiting — OpenAI migration

The earlier Gemini fix is now implemented for OpenAI. See **OPENAI-REAL-NAH.md** for migration and **SETUP.md §5** for all options.

- `src/realorna/backend/ai-throttle.ts`: shared Postgres gate and lease, scope `openai`.
- `src/realorna/backend/ai-rate-policy.ts`: Retry-After/reset headers, backoff and quota classification.
- `src/realorna/backend/key-pool.ts`: ordered authorized credentials, bounded attempts, no immediate key hopping on 429.
- `migrations/0004_ai_throttle.sql`: existing shared storage, reused without dropping user data.

The browser countdown, persisted cooldown, and same-order retry behavior remain in place. Use `OPENAI_*` settings; `GEMINI_*` settings are no longer read. Pacing cannot increase project quotas or prepaid balance.

Official references: https://developers.openai.com/api/docs/guides/rate-limits and https://developers.openai.com/api/docs/guides/error-codes
