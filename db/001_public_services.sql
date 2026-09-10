-- Apply once to a NEW business Supabase project. No local owner data is migrated.
begin;
create table public.hood_sessions (
 token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null
);
create index hood_sessions_expiry on public.hood_sessions(expires_at);
create table public.hood_billing (
 user_id uuid primary key references auth.users(id) on delete cascade,
 customer_id text unique not null check (customer_id ~ '^cus_[A-Za-z0-9]+$')
);
create table public.hood_quota (
 bucket text primary key,
 used integer not null check (used > 0),
 expires_at timestamptz not null
);
alter table public.hood_sessions enable row level security;
alter table public.hood_billing enable row level security;
alter table public.hood_quota enable row level security;
revoke all on public.hood_sessions, public.hood_billing, public.hood_quota from anon, authenticated;
-- Atomic admission across all Vercel instances; denied requests never exceed cap.
create function public.hood_take_quota(p_bucket text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
 if length(p_bucket) > 160 or p_limit < 1 or p_limit > 10000 or p_seconds < 1 or p_seconds > 2678400 then raise exception 'invalid quota'; end if;
 insert into public.hood_quota as q(bucket,used,expires_at)
 values(p_bucket,1,now()+make_interval(secs=>p_seconds))
 on conflict(bucket) do update set used = case when q.expires_at <= now() then 1 else q.used+1 end,
 expires_at = case when q.expires_at <= now() then now()+make_interval(secs=>p_seconds) else q.expires_at end
 where q.expires_at <= now() or q.used < p_limit
 returning used into n;
 return n is not null;
end $$;
revoke all on function public.hood_take_quota(text,integer,integer) from public, anon, authenticated;
grant execute on function public.hood_take_quota(text,integer,integer) to service_role;
grant all on public.hood_sessions, public.hood_billing, public.hood_quota to service_role;
-- Schedule daily in Supabase (not request paths):
-- delete from public.hood_sessions where expires_at < now();
-- delete from public.hood_quota where expires_at < now() - interval '1 day';
-- Serialize checkout creation so parallel clicks cannot open two paid subscriptions.
alter table public.hood_billing add column checkout_key uuid, add column checkout_started timestamptz;
create function public.hood_checkout_key(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare k uuid;
begin
 perform 1 from public.hood_billing where user_id = p_user for update;
 update public.hood_billing set checkout_key = gen_random_uuid(), checkout_started = now()
 where user_id = p_user and (checkout_key is null or checkout_started < now() - interval '25 hours');
 select checkout_key into k from public.hood_billing where user_id = p_user;
 return k;
end $$;
revoke all on function public.hood_checkout_key(uuid) from public,anon,authenticated;
grant execute on function public.hood_checkout_key(uuid) to service_role;

commit;
