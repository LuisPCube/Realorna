-- One shared Gemini request gate, including across Vercel instances.
-- No API key or user content is stored here.
create table if not exists fact_ai_throttle (
  scope text primary key,
  next_request_at timestamptz not null default now(),
  blocked_until timestamptz not null default now(),
  block_reason text not null default 'rate',
  lease_id text,
  lease_until timestamptz,
  failure_count integer not null default 0
);

create table if not exists fact_ai_key_cooldowns (
  key_hash text primary key,
  disabled_until timestamptz not null
);

alter table fact_orders add column if not exists retry_after_at timestamptz;
