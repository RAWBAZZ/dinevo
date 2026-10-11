begin;
alter table public.d2_restaurants add column city text not null default '';
alter table public.d2_restaurants add column cuisines text[] not null default '{}';
alter table public.d2_restaurants add column is_test boolean not null default false;
alter table public.d2_restaurants add column creation_request uuid unique;
create table public.d2_admins(user_id uuid primary key references auth.users on delete cascade);
create table public.d2_claim_codes(restaurant_id uuid primary key references public.d2_restaurants on delete cascade,code_hash text unique not null,expires_at timestamptz not null,issued_by uuid not null references auth.users,claimed_by uuid references auth.users,claimed_at timestamptz);
create table public.d2_claim_attempts(user_id uuid primary key references auth.users on delete cascade,window_start timestamptz not null default now(),attempts int not null default 0);
alter table public.d2_admins enable row level security;
alter table public.d2_claim_codes enable row level security;
alter table public.d2_claim_attempts enable row level security;
revoke all on public.d2_admins,public.d2_claim_codes,public.d2_claim_attempts from public,anon,authenticated;
grant select on public.d2_admins to authenticated;
create policy admin_self_read on public.d2_admins for select to authenticated using(user_id=(select auth.uid()));
create function public.d2_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.d2_admins where user_id=auth.uid())
$$;
create function public.d2_issue_claim_code(p_restaurant uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare code text; until_time timestamptz=now()+interval '7 days';
begin
 if not public.d2_is_admin() then raise exception 'Administrator access required';end if;
 perform 1 from public.d2_restaurants where id=p_restaurant and active for no key update;
 if not found then raise exception 'Restaurant not found or inactive';end if;
 code='DINEVO-'||upper(replace(gen_random_uuid()::text,'-',''));
 insert into public.d2_claim_codes(restaurant_id,code_hash,expires_at,issued_by)
 values(p_restaurant,encode(sha256(convert_to(code,'UTF8')),'hex'),until_time,auth.uid())
 on conflict(restaurant_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,issued_by=excluded.issued_by,claimed_by=null,claimed_at=null;
 return jsonb_build_object('restaurant_id',p_restaurant,'code',code,'expires_at',until_time);
end $$;
create function public.d2_admin_create_restaurant(p_name text,p_city text,p_cuisines text[],p_is_test boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result uuid; existing uuid;
begin
 if not public.d2_is_admin() then raise exception 'Administrator access required';end if;
 if p_request is null or p_name is null or length(trim(p_name)) not between 1 and 120 or p_city is null or length(trim(p_city))>140 or p_cuisines is null or coalesce(array_length(p_cuisines,1),0)>30 or exists(select 1 from unnest(p_cuisines) c where c is null or length(c)>80) or p_is_test is null then raise exception 'Check restaurant details';end if;
 insert into public.d2_restaurants(name,city,cuisines,is_test,creation_request)
 values(trim(p_name),trim(p_city),p_cuisines,p_is_test,p_request)
 on conflict(creation_request) do nothing returning id into result;
 if result is null then
  select id into existing from public.d2_restaurants where creation_request=p_request;
  return jsonb_build_object('restaurant_id',existing,'code',null,'already_created',true);
 end if;
 return public.d2_issue_claim_code(result);
end $$;
create function public.d2_admin_restaurants() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.d2_is_admin() then raise exception 'Administrator access required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'city',r.city,'cuisines',r.cuisines,'is_test',r.is_test,'active',r.active,'partners',(select count(*) from public.d2_members m where m.restaurant_id=r.id),'code_expires',c.expires_at,'code_claimed',c.claimed_at is not null) order by r.name) from public.d2_restaurants r left join public.d2_claim_codes c on c.restaurant_id=r.id),'[]'::jsonb);
end $$;
create function public.d2_claim_restaurant(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); window_info public.d2_claim_attempts; invitation public.d2_claim_codes; normalized text; title text;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then return jsonb_build_object('ok',false,'error','Sign in with a verified email first');end if;
 insert into public.d2_claim_attempts(user_id) values(actor) on conflict(user_id) do nothing;
 select * into strict window_info from public.d2_claim_attempts where user_id=actor for update;
 if window_info.window_start<=now()-interval '10 minutes' then
  update public.d2_claim_attempts set window_start=now(),attempts=0 where user_id=actor;window_info.attempts=0;
 end if;
 if window_info.attempts>=10 then return jsonb_build_object('ok',false,'error','Too many unsuccessful attempts. Try again in 10 minutes.');end if;
 -- Return errors rather than raising: failed-attempt counts must commit.
 update public.d2_claim_attempts set attempts=attempts+1 where user_id=actor;
 normalized=upper(trim(coalesce(p_code,'')));
 if normalized !~ '^DINEVO-[0-9A-F]{32}$' then return jsonb_build_object('ok',false,'error','Invalid, expired or already used claim code');end if;
 select * into invitation from public.d2_claim_codes where code_hash=encode(sha256(convert_to(normalized,'UTF8')),'hex') for update;
 if not found or invitation.expires_at<=now() or (invitation.claimed_by is not null and invitation.claimed_by<>actor) then return jsonb_build_object('ok',false,'error','Invalid, expired or already used claim code');end if;
 select name into title from public.d2_restaurants where id=invitation.restaurant_id and active;
 if not found then return jsonb_build_object('ok',false,'error','Restaurant is not active');end if;
 insert into public.d2_members(restaurant_id,user_id) values(invitation.restaurant_id,actor) on conflict do nothing;
 update public.d2_claim_codes set claimed_by=actor,claimed_at=coalesce(claimed_at,now()) where restaurant_id=invitation.restaurant_id;
 update public.d2_claim_attempts set attempts=0 where user_id=actor;
 return jsonb_build_object('ok',true,'restaurant_id',invitation.restaurant_id,'name',title);
end $$;
revoke all on function public.d2_is_admin(),public.d2_issue_claim_code(uuid),public.d2_admin_create_restaurant(text,text,text[],boolean,uuid),public.d2_admin_restaurants(),public.d2_claim_restaurant(text) from public,anon,authenticated;
grant execute on function public.d2_is_admin(),public.d2_issue_claim_code(uuid),public.d2_admin_create_restaurant(text,text,text[],boolean,uuid),public.d2_admin_restaurants(),public.d2_claim_restaurant(text) to authenticated;
create index d2_members_user on public.d2_members(user_id,restaurant_id);
commit;
