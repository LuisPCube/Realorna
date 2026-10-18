alter table "user" add column if not exists "username" text;
alter table "user" add column if not exists "displayUsername" text;
create unique index if not exists user_username_unique on "user" ("username");
create unique index if not exists user_username_case_unique on "user" (lower("username"));

create table if not exists "rateLimit" (
  "id" text primary key,
  "key" text not null unique,
  "count" integer not null,
  "lastRequest" bigint not null
);

create table if not exists fact_user_roles (
  user_id text primary key references "user" (id) on delete cascade,
  role text not null check (role in ('admin', 'user')) default 'user'
);

-- Old, unowned Midtrans orders remain unowned and cannot be accessed by users.
alter table fact_orders add column if not exists user_id text references "user" (id);
alter table fact_orders add column if not exists payment_method text not null default 'legacy';
alter table fact_orders add column if not exists request_key text;
alter table fact_orders add column if not exists transfer_reference text;
alter table fact_orders add column if not exists bank_reference text;
alter table fact_orders add column if not exists paid_at timestamptz;
alter table fact_orders add column if not exists expires_at timestamptz;
alter table fact_orders add column if not exists approved_by text references "user" (id);
alter table fact_orders add column if not exists claim_token text;
alter table fact_orders add column if not exists credit_attempt_id text;
create unique index if not exists fact_order_request_unique on fact_orders (user_id, request_key);
create unique index if not exists fact_bank_reference_unique on fact_orders (lower(bank_reference));
create index if not exists fact_order_user_idx on fact_orders (user_id, created_at desc);

create table if not exists fact_attempts (
  attempt_id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  plan text not null check (plan in ('regular', 'advance')),
  status text not null default 'ready' check (status in ('ready', 'used')),
  source text not null check (source in ('admin', 'transfer')),
  source_order_id text unique references fact_orders (order_id),
  granted_by text not null references "user" (id),
  request_key text not null,
  used_order_id text unique references fact_orders (order_id),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  unique (granted_by, request_key)
);
create index if not exists fact_attempt_user_idx on fact_attempts (user_id, plan, status);

create table if not exists fact_admin_audit (
  audit_id text primary key,
  admin_id text not null references "user" (id),
  action text not null,
  target_user_id text not null references "user" (id),
  attempt_id text references fact_attempts (attempt_id),
  order_id text references fact_orders (order_id),
  note text,
  created_at timestamptz not null default now()
);
