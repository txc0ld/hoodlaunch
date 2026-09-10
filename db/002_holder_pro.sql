-- Apply after 001_public_services.sql in the business Supabase project.
begin;
create table public.hood_holder_wallets (
 user_id uuid primary key references auth.users(id) on delete cascade,
 address text unique not null check (address ~ '^0x[0-9a-f]{40}$' and address <> '0x0000000000000000000000000000000000000000'),
 unique(user_id,address)
);
create table public.hood_holder_challenges (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 session_hash text not null references public.hood_sessions(token_hash) on delete cascade,
 address text not null check (address ~ '^0x[0-9a-f]{40}$'), nonce text unique not null check (nonce ~ '^[0-9a-f]{32}$'),
 message text not null check (length(message) between 100 and 2048), issued_at timestamptz not null,
 expires_at timestamptz not null, consumed boolean not null default false,
 check (expires_at > issued_at and expires_at <= issued_at + interval '5 minutes')
);
create table public.hood_holder_proofs (
 session_hash text primary key references public.hood_sessions(token_hash) on delete cascade,
 user_id uuid not null, address text not null, proof_id uuid unique not null default gen_random_uuid(),
 foreign key(user_id,address) references public.hood_holder_wallets(user_id,address) on delete cascade
);
alter table public.hood_holder_wallets enable row level security;
alter table public.hood_holder_challenges enable row level security;
alter table public.hood_holder_proofs enable row level security;
revoke all on public.hood_holder_wallets,public.hood_holder_challenges,public.hood_holder_proofs from anon,authenticated;
grant all on public.hood_holder_wallets,public.hood_holder_challenges,public.hood_holder_proofs to service_role;

-- Every mutation shares one account lock; the session row lock serializes consume with logout.
create function public.hood_holder_session(p_user uuid,p_session text) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare expiry timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select expires_at into expiry from public.hood_sessions where token_hash=p_session and user_id=p_user for update;
 if expiry is null or expiry<=clock_timestamp() then raise exception 'holder session expired'; end if;
 return expiry;
end $$;
create function public.hood_holder_context(p_user uuid,p_session text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare expiry timestamptz; wallet text; proof uuid;
begin
 expiry:=public.hood_holder_session(p_user,p_session);
 select address into wallet from public.hood_holder_wallets where user_id=p_user;
 select proof_id into proof from public.hood_holder_proofs where user_id=p_user and session_hash=p_session and address=wallet;
 return jsonb_build_object('address',wallet,'proof_id',proof,'expires_at',expiry);
end $$;
create function public.hood_holder_challenge(p_user uuid,p_session text,p_id uuid,p_address text,p_nonce text,p_message text,p_issued timestamptz,p_expires timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare expiry timestamptz; wallet text;
begin
 expiry:=public.hood_holder_session(p_user,p_session);
 select address into wallet from public.hood_holder_wallets where user_id=p_user;
 if wallet is not null and wallet<>p_address then raise exception 'unlink before replacing wallet'; end if;
 if p_expires>expiry or p_expires>clock_timestamp()+interval '5 minutes' or p_expires<=clock_timestamp() or p_issued>clock_timestamp()+interval '30 seconds' or p_issued<clock_timestamp()-interval '30 seconds' then raise exception 'invalid challenge time'; end if;
 insert into public.hood_holder_challenges(id,user_id,session_hash,address,nonce,message,issued_at,expires_at)
 values(p_id,p_user,p_session,p_address,p_nonce,p_message,p_issued,p_expires);
 return true;
end $$;
create function public.hood_holder_read_challenge(p_user uuid,p_session text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.hood_holder_challenges;
begin
 perform public.hood_holder_session(p_user,p_session);
 select * into c from public.hood_holder_challenges where id=p_id and user_id=p_user and session_hash=p_session and not consumed and expires_at>clock_timestamp();
 if not found then raise exception 'challenge unavailable'; end if;
 return to_jsonb(c);
end $$;
create function public.hood_holder_consume(p_user uuid,p_session text,p_id uuid,p_address text,p_message text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.hood_holder_challenges; wallet text;
begin
 perform public.hood_holder_session(p_user,p_session);
 select * into c from public.hood_holder_challenges where id=p_id and user_id=p_user and session_hash=p_session and not consumed for update;
 if not found or c.expires_at<=clock_timestamp() or c.address is distinct from p_address or c.message is distinct from p_message then raise exception 'challenge unavailable'; end if;
 select address into wallet from public.hood_holder_wallets where user_id=p_user;
 if wallet is not null and wallet<>p_address then raise exception 'unlink before replacing wallet'; end if;
 insert into public.hood_holder_wallets(user_id,address) values(p_user,p_address) on conflict(user_id) do nothing;
 update public.hood_holder_challenges set consumed=true where id=p_id;
 insert into public.hood_holder_proofs(session_hash,user_id,address) values(p_session,p_user,p_address)
 on conflict(session_hash) do update set user_id=excluded.user_id,address=excluded.address,proof_id=gen_random_uuid();
 -- Recheck after possible uniqueness/FK waits; a stale transaction timestamp cannot extend authority.
 perform public.hood_holder_session(p_user,p_session);
 if c.expires_at<=clock_timestamp() then raise exception 'challenge expired during bind'; end if;
 return true;
end $$;
create function public.hood_holder_unlink(p_user uuid,p_session text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform public.hood_holder_session(p_user,p_session);
 delete from public.hood_holder_challenges where user_id=p_user;
 delete from public.hood_holder_wallets where user_id=p_user;
 return true;
end $$;
revoke all on function public.hood_holder_session(uuid,text),public.hood_holder_context(uuid,text),public.hood_holder_challenge(uuid,text,uuid,text,text,text,timestamptz,timestamptz),public.hood_holder_read_challenge(uuid,text,uuid),public.hood_holder_consume(uuid,text,uuid,text,text),public.hood_holder_unlink(uuid,text) from public,anon,authenticated;
grant execute on function public.hood_holder_context(uuid,text),public.hood_holder_challenge(uuid,text,uuid,text,text,text,timestamptz,timestamptz),public.hood_holder_read_challenge(uuid,text,uuid),public.hood_holder_consume(uuid,text,uuid,text,text),public.hood_holder_unlink(uuid,text) to service_role;
commit;
