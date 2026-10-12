create table if not exists fact_orders (
  order_id text primary key,
  url text not null,
  plan text not null,
  lang text not null,
  amount integer not null,
  status text not null,
  qr_url text,
  qr_string text,
  demo boolean not null default false,
  result_json text,
  report_json text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fact_orders_status_idx on fact_orders (status);
