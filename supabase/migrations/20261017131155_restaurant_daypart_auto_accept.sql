create table public.d2_auto_accept_rules (
  restaurant_id uuid not null references public.d2_restaurants(id) on delete cascade,
  daypart text not null check (daypart in ('morning','afternoon','evening','night')),
  enabled boolean not null default false,
  max_discount integer not null default 20 check (max_discount between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, daypart)
);

alter table public.d2_auto_accept_rules enable row level security;
grant select, insert, update on public.d2_auto_accept_rules to authenticated;
grant execute on function public.d2_is_partner(uuid) to authenticated;
create policy "Partners manage auto-accept rules for their restaurants"
on public.d2_auto_accept_rules
for all
to authenticated
using (public.d2_is_partner(restaurant_id))
with check (public.d2_is_partner(restaurant_id));

create or replace function public.d2_request(p_slot uuid, p_party integer, p_preferences jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
 s public.d2_slots;
 used int;
 result uuid;
 prefs jsonb;
 expired record;
 v_hour integer;
 v_daypart text;
 auto_accept boolean := false;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_party is null or p_party not between 1 and 30 or p_preferences is null or jsonb_typeof(p_preferences)<>'object' or length(p_preferences::text)>2000 then raise exception 'Invalid request';end if;
 select * into strict s from public.d2_slots where id=p_slot for update;
 if not s.open or s.starts_at<=now() or p_party>s.max_party or not exists(select 1 from public.d2_restaurants where id=s.restaurant_id and active) then raise exception 'Slot unavailable';end if;
 for expired in update public.d2_bookings set status='cancelled',cancellation_reason='Hold expired',expires_at=null where slot_id=s.id and status in('requested','offered','awaiting_payment') and expires_at<=now() returning id loop perform public.d2_event(expired.id,'hold_expired');end loop;
 select coalesce(sum(party),0)::int into used from public.d2_bookings where slot_id=s.id and status not in('cancelled','completed') and not is_test;
 if used+p_party>s.capacity then raise exception 'Slot full. Join the waitlist.';end if;
 v_hour := extract(hour from (s.starts_at at time zone 'Asia/Kolkata'))::integer;
 v_daypart := case when v_hour between 5 and 11 then 'morning' when v_hour between 12 and 16 then 'afternoon' when v_hour between 17 and 20 then 'evening' else 'night' end;
 select coalesce(bool_or(a.enabled and s.discount <= a.max_discount),false) into auto_accept
 from public.d2_auto_accept_rules a where a.restaurant_id=s.restaurant_id and a.daypart=v_daypart;
 prefs=jsonb_build_object('occasion',left(coalesce(p_preferences->>'occasion',''),80),'seating',left(coalesce(p_preferences->>'seating',''),80),'dietary',left(coalesce(p_preferences->>'dietary',''),500),'high_chair',coalesce(p_preferences->>'high_chair','false')='true');
 insert into public.d2_bookings(customer_id,slot_id,restaurant_id,starts_at,party,discount,min_bill_paise,token_paise,cancel_before,exclusions,preferences,status,expires_at)
 values(auth.uid(),s.id,s.restaurant_id,s.starts_at,p_party,s.discount,s.min_bill_paise,s.token_paise,s.starts_at-make_interval(hours=>s.cancel_hours),s.exclusions,prefs,case when auto_accept then 'confirmed' else 'requested' end,case when auto_accept then null else least(now()+interval '30 minutes',s.starts_at) end)
 returning id into result;
 perform public.d2_event(result,'requested');
 if auto_accept then perform public.d2_event(result,'confirmed'); end if;
 return result;
end $function$;

create or replace function public.d2_counter_offer(p_booking uuid, p_discount integer)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
 b public.d2_bookings;
 v_hour integer;
 v_daypart text;
 auto_accept boolean := false;
begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if b.customer_id is distinct from auth.uid() then raise exception 'Not authorised';end if;
 if b.status<>'offered' or b.expires_at is null or b.expires_at<=now() then raise exception 'This offer is no longer available';end if;
 if p_discount is null or p_discount not between 0 and 100 then raise exception 'Enter a discount from 0 to 100';end if;
 v_hour := extract(hour from (b.starts_at at time zone 'Asia/Kolkata'))::integer;
 v_daypart := case when v_hour between 5 and 11 then 'morning' when v_hour between 12 and 16 then 'afternoon' when v_hour between 17 and 20 then 'evening' else 'night' end;
 select coalesce(bool_or(a.enabled and p_discount <= a.max_discount),false) into auto_accept
 from public.d2_auto_accept_rules a where a.restaurant_id=b.restaurant_id and a.daypart=v_daypart;
 if auto_accept then
  update public.d2_bookings set status='confirmed',discount=p_discount,counter_discount=null,expires_at=null,accepted_at=now() where id=b.id;
  perform public.d2_event(b.id,'counter_offer_accepted');
  perform public.d2_event(b.id,'confirmed');
 else
  update public.d2_bookings set status='counter_offered',counter_discount=p_discount where id=b.id;
  perform public.d2_event(b.id,'counter_offered');
 end if;
end $function$;
