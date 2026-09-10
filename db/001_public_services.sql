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
-- One durable checkout intent per account. Time alone never rotates an uncertain request.
-- Full Stripe request parameters remain immutable for each idempotency key.
alter table public.hood_billing add column checkout_key uuid, add column checkout_started timestamptz,
 add column checkout_expires_at bigint, add column checkout_request jsonb,
 add column checkout_session_id text check (checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
 add column checkout_subscription_id text check (checkout_subscription_id ~ '^sub_[A-Za-z0-9]+$');
create function public.hood_checkout_reserve(p_user uuid, p_request jsonb, p_expected_key uuid default null, p_expired_session text default null, p_canceled_subscription text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.hood_billing; expiry bigint;
begin
 select * into b from public.hood_billing where user_id=p_user for update;
 if not found then raise exception 'billing account missing'; end if;
 if p_request is null or jsonb_typeof(p_request) <> 'object' or p_request ? 'expires_at' or
    p_request->>'customer' is distinct from b.customer_id or p_request->>'mode' is distinct from 'subscription' or
    p_request->>'client_reference_id' is distinct from p_user::text then raise exception 'invalid checkout request'; end if;
 if b.checkout_key is not null then
   if b.checkout_request - 'expires_at' is distinct from p_request then raise exception 'checkout configuration changed; reconcile existing intent'; end if;
   -- Only a verified expired session or its verified terminal canceled subscription authorizes rotation.
   -- A concurrent winner is returned unchanged; unknown/sessionless reservations never rotate.
   if p_expected_key is null or b.checkout_key <> p_expected_key or b.checkout_session_id is null or
      p_expired_session is null or b.checkout_session_id <> p_expired_session or
      (p_canceled_subscription is null and b.checkout_subscription_id is not null) or
      (p_canceled_subscription is not null and b.checkout_subscription_id is distinct from p_canceled_subscription) then
     return jsonb_build_object('key',b.checkout_key,'expires_at',b.checkout_expires_at,'request',b.checkout_request,'session_id',b.checkout_session_id,'subscription_id',b.checkout_subscription_id);
   end if;
 end if;
 expiry := floor(extract(epoch from now()))::bigint + 23*60*60;
 update public.hood_billing set checkout_key=gen_random_uuid(),checkout_started=now(),checkout_expires_at=expiry,
   checkout_request=p_request || jsonb_build_object('expires_at',expiry),checkout_session_id=null,checkout_subscription_id=null
   where user_id=p_user returning * into b;
 return jsonb_build_object('key',b.checkout_key,'expires_at',b.checkout_expires_at,'request',b.checkout_request,'session_id',b.checkout_session_id,'subscription_id',b.checkout_subscription_id);
end $$;
create function public.hood_checkout_bind(p_user uuid,p_key uuid,p_session text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
 if p_session is null or p_session !~ '^cs_[A-Za-z0-9_]+$' then raise exception 'invalid checkout session'; end if;
 update public.hood_billing set checkout_session_id=p_session
 where user_id=p_user and checkout_key=p_key and (checkout_session_id is null or checkout_session_id=p_session);
 get diagnostics changed = row_count;
 return changed=1;
end $$;
create function public.hood_checkout_bind_subscription(p_user uuid,p_key uuid,p_session text,p_subscription text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
 if p_subscription is null or p_subscription !~ '^sub_[A-Za-z0-9]+$' then raise exception 'invalid subscription'; end if;
 update public.hood_billing set checkout_subscription_id=p_subscription
 where user_id=p_user and checkout_key=p_key and checkout_session_id=p_session
   and (checkout_subscription_id is null or checkout_subscription_id=p_subscription);
 get diagnostics changed = row_count;
 return changed=1;
end $$;
revoke all on function public.hood_checkout_reserve(uuid,jsonb,uuid,text,text), public.hood_checkout_bind(uuid,uuid,text), public.hood_checkout_bind_subscription(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.hood_checkout_reserve(uuid,jsonb,uuid,text,text), public.hood_checkout_bind(uuid,uuid,text), public.hood_checkout_bind_subscription(uuid,uuid,text,text) to service_role;

commit;
