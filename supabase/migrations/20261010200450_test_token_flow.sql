begin;
-- Explicitly opted-in test tokens never populate real payment or refund columns.
alter table public.d2_bookings add column is_test boolean not null default false;
alter table public.d2_bookings add column test_bill_paise bigint not null default 0;
alter table public.d2_bookings add column test_token_paise bigint not null default 0;
alter table public.d2_bookings add constraint d2_test_money_separation check (
  test_bill_paise>=0 and test_token_paise>=0 and
  (not is_test or (paid_paise=0 and payment_ref is null and refund_paise=0 and refund_status='none' and refund_ref is null))
);
create function public.d2_test_token(p_booking uuid,p_bill_paise bigint,p_accept_test boolean) returns void
language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings; amount bigint;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if b.customer_id is distinct from auth.uid() or auth.uid() is null then raise exception 'Not authorised';end if;
 if p_accept_test is distinct from true then raise exception 'Acknowledge this is a test, not a real payment';end if;
 if p_bill_paise is null or p_bill_paise<greatest(1,b.min_bill_paise) or p_bill_paise>100000000 then raise exception 'Enter an estimated bill at least equal to the minimum and below ₹10 lakh';end if;
 amount=round(p_bill_paise::numeric*0.02)::bigint;
 if amount<1 then raise exception 'Estimated bill is too small for a token';end if;
 if b.is_test and b.test_bill_paise=p_bill_paise and b.status in('token_verified','confirmed','arrived','seated','completed') then return;end if;
 if b.status not in('offered','awaiting_payment') or b.expires_at is null or b.expires_at<=now() or b.paid_paise<>0 or b.payment_ref is not null then raise exception 'This booking cannot use a test token';end if;
 update public.d2_bookings set is_test=true,test_bill_paise=p_bill_paise,test_token_paise=amount,
  status='token_verified',accepted_at=now(),expires_at=null where id=b.id;
 perform public.d2_event(b.id,'terms_accepted');
 perform public.d2_event(b.id,'token_submitted');
end $$;
revoke all on function public.d2_test_token(uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.d2_test_token(uuid,bigint,boolean) to authenticated;
create or replace function public.d2_event(b uuid,k text) returns void language plpgsql security definer set search_path='' as $$
declare v public.d2_bookings;
begin
 select * into strict v from public.d2_bookings where id=b;
 if v.is_test then k='test_'||k;end if;
 insert into public.d2_events(booking_id,kind) values(b,k);
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) values(v.customer_id,b,k,b::text||':'||k||':customer') on conflict(dedupe) do nothing;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) select user_id,b,k,b::text||':'||k||':'||user_id::text from public.d2_members where restaurant_id=v.restaurant_id on conflict(dedupe) do nothing;
end $$;
create or replace function public.d2_available(p_restaurant uuid default null) returns table(id uuid,restaurant_id uuid,restaurant text,starts_at timestamptz,remaining int,max_party int,discount int,min_bill_paise bigint,token_paise bigint,cancel_hours int,exclusions text) language sql stable security definer set search_path='' as $$
 select s.id,s.restaurant_id,r.name,s.starts_at,greatest(0,s.capacity-coalesce((select sum(b.party)::int from public.d2_bookings b where b.slot_id=s.id and b.status not in('cancelled','completed') and not b.is_test and (b.expires_at is null or b.expires_at>now())),0)),s.max_party,s.discount,s.min_bill_paise,s.token_paise,s.cancel_hours,s.exclusions from public.d2_slots s join public.d2_restaurants r on r.id=s.restaurant_id where auth.uid() is not null and r.active and s.open and s.starts_at>now() and (p_restaurant is null or s.restaurant_id=p_restaurant) order by s.starts_at limit 300
