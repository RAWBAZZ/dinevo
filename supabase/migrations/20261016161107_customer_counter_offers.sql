begin;

alter table public.d2_bookings
  add column if not exists counter_discount integer;

alter table public.d2_bookings
  drop constraint if exists d2_bookings_counter_discount_check;
alter table public.d2_bookings
  add constraint d2_bookings_counter_discount_check
  check (counter_discount is null or counter_discount between 0 and 100);

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid='public.d2_bookings'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%requested%'
      and pg_get_constraintdef(oid) like '%token_verified%'
  loop
    execute format('alter table public.d2_bookings drop constraint %I',c.conname);
  end loop;
end $$;

alter table public.d2_bookings
  add constraint d2_bookings_status_check
  check (status = any (array['requested','offered','counter_offered','awaiting_payment','token_verified','confirmed','arrived','seated','completed','cancelled']::text[]));

create or replace function public.d2_quote_offer(p_booking uuid,p_discount int,p_minimum bigint,p_terms text)
returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if not public.d2_is_partner(b.restaurant_id) or not exists(select 1 from public.d2_restaurants where id=b.restaurant_id and active) then raise exception 'Not authorised';end if;
 if b.expires_at<=now() or not ((b.status='requested' and b.quote_batch is not null) or b.status='counter_offered') then raise exception 'Request is no longer available';end if;
 if p_discount is null or p_discount not between 0 and 100 or p_minimum is null or p_minimum not between 100 and 100000000 or p_terms is null or length(trim(p_terms)) not between 1 and 2000 then raise exception 'Enter valid discount, minimum bill and terms';end if;
 update public.d2_bookings set discount=p_discount,min_bill_paise=p_minimum,exclusions=trim(p_terms),counter_discount=null,status='offered',expires_at=least(starts_at,now()+interval '5 minutes') where id=b.id;
 perform public.d2_event(b.id,'offered');
end $$;

create function public.d2_counter_offer(p_booking uuid,p_discount int)
returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings; notice_dedupe text;
begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if b.customer_id is distinct from auth.uid() then raise exception 'Not authorised';end if;
 if b.status<>'offered' or b.expires_at is null or b.expires_at<=now() then raise exception 'This offer is no longer available';end if;
 if p_discount is null or p_discount not between 0 and 100 then raise exception 'Enter a discount from 0 to 100';end if;
 update public.d2_bookings set status='counter_offered',counter_discount=p_discount where id=b.id;
 perform public.d2_event(b.id,'counter_offered');
 notice_dedupe=b.id::text||':counter:'||gen_random_uuid()::text;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe)
 select m.user_id,b.id,'counter_offer_received',notice_dedupe||':'||m.user_id::text
 from public.d2_members m where m.restaurant_id=b.restaurant_id;
end $$;

create function public.d2_accept_counter(p_booking uuid)
returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings; notice_dedupe text;
begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if not public.d2_is_partner(b.restaurant_id) or not exists(select 1 from public.d2_restaurants where id=b.restaurant_id and active) then raise exception 'Not authorised';end if;
 if b.status<>'counter_offered' or b.expires_at is null or b.expires_at<=now() or b.counter_discount is null then raise exception 'Counter offer is no longer available';end if;
 update public.d2_bookings set status='offered',discount=counter_discount,counter_discount=null,expires_at=least(starts_at,now()+interval '5 minutes') where id=b.id;
 perform public.d2_event(b.id,'counter_offer_accepted');
 notice_dedupe=b.id::text||':counter-accepted:'||gen_random_uuid()::text;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe)
 values(b.customer_id,b.id,'counter_offer_accepted',notice_dedupe);
end $$;

create or replace function public.d2_process_notices() returns void language plpgsql security definer set search_path='' as $$
declare expired record;
begin
 for expired in update public.d2_bookings set status='cancelled',cancellation_reason='Hold expired',expires_at=null where status in('requested','offered','counter_offered','awaiting_payment') and expires_at<=now() returning id loop perform public.d2_event(expired.id,'hold_expired');end loop;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) select customer_id,id,'reminder_24h',id::text||':reminder24' from public.d2_bookings where status='confirmed' and starts_at between now() and now()+interval '24 hours' on conflict(dedupe) do nothing;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) select customer_id,id,'reminder_2h',id::text||':reminder2' from public.d2_bookings where status='confirmed' and starts_at between now() and now()+interval '2 hours' on conflict(dedupe) do nothing;
 insert into public.d2_notices(recipient,slot_id,kind,dedupe)
 select w.customer_id,w.slot_id,'table_available',w.id::text||':available' from public.d2_waitlist w join public.d2_slots s on s.id=w.slot_id where s.open and exists(select 1 from public.d2_restaurants r where r.id=s.restaurant_id and r.active) and s.starts_at>now() and w.notified_at is null and s.capacity-coalesce((select sum(b.party) from public.d2_bookings b where b.slot_id=s.id and b.status not in('cancelled','completed')),0)>=w.party on conflict(dedupe) do nothing;
 update public.d2_waitlist w set notified_at=now() where notified_at is null and exists(select 1 from public.d2_notices n where n.dedupe=w.id::text||':available');
end $$;

revoke all on function public.d2_counter_offer(uuid,int),public.d2_accept_counter(uuid) from public,anon,authenticated;
grant execute on function public.d2_counter_offer(uuid,int),public.d2_accept_counter(uuid) to authenticated;

commit;
