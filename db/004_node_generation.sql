-- Additive, service-only account allowances. Wallet material never enters these tables.
begin;
create table public.hood_node_cooldowns (
 user_id uuid primary key references auth.users(id) on delete cascade,
 next_eligible_at timestamptz not null
);
create table public.hood_node_attempts (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 wallet_count integer not null check(wallet_count between 1 and 50),
 reserved_at timestamptz not null,
 next_eligible_at timestamptz,
 primary key(user_id,request_id)
);
alter table public.hood_node_cooldowns enable row level security;
alter table public.hood_node_attempts enable row level security;
revoke all on public.hood_node_cooldowns, public.hood_node_attempts from public,anon,authenticated;
grant all on public.hood_node_cooldowns, public.hood_node_attempts to service_role;

create function public.hood_node_generation_status(p_user uuid,p_session text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare eligible timestamptz;
begin
 perform public.hood_holder_session(p_user,p_session);
 select next_eligible_at into eligible from public.hood_node_cooldowns where user_id=p_user;
 return jsonb_build_object('nextEligibleAt',eligible,'available',eligible is null or eligible<=clock_timestamp());
end $$;

create function public.hood_node_generation_reserve(p_user uuid,p_session text,p_request uuid,p_count integer,p_pro boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.hood_node_attempts; eligible timestamptz; reserved timestamptz;
begin
 -- Shared account/session lock also serializes holder entitlement and logout mutations.
 perform public.hood_holder_session(p_user,p_session);
 if p_request is null or p_count is null or p_count<1 or p_count>50 or p_pro is null or (not p_pro and p_count<>1) then raise exception 'invalid generation request'; end if;
 select * into prior from public.hood_node_attempts where user_id=p_user and request_id=p_request;
 if found then
  if prior.wallet_count<>p_count then raise exception 'generation request conflict'; end if;
  return jsonb_build_object('reserved',true,'requestId',prior.request_id,'count',prior.wallet_count,'reservedAt',prior.reserved_at,'nextEligibleAt',prior.next_eligible_at);
 end if;
 reserved:=clock_timestamp();
 if not p_pro then
  select next_eligible_at into eligible from public.hood_node_cooldowns where user_id=p_user;
  if eligible is not null and eligible>reserved then
   return jsonb_build_object('reserved',false,'nextEligibleAt',eligible);
  end if;
  eligible:=reserved+interval '24 hours';
  insert into public.hood_node_cooldowns(user_id,next_eligible_at) values(p_user,eligible)
  on conflict(user_id) do update set next_eligible_at=excluded.next_eligible_at;
 end if;
 insert into public.hood_node_attempts(user_id,request_id,wallet_count,reserved_at,next_eligible_at)
 values(p_user,p_request,p_count,reserved,eligible);
 -- A wait must not extend session authority. Exception rolls back both writes.
 perform public.hood_holder_session(p_user,p_session);
 return jsonb_build_object('reserved',true,'requestId',p_request,'count',p_count,'reservedAt',reserved,'nextEligibleAt',eligible);
end $$;
revoke all on function public.hood_node_generation_status(uuid,text), public.hood_node_generation_reserve(uuid,text,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.hood_node_generation_status(uuid,text), public.hood_node_generation_reserve(uuid,text,uuid,integer,boolean) to service_role;
commit;