$$;
create or replace function public.d2_request(p_slot uuid,p_party int,p_preferences jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare s public.d2_slots; used int; result uuid; prefs jsonb; expired record;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_party is null or p_party not between 1 and 30 or p_preferences is null or jsonb_typeof(p_preferences)<>'object' or length(p_preferences::text)>2000 then raise exception 'Invalid request';end if;
 select * into strict s from public.d2_slots where id=p_slot for update;
 if not s.open or s.starts_at<=now() or p_party>s.max_party or not exists(select 1 from public.d2_restaurants where id=s.restaurant_id and active) then raise exception 'Slot unavailable';end if;
 -- Expired requests cannot block a fresh request by this customer.
 for expired in update public.d2_bookings set status='cancelled',cancellation_reason='Hold expired',expires_at=null where slot_id=s.id and status in('requested','offered','awaiting_payment') and expires_at<=now() returning id loop perform public.d2_event(expired.id,'hold_expired');end loop;
 select coalesce(sum(party),0)::int into used from public.d2_bookings where slot_id=s.id and status not in('cancelled','completed') and not is_test;
 if used+p_party>s.capacity then raise exception 'Slot full. Join the waitlist.';end if;
 prefs=jsonb_build_object('occasion',left(coalesce(p_preferences->>'occasion',''),80),'seating',left(coalesce(p_preferences->>'seating',''),80),'dietary',left(coalesce(p_preferences->>'dietary',''),500),'high_chair',coalesce(p_preferences->>'high_chair','false')='true');
 insert into public.d2_bookings(customer_id,slot_id,restaurant_id,starts_at,party,discount,min_bill_paise,token_paise,cancel_before,exclusions,preferences,expires_at) values(auth.uid(),s.id,s.restaurant_id,s.starts_at,p_party,s.discount,s.min_bill_paise,s.token_paise,s.starts_at-make_interval(hours=>s.cancel_hours),s.exclusions,prefs,least(now()+interval '30 minutes',s.starts_at)) returning id into result;
 perform public.d2_event(result,'requested'); return result;
end $$;
create or replace function public.d2_process_notices() returns void language plpgsql security definer set search_path='' as $$
declare expired record;
begin
 for expired in update public.d2_bookings set status='cancelled',cancellation_reason='Hold expired',expires_at=null where status in('requested','offered','awaiting_payment') and expires_at<=now() returning id loop perform public.d2_event(expired.id,'hold_expired');end loop;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) select customer_id,id,'reminder_24h',id::text||':reminder24' from public.d2_bookings where status='confirmed' and not is_test and starts_at between now() and now()+interval '24 hours' on conflict(dedupe) do nothing;
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) select customer_id,id,'reminder_2h',id::text||':reminder2' from public.d2_bookings where status='confirmed' and not is_test and starts_at between now() and now()+interval '2 hours' on conflict(dedupe) do nothing;
 insert into public.d2_notices(recipient,slot_id,kind,dedupe)
 select w.customer_id,w.slot_id,'table_available',w.id::text||':available' from public.d2_waitlist w join public.d2_slots s on s.id=w.slot_id where s.open and exists(select 1 from public.d2_restaurants r where r.id=s.restaurant_id and r.active) and s.starts_at>now() and w.notified_at is null and s.capacity-coalesce((select sum(b.party) from public.d2_bookings b where b.slot_id=s.id and b.status not in('cancelled','completed') and not b.is_test),0)>=w.party on conflict(dedupe) do nothing;
 update public.d2_waitlist w set notified_at=now() where notified_at is null and exists(select 1 from public.d2_notices n where n.dedupe=w.id::text||':available');
end $$;
create or replace function public.d2_checkin(p_booking uuid,p_code uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if not public.d2_is_partner(b.restaurant_id) or p_code is distinct from b.checkin_code then raise exception 'Invalid check-in';end if;
 if b.status<>'confirmed' or (not b.is_test and (now()<b.starts_at-interval '2 hours' or now()>b.starts_at+interval '6 hours')) then raise exception 'Check-in unavailable for this time or status';end if;
 update public.d2_bookings set status='arrived',checkin_code=gen_random_uuid() where id=b.id;perform public.d2_event(b.id,'arrived');
end $$;
create or replace function public.d2_verify_payment(p_booking uuid,p_reference text,p_amount bigint) returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if b.is_test then raise exception 'Test bookings cannot record real payments';end if;
 if p_reference is null or length(p_reference) not between 3 and 200 then raise exception 'Invalid provider reference';end if;
 if b.payment_ref=p_reference and b.paid_paise=p_amount then return;end if;
 if p_amount is null or b.status<>'awaiting_payment' or b.expires_at<=now() or p_amount<>b.token_paise or p_amount<=0 then raise exception 'Payment does not match an active booking; reconcile/refund with provider';end if;
 update public.d2_bookings set paid_paise=p_amount,payment_ref=p_reference,status='token_verified',expires_at=null where id=b.id;
 perform public.d2_event(b.id,'token_verified');
end $$;
commit;
