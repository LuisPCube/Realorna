# Busy, timeout and quota correction

The observed response was `{"error":"rate","retry_after_seconds":36,"retry_reason":"busy"}`. In the earlier code, this meant the application's shared gate reported busy capacity. It could reflect another in-flight request, an unexpired lease left by an interrupted worker, or a pause after a connection/provider-server failure. It did not establish that OpenAI rejected a fresh request for insufficient credits. The original response did not retain enough diagnostic information to distinguish those cases.

## What changed

| Result | HTTP | Behavior |
| --- | --- | --- |
| `ai_busy` | 503 | The shared slot or transient-error pause is occupied. Honor `Retry-After`, then retry the same saved check. |
| `rate` | 429 | A temporary request/token limit or local pacing delay applies. Honor `Retry-After`; real provider minimum delays remain enforced. |
| `ai_quota` | 503 | Credits or enforced usage/spending limits require admin action. No automatic retries and no invented one-hour countdown. Actual provider delay hints remain enforced. |
| `ai_timeout` | 504 | The request exceeded its allotted time. The app releases its lease and does not silently repeat a timed-out POST. Retry the saved check manually. |
| `ai_unavailable` | 503 | Configuration, credentials, model or access needs attention. |
| `ai_failed` | 502 | A provider/connection/output failure prevented a usable report. Inspect safe diagnostics. |

The app still uses one shared in-flight request and minimum pacing across configured keys, users, transcription and fact checks. It does not disable provider limits or promise immediate capacity to simultaneous users. Slot waiting defaults to 30 seconds (previously 15). The overall check stays bounded at 120 seconds, with up to 90 seconds for an outbound request rather than the previous 45. The lease expiry matches the request's allowed time plus a cleanup margin and has token-protected release, including unexpected failure paths.

For an occupied request lease, the app offers a short capacity retry (normally 3 seconds, or longer if minimum pacing still applies), rather than making the user wait until the lease's crash-recovery expiry. The active lease stays intact. Actual shared provider delays are still honored in full. The pending indicator no longer marks reading/scanning/comparing complete on a 1.8-second timer. It shows that verification is pending and displays elapsed time. This is not a percentage or live per-stage progress feed.

No new database migration or environment variable is required for this patch. Accounts, payments and attempts are retained. Saved busy retries retain their busy classification and do not consume another attempt. A timeout can still incur provider usage even though the app received no result; it is not treated as proof that no API work occurred.

## Deploy this version

1. Replace the deployed project source with the updated ZIP, including the new `ai-errors.ts` and `check-errors.ts` modules. Keep your configured secrets and connected database.
2. Redeploy on Vercel. If `OPENAI_MAX_QUEUE_WAIT_MS` is explicitly set to `15000`, change it to `30000` to use the revised wait; leaving the variable unset also uses 30000. Existing environment values override defaults.
3. Reload the website after deployment. Let an existing short busy countdown finish, then retry the saved check. Do not create a second paid check for the same failure.

The patch does not force-clear active request leases, key rejection cooldowns, or stored provider delays. An older hour-long timer already saved in Postgres is not erased by deploying new code. Earlier versions did not record whether that deadline was an actual provider hint or the fallback, so investigate it before manually resetting it. Adding API credit does not update the app's saved database timestamps. The configured API key must belong to the funded OpenAI organization.

## If a fresh retry still fails

Open the failed `analyze` request's Response tab. A new response contains a UUID `support_id`. Its diagnostic fields distinguish:

- `app_queue`: another request's lease is still occupied;
- `app_pacing`: the local minimum-spacing interval is still active;
- `app_cooldown`: a saved shared delay is active;
- `saved_check`: this particular order's saved retry delay is still active;
- `transport` / `deadline`: a connection or time-budget failure;
- `openai`: a provider response or unusable provider output.

Provider status, error code and request ID are included only when known. Their absence must not be interpreted as a particular billing result. Match `support_id` to `[realorna] check_failed` in Vercel's server logs. Responses and these logs omit API keys, cookies, article contents, submitted URLs and raw provider error messages. New outbound requests also supply `X-Client-Request-Id` for provider troubleshooting.

To inspect the shared state without changing it, an admin can run this read-only query in the connected Postgres SQL editor while the busy error is occurring:

```sql
SELECT scope, block_reason, failure_count,
       next_request_at, blocked_until, lease_until,
       GREATEST(0, CEIL(EXTRACT(EPOCH FROM (lease_until - NOW())))) AS lease_seconds_left,
       GREATEST(0, CEIL(EXTRACT(EPOCH FROM (blocked_until - NOW())))) AS cooldown_seconds_left
FROM fact_ai_throttle
WHERE scope = 'openai';
```

Do not clear an active lease merely to permit overlapping tests. Expired leases recover automatically. These corrections improve request handling and diagnosis; successful calls with your actual OpenAI project and Vercel database still require a live verification after deployment.

Official references: https://developers.openai.com/api/docs/guides/rate-limits, https://developers.openai.com/api/docs/guides/error-codes, https://developers.openai.com/api/reference/overview
