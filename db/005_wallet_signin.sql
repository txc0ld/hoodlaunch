-- Account authentication only. No wallet keys, signatures, native Auth tokens or entitlements.
begin;
create table public.hood_auth_attempts (
 id uuid primary key,
 binding_hash text check (binding_hash ~ '^[0-9a-f]{64}$'),
 method text check (method in ('wallet','email')),
 state text not null check (state in ('pending','verifying','complete','canceled')),
 details jsonb,
 expires_at timestamptz not null,
 retain_until timestamptz not null,
 issued_session_hash text unique check (issued_session_hash ~ '^[0-9a-f]{64}$')
);
create index hood_auth_attempts_binding on public.hood_auth_attempts(binding_hash);
create index hood_auth_attempts_retention on public.hood_auth_attempts(retain_until);
alter table public.hood_auth_attempts enable row level security;
revoke all on public.hood_auth_attempts from public,anon,authenticated;
grant all on public.hood_auth_attempts to service_role;

-- A short global lock deliberately serializes publication/revocation at the admitted
-- authentication rate. No provider call occurs in this transaction. No reverse session
-- FK: deleting a session elsewhere cannot invert the authentication lock order.
create function public.hood_auth_attempt(p_action text,p_id uuid,p_binding text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.hood_auth_attempts; t timestamptz; expiry timestamptz; started timestamptz; token text; uid uuid;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'invalid payload'; end if;
 if p_action not in ('begin','claim','finish','cancel','logout') then raise exception 'invalid action'; end if;
 if p_action<>'logout' and (p_id is null or p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'invalid id'; end if;
 if p_action not in ('cancel','logout') and (p_binding is null or p_binding !~ '^[0-9a-f]{64}$') then raise exception 'invalid binding'; end if;
 if p_action='logout' and p_binding is not null and p_binding !~ '^[0-9a-f]{64}$' then raise exception 'invalid binding'; end if;
 perform pg_advisory_xact_lock(741809,5001);
 t:=clock_timestamp();
 -- Bounded cleanup; retention always outlives both accepted request age and session life.
 delete from public.hood_auth_attempts where id in (select id from public.hood_auth_attempts where retain_until<t order by retain_until limit 128);
 if p_action='logout' then
   token:=p_payload->>'sessionHash';
   if token is not null and token !~ '^[0-9a-f]{64}$' then raise exception 'invalid session'; end if;
   delete from public.hood_sessions where token_hash=token or token_hash in (select issued_session_hash from public.hood_auth_attempts where binding_hash=p_binding);
   update public.hood_auth_attempts set state='canceled' where binding_hash=p_binding;
   return jsonb_build_object('canceled',true);
 end if;
 select * into a from public.hood_auth_attempts where id=p_id;
 if p_action='cancel' then
   if found then
     delete from public.hood_sessions where token_hash=a.issued_session_hash;
     update public.hood_auth_attempts set state='canceled' where id=p_id;
   else
     -- Cancel may arrive before begin. The ID cannot be resurrected by a late request.
     insert into public.hood_auth_attempts(id,state,expires_at,retain_until) values(p_id,'canceled',t,t+interval '24 hours');
   end if;
   return jsonb_build_object('canceled',true);
 end if;
 if p_action='begin' then
   if found then return null; end if;
   started:=(p_payload->>'requestStartedAt')::timestamptz;
   expiry:=(p_payload->>'expiresAt')::timestamptz;
   if started is null or started<t-interval '5 minutes' or started>t+interval '30 seconds' or
      expiry is null or expiry<=t or expiry>t+interval '5 minutes' or
      p_payload->>'method' is null or p_payload->>'method' not in ('wallet','email') then raise exception 'invalid attempt'; end if;
   delete from public.hood_sessions where token_hash in (select issued_session_hash from public.hood_auth_attempts where binding_hash=p_binding);
   update public.hood_auth_attempts set state='canceled' where binding_hash=p_binding;
   insert into public.hood_auth_attempts(id,binding_hash,method,state,details,expires_at,retain_until)
   values(p_id,p_binding,p_payload->>'method',case when p_payload->>'method'='wallet' then 'pending' else 'verifying' end,p_payload,expiry,t+interval '24 hours');
   return jsonb_build_object('started',true);
 end if;
 if not found or a.binding_hash is distinct from p_binding or a.expires_at<=t then return null; end if;
 if p_action='claim' then
   if a.method<>'wallet' or a.state<>'pending' then return null; end if;
   update public.hood_auth_attempts set state='verifying' where id=p_id;
   return a.details;
 end if;
 if a.state<>'verifying' then return null; end if;
 token:=p_payload->>'sessionHash'; uid:=(p_payload->>'userId')::uuid;
 if token is null or token !~ '^[0-9a-f]{64}$' or uid is null then raise exception 'invalid session'; end if;
 insert into public.hood_sessions(token_hash,user_id,expires_at) values(token,uid,t+interval '1 hour');
 update public.hood_auth_attempts set state='complete',issued_session_hash=token where id=p_id;
 return jsonb_build_object('signedIn',true);
end $$;
revoke all on function public.hood_auth_attempt(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.hood_auth_attempt(text,uuid,text,jsonb) to service_role;
commit;
