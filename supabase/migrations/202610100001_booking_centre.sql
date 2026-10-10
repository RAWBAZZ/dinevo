begin;
-- Isolated v2 schema: does not alter legacy requests/offers or claim legacy payments.
create table public.d2_restaurants(id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true);
create table public.d2_members(restaurant_id uuid references public.d2_restaurants on delete cascade, user_id uuid references auth.users on delete cascade, primary key(restaurant_id,user_id));
create table public.d2_slots(id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.d2_restaurants, starts_at timestamptz not null, capacity int not null check(capacity between 1 and 500), max_party int not null check(max_party between 1 and 30), discount int not null check(discount between 0 and 100), min_bill_paise bigint not null check(min_bill_paise>=0), token_paise bigint not null check(token_paise>=0), cancel_hours int not null check(cancel_hours between 0 and 720), exclusions text not null check(length(exclusions) between 1 and 2000), open boolean not null default true, unique(restaurant_id,starts_at));
create table public.d2_bookings(id uuid primary key default gen_random_uuid(), customer_id uuid not null references auth.users, slot_id uuid not null references public.d2_slots, restaurant_id uuid not null references public.d2_restaurants, starts_at timestamptz not null, party int not null check(party between 1 and 30), status text not null default 'requested' check(status in ('requested','offered','awaiting_payment','token_verified','confirmed','arrived','seated','completed','cancelled')), discount int not null, min_bill_paise bigint not null, token_paise bigint not null, cancel_before timestamptz not null, exclusions text not null, preferences jsonb not null default '{}', preferences_confirmed boolean not null default false, expires_at timestamptz, accepted_at timestamptz, checkin_code uuid not null default gen_random_uuid(), paid_paise bigint not null default 0, payment_ref text unique, refund_status text not null default 'none' check(refund_status in('none','requested','refunded','not_eligible')), refund_ref text unique, refund_paise bigint not null default 0, late_minutes int not null default 0, cancellation_reason text, created_at timestamptz not null default now());
create unique index d2_one_active_request on public.d2_bookings(customer_id,slot_id) where status not in('cancelled','completed');
create index d2_customer_bookings on public.d2_bookings(customer_id,created_at desc);
create index d2_partner_bookings on public.d2_bookings(restaurant_id,starts_at);
create table public.d2_events(id bigint generated always as identity primary key, booking_id uuid not null references public.d2_bookings, kind text not null, created_at timestamptz not null default now());
create table public.d2_waitlist(id uuid primary key default gen_random_uuid(), customer_id uuid not null references auth.users, slot_id uuid not null references public.d2_slots, party int not null check(party between 1 and 30), notified_at timestamptz, unique(customer_id,slot_id));
create table public.d2_notices(id bigint generated always as identity primary key, recipient uuid not null references auth.users, booking_id uuid references public.d2_bookings, slot_id uuid references public.d2_slots, kind text not null, dedupe text unique not null, created_at timestamptz not null default now(), read_at timestamptz);
create table public.d2_reviews(booking_id uuid primary key references public.d2_bookings, customer_id uuid not null references auth.users, restaurant_id uuid not null references public.d2_restaurants, rating int not null check(rating between 1 and 5), body text not null check(length(body) between 1 and 1000), created_at timestamptz not null default now());

create function public.d2_is_partner(r uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.d2_members where restaurant_id=r and user_id=auth.uid()) $$;
create function public.d2_can_read(b uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.d2_bookings where id=b and (customer_id=auth.uid() or public.d2_is_partner(restaurant_id))) $$;
create function public.d2_event(b uuid,k text) returns void language plpgsql security definer set search_path='' as $$
declare v public.d2_bookings;
begin
 select * into strict v from public.d2_bookings where id=b;
 insert into public.d2_events(booking_id,kind) values(b,k);
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) values(v.customer_id,b,k,b::text||':'||k||':customer') on conflict(dedupe) do nothing;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) select user_id,b,k,b::text||':'||k||':'||user_id::text from public.d2_members where restaurant_id=v.restaurant_id on conflict(dedupe) do nothing;
end $$;
-- RLS never relies on user-editable metadata or a restaurant dropdown.
alter table public.d2_restaurants enable row level security;
alter table public.d2_members enable row level security;
alter table public.d2_slots enable row level security;
alter table public.d2_bookings enable row level security;
alter table public.d2_events enable row level security;
alter table public.d2_waitlist enable row level security;
alter table public.d2_notices enable row level security;
alter table public.d2_reviews enable row level security;
create policy restaurants_read on public.d2_restaurants for select to authenticated using(active or public.d2_is_partner(id));
create policy members_read on public.d2_members for select to authenticated using(user_id=auth.uid());
create policy slots_read on public.d2_slots for select to authenticated using(open or public.d2_is_partner(restaurant_id));
create policy bookings_read on public.d2_bookings for select to authenticated using(customer_id=auth.uid() or public.d2_is_partner(restaurant_id));
create policy events_read on public.d2_events for select to authenticated using(public.d2_can_read(booking_id));
create policy waitlist_read on public.d2_waitlist for select to authenticated using(customer_id=auth.uid());
create policy notices_read on public.d2_notices for select to authenticated using(recipient=auth.uid());
create policy reviews_read on public.d2_reviews for select to authenticated using(customer_id=auth.uid() or public.d2_is_partner(restaurant_id));

