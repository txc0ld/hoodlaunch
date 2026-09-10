-- Apply only after independent review, and after 001_public_services.sql.
-- These snapshots are operational records. They never grant Pro access.
begin;

create table public.hood_subscription_snapshots (
 subscription_id text primary key check (subscription_id ~ '^sub_[A-Za-z0-9]+$' and length(subscription_id) <= 255),
 user_id uuid not null references auth.users(id) on delete cascade,
 customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9]+$' and length(customer_id) <= 255),
 price_id text not null check (price_id ~ '^price_[A-Za-z0-9]+$' and length(price_id) <= 255),
 status text not null check (status in ('active','canceled','incomplete','incomplete_expired','past_due','paused','trialing','unpaid')),
 current_period_end bigint not null check (current_period_end between 1 and 253402300799),
 cancel_at_period_end boolean not null,
 canceled_at bigint check (canceled_at between 0 and 253402300799),
 ended_at bigint check (ended_at between 0 and 253402300799),
 version bigint not null check (version between 1 and 9007199254740991),
 synced_at timestamptz not null default clock_timestamp(),
 unique (customer_id, subscription_id)
);

create table public.hood_subscription_events (
 event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$' and length(event_id) <= 255),
 event_type text not null check (event_type in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed')),
 subscription_id text not null check (subscription_id ~ '^sub_[A-Za-z0-9]+$' and length(subscription_id) <= 255),
 user_id uuid not null references auth.users(id) on delete cascade,
 customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9]+$' and length(customer_id) <= 255),
 version bigint not null check (version between 1 and 9007199254740991),
 started_at timestamptz not null default clock_timestamp(),
 processed_at timestamptz,
 unique (subscription_id, version)
);
create index hood_subscription_events_pending on public.hood_subscription_events(subscription_id) where processed_at is null;

alter table public.hood_subscription_snapshots enable row level security;
alter table public.hood_subscription_events enable row level security;
revoke all on public.hood_subscription_snapshots, public.hood_subscription_events from public, anon, authenticated;
grant all on public.hood_subscription_snapshots, public.hood_subscription_events to service_role;

create function public.hood_subscription_begin(p_event text,p_type text,p_subscription text,p_customer text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.hood_subscription_events; owner uuid; next_version bigint; had_existing boolean;
begin
 if p_event is null or p_event !~ '^evt_[A-Za-z0-9]+$' or length(p_event)>255 or
    p_subscription is null or p_subscription !~ '^sub_[A-Za-z0-9]+$' or length(p_subscription)>255 or
    p_customer is null or p_customer !~ '^cus_[A-Za-z0-9]+$' or length(p_customer)>255 or
    p_type is null or p_type not in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed') then
   raise exception 'invalid subscription event';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_subscription,0));
 select user_id into owner from public.hood_billing where customer_id=p_customer;
 if owner is null then return jsonb_build_object('ignored',true,'processed',false,'version',0); end if;
 select * into existing from public.hood_subscription_events where event_id=p_event for update;
 had_existing:=found;
 if found then
   if existing.subscription_id is distinct from p_subscription or existing.customer_id is distinct from p_customer or
      existing.user_id is distinct from owner or existing.event_type is distinct from p_type then raise exception 'subscription event identity changed'; end if;
   if existing.processed_at is not null then return jsonb_build_object('ignored',false,'processed',true,'version',existing.version); end if;
 end if;
 select coalesce(max(version),0)+1 into next_version from public.hood_subscription_events where subscription_id=p_subscription;
 if next_version>9007199254740991 then raise exception 'subscription version exhausted'; end if;
 if had_existing then
   update public.hood_subscription_events set version=next_version,started_at=clock_timestamp()
    where event_id=p_event;
 else
   insert into public.hood_subscription_events(event_id,event_type,subscription_id,user_id,customer_id,version)
    values(p_event,p_type,p_subscription,owner,p_customer,next_version);
 end if;
 return jsonb_build_object('ignored',false,'processed',false,'version',next_version);
end $$;

create function public.hood_subscription_complete(
 p_event text,p_subscription text,p_customer text,p_version bigint,p_price text,p_status text,p_period_end bigint,
 p_cancel_at_period_end boolean,p_canceled_at bigint,p_ended_at bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare pending public.hood_subscription_events; current_version bigint; bound uuid; changed integer;
begin
 if p_event is null or p_event !~ '^evt_[A-Za-z0-9]+$' or length(p_event)>255 or
    p_subscription is null or p_subscription !~ '^sub_[A-Za-z0-9]+$' or length(p_subscription)>255 or
    p_customer is null or p_customer !~ '^cus_[A-Za-z0-9]+$' or length(p_customer)>255 or
    p_price is null or p_price !~ '^price_[A-Za-z0-9]+$' or length(p_price)>255 or
    p_status is null or p_status not in ('active','canceled','incomplete','incomplete_expired','past_due','paused','trialing','unpaid') or
    p_version is null or p_version not between 1 and 9007199254740991 or
    p_period_end is null or p_period_end not between 1 and 253402300799 or
    p_cancel_at_period_end is null or (p_canceled_at is not null and p_canceled_at not between 0 and 253402300799) or
    (p_ended_at is not null and p_ended_at not between 0 and 253402300799) then raise exception 'invalid subscription snapshot';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_subscription,0));
 select max(version) into current_version from public.hood_subscription_events where subscription_id=p_subscription;
 if current_version is distinct from p_version then return false; end if;
 select * into pending from public.hood_subscription_events
  where event_id=p_event and subscription_id=p_subscription and customer_id=p_customer and version=p_version for update;
 if not found then return false; end if;
 -- Hold the exact ownership row through snapshot + receipt commit. A concurrent
 -- customer reassignment or delete cannot land after this validation but before commit.
 select user_id into bound from public.hood_billing where user_id=pending.user_id and customer_id=p_customer for share;
 if bound is null then return false; end if;
 if pending.processed_at is not null then
   return exists(select 1 from public.hood_subscription_snapshots where subscription_id=p_subscription and version=p_version and user_id=bound and customer_id=p_customer);
 end if;
 insert into public.hood_subscription_snapshots(subscription_id,user_id,customer_id,price_id,status,current_period_end,cancel_at_period_end,canceled_at,ended_at,version,synced_at)
 values(p_subscription,bound,p_customer,p_price,p_status,p_period_end,p_cancel_at_period_end,p_canceled_at,p_ended_at,p_version,clock_timestamp())
 on conflict(subscription_id) do update set user_id=excluded.user_id,customer_id=excluded.customer_id,price_id=excluded.price_id,
  status=excluded.status,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,
  canceled_at=excluded.canceled_at,ended_at=excluded.ended_at,version=excluded.version,synced_at=excluded.synced_at
 where public.hood_subscription_snapshots.version<excluded.version;
 get diagnostics changed = row_count;
 if changed<>1 then return false; end if;
 update public.hood_subscription_events set processed_at=clock_timestamp() where event_id=p_event and processed_at is null;
 get diagnostics changed = row_count;
 if changed<>1 then raise exception 'subscription receipt update failed'; end if;
 return true;
end $$;

revoke all on function public.hood_subscription_begin(text,text,text,text),
 public.hood_subscription_complete(text,text,text,bigint,text,text,bigint,boolean,bigint,bigint) from public, anon, authenticated;
grant execute on function public.hood_subscription_begin(text,text,text,text),
 public.hood_subscription_complete(text,text,text,bigint,text,text,bigint,boolean,bigint,bigint) to service_role;

commit;