create function public.d2_available(p_restaurant uuid default null) returns table(id uuid,restaurant_id uuid,restaurant text,starts_at timestamptz,remaining int,max_party int,discount int,min_bill_paise bigint,token_paise bigint,cancel_hours int,exclusions text) language sql stable security definer set search_path='' as $$
 select s.id,s.restaurant_id,r.name,s.starts_at,greatest(0,s.capacity-coalesce((select sum(b.party)::int from public.d2_bookings b where b.slot_id=s.id and b.status not in('cancelled','completed') and (b.expires_at is null or b.expires_at>now())),0)),s.max_party,s.discount,s.min_bill_paise,s.token_paise,s.cancel_hours,s.exclusions from public.d2_slots s join public.d2_restaurants r on r.id=s.restaurant_id where auth.uid() is not null and r.active and s.open and s.starts_at>now() and (p_restaurant is null or s.restaurant_id=p_restaurant) order by s.starts_at limit 300
$$;
create function public.d2_request(p_slot uuid,p_party int,p_preferences jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare s public.d2_slots; used int; result uuid; prefs jsonb; expired record;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_party is null or p_party not between 1 and 30 or p_preferences is null or jsonb_typeof(p_preferences)<>'object' or length(p_preferences::text)>2000 then raise exception 'Invalid request';end if;
 select * into strict s from public.d2_slots where id=p_slot for update;
 if not s.open or s.starts_at<=now() or p_party>s.max_party or not exists(select 1 from public.d2_restaurants where id=s.restaurant_id and active) then raise exception 'Slot unavailable';end if;
 -- Expired requests cannot block a fresh request by this customer.
 for expired in update public.d2_bookings set status='cancelled',cancellation_reason='Hold expired',expires_at=null where slot_id=s.id and status in('requested','offered','awaiting_payment') and expires_at<=now() returning id loop perform public.d2_event(expired.id,'hold_expired');end loop;
 select coalesce(sum(party),0)::int into used from public.d2_bookings where slot_id=s.id and status not in('cancelled','completed');
 if used+p_party>s.capacity then raise exception 'Slot full. Join the waitlist.';end if;
 prefs=jsonb_build_object('occasion',left(coalesce(p_preferences->>'occasion',''),80),'seating',left(coalesce(p_preferences->>'seating',''),80),'dietary',left(coalesce(p_preferences->>'dietary',''),500),'high_chair',coalesce(p_preferences->>'high_chair','false')='true');
 insert into public.d2_bookings(customer_id,slot_id,restaurant_id,starts_at,party,discount,min_bill_paise,token_paise,cancel_before,exclusions,preferences,expires_at) values(auth.uid(),s.id,s.restaurant_id,s.starts_at,p_party,s.discount,s.min_bill_paise,s.token_paise,s.starts_at-make_interval(hours=>s.cancel_hours),s.exclusions,prefs,least(now()+interval '30 minutes',s.starts_at)) returning id into result;
 perform public.d2_event(result,'requested'); return result;
end $$;
create function public.d2_action(p_booking uuid,p_action text,p_value text default '') returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings; partner boolean; target text; wait int;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 partner=public.d2_is_partner(b.restaurant_id);
 if auth.uid() is null or (b.customer_id<>auth.uid() and not partner) then raise exception 'Not authorised';end if;
 if p_action='cancel' then
  if b.status not in('requested','offered','awaiting_payment','token_verified','confirmed') then raise exception 'Cannot cancel at this stage';end if;
  if p_value is null or p_value not in('Plans changed','Date or time does not suit','Discount does not suit','Chose another restaurant','Booked by mistake','Restaurant unavailable') then raise exception 'Select a cancellation reason';end if;
  update public.d2_bookings set status='cancelled',expires_at=null,cancellation_reason=p_value,refund_status=case when paid_paise=0 then 'none' when partner or now()<=cancel_before then 'requested' else 'not_eligible' end,refund_paise=case when paid_paise>0 and (partner or now()<=cancel_before) then paid_paise else 0 end where id=b.id;
  perform public.d2_event(b.id,'cancelled');return;
 end if;
 if b.expires_at<=now() then raise exception 'Hold expired. Request another slot.';end if;
 if p_action='offer' and partner and b.status='requested' then
  update public.d2_bookings set status='offered',expires_at=least(now()+interval '5 minutes',starts_at) where id=b.id;
  perform public.d2_event(b.id,'offered');return;
 elsif p_action='accept' and b.customer_id=auth.uid() and b.status='offered' then
  target=case when b.token_paise=0 then 'confirmed' else 'awaiting_payment' end;
  update public.d2_bookings set status=target,accepted_at=now(),expires_at=case when target='confirmed' then null else expires_at end where id=b.id;
  perform public.d2_event(b.id,'terms_accepted');perform public.d2_event(b.id,target);return;
 elsif p_action='confirm' and partner and b.status='token_verified' then target='confirmed';
 elsif p_action='seated' and partner and b.status='arrived' then target='seated';
 elsif p_action='completed' and partner and b.status='seated' then target='completed';
 elsif p_action='preferences' and partner and b.status not in('completed','cancelled') then
  update public.d2_bookings set preferences_confirmed=true where id=b.id;perform public.d2_event(b.id,'preferences_confirmed');return;
 elsif p_action='late' and b.customer_id=auth.uid() and b.status='confirmed' then
  if p_value is null or p_value not in('5','10','15','20','30') then raise exception 'Choose 5–30 minutes';end if;
  wait=p_value::int;update public.d2_bookings set late_minutes=wait where id=b.id;perform public.d2_event(b.id,'running_late_'||wait::text);return;
 else raise exception 'Invalid booking transition';end if;
 update public.d2_bookings set status=target,expires_at=null where id=b.id;perform public.d2_event(b.id,target);
end $$;
-- Only a trusted, signature-verifying payment adapter may call this RPC.
create function public.d2_verify_payment(p_booking uuid,p_reference text,p_amount bigint) returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if p_reference is null or length(p_reference) not between 3 and 200 then raise exception 'Invalid provider reference';end if;
 if b.payment_ref=p_reference and b.paid_paise=p_amount then return;end if;
 if p_amount is null or b.status<>'awaiting_payment' or b.expires_at<=now() or p_amount<>b.token_paise or p_amount<=0 then raise exception 'Payment does not match an active booking; reconcile/refund with provider';end if;
 update public.d2_bookings set paid_paise=p_amount,payment_ref=p_reference,status='token_verified',expires_at=null where id=b.id;
 perform public.d2_event(b.id,'token_verified');
end $$;
create function public.d2_verify_refund(p_booking uuid,p_reference text,p_amount bigint) returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if p_reference is null or length(p_reference) not between 3 and 200 then raise exception 'Invalid refund reference';end if;
 if b.refund_status='refunded' and b.refund_ref=p_reference and b.refund_paise=p_amount then return;end if;
 if p_amount is null or b.refund_status<>'requested' or p_amount<>b.refund_paise then raise exception 'Refund mismatch';end if;
 update public.d2_bookings set refund_ref=p_reference,refund_status='refunded' where id=b.id;perform public.d2_event(b.id,'refunded');
end $$;
create function public.d2_checkin(p_booking uuid,p_code uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if not public.d2_is_partner(b.restaurant_id) or p_code is distinct from b.checkin_code then raise exception 'Invalid check-in';end if;
 if b.status<>'confirmed' or now()<b.starts_at-interval '2 hours' or now()>b.starts_at+interval '6 hours' then raise exception 'Check-in unavailable for this time or status';end if;
 update public.d2_bookings set status='arrived',checkin_code=gen_random_uuid() where id=b.id;perform public.d2_event(b.id,'arrived');
end $$;
create function public.d2_review(p_booking uuid,p_rating int,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if b.customer_id is distinct from auth.uid() or b.status<>'completed' then raise exception 'Only completed visits can be reviewed';end if;
 insert into public.d2_reviews(booking_id,customer_id,restaurant_id,rating,body) values(b.id,auth.uid(),b.restaurant_id,p_rating,trim(p_body));perform public.d2_event(b.id,'review_submitted');
end $$;
create function public.d2_wait(p_slot uuid,p_party int,p_join boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare s public.d2_slots;
begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 if not p_join then delete from public.d2_waitlist where customer_id=auth.uid() and slot_id=p_slot;return;end if;
 select * into strict s from public.d2_slots where id=p_slot;
 if not s.open or s.starts_at<=now() or p_party is null or p_party not between 1 and s.max_party then raise exception 'Invalid waitlist request';end if;
 insert into public.d2_waitlist(customer_id,slot_id,party) values(auth.uid(),p_slot,p_party) on conflict(customer_id,slot_id) do update set party=excluded.party;
end $$;
create function public.d2_read_notice(p_id bigint) returns void language sql security definer set search_path='' as $$update public.d2_notices set read_at=now() where id=p_id and recipient=auth.uid()$$;
create function public.d2_publish_slot(p_restaurant uuid,p_start timestamptz,p_capacity int,p_max_party int,p_discount int,p_min_bill bigint,p_token bigint,p_cancel_hours int,p_exclusions text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not public.d2_is_partner(p_restaurant) or p_start<=now() or length(trim(p_exclusions))<1 then raise exception 'Not authorised or invalid slot';end if;
 insert into public.d2_slots(restaurant_id,starts_at,capacity,max_party,discount,min_bill_paise,token_paise,cancel_hours,exclusions) values(p_restaurant,p_start,p_capacity,p_max_party,p_discount,p_min_bill,p_token,p_cancel_hours,trim(p_exclusions)) returning id into result;return result;
end $$;
create function public.d2_close_slot(p_slot uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.d2_slots where id=p_slot and public.d2_is_partner(restaurant_id)) then raise exception 'Not authorised';end if;
 update public.d2_slots set open=false where id=p_slot;
end $$;
-- Scheduler, not browser polling, creates reminder / availability notifications.
create function public.d2_process_notices() returns void language plpgsql security definer set search_path='' as $$
declare expired record;
begin
 for expired in update public.d2_bookings set status='cancelled',cancellation_reason='Hold expired',expires_at=null where status in('requested','offered','awaiting_payment') and expires_at<=now() returning id loop perform public.d2_event(expired.id,'hold_expired');end loop;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) select customer_id,id,'reminder_24h',id::text||':reminder24' from public.d2_bookings where status='confirmed' and starts_at between now() and now()+interval '24 hours' on conflict(dedupe) do nothing;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) select customer_id,id,'reminder_2h',id::text||':reminder2' from public.d2_bookings where status='confirmed' and starts_at between now() and now()+interval '2 hours' on conflict(dedupe) do nothing;
 insert into public.d2_notices(recipient,slot_id,kind,dedupe)
 select w.customer_id,w.slot_id,'table_available',w.id::text||':available' from public.d2_waitlist w join public.d2_slots s on s.id=w.slot_id where s.open and exists(select 1 from public.d2_restaurants r where r.id=s.restaurant_id and r.active) and s.starts_at>now() and w.notified_at is null and s.capacity-coalesce((select sum(b.party) from public.d2_bookings b where b.slot_id=s.id and b.status not in('cancelled','completed')),0)>=w.party on conflict(dedupe) do nothing;
 update public.d2_waitlist w set notified_at=now() where notified_at is null and exists(select 1 from public.d2_notices n where n.dedupe=w.id::text||':available');
end $$;
create index d2_slots_future on public.d2_slots(starts_at) where open;
create index d2_booking_capacity on public.d2_bookings(slot_id) where status not in('cancelled','completed');
create index d2_event_booking on public.d2_events(booking_id,id);
create index d2_notice_recipient on public.d2_notices(recipient,id desc);
-- Explicit privileges: no direct browser mutations, no public payment verification.
do $$declare obj record;begin
 for obj in select tablename from pg_tables where schemaname='public' and tablename like 'd2\_%' escape '\' loop
 execute format('revoke all on public.%I from public, anon, authenticated',obj.tablename);
 execute format('grant select on public.%I to authenticated',obj.tablename);
 end loop;
 for obj in select oid::regprocedure as signature,proname from pg_proc where pronamespace='public'::regnamespace and proname like 'd2\_%' escape '\' loop
 execute format('revoke all on function %s from public, anon, authenticated',obj.signature);
 if obj.proname in('d2_verify_payment','d2_verify_refund','d2_process_notices') then execute format('grant execute on function %s to service_role',obj.signature);
 elsif obj.proname<>'d2_event' then execute format('grant execute on function %s to authenticated',obj.signature);end if;
 end loop;
end $$;
commit;
