begin;
alter table public.d2_bookings alter column slot_id drop not null;
alter table public.d2_bookings add column quote_batch uuid;
alter table public.d2_bookings add column quote_fingerprint text;
alter table public.d2_bookings add constraint d2_quote_test_only check(slot_id is not null or (quote_batch is not null and is_test));
create unique index d2_quote_retry on public.d2_bookings(customer_id,quote_batch,restaurant_id) where quote_batch is not null;
create function public.d2_request_quotes(p_restaurants uuid[],p_start timestamptz,p_party int,p_bill bigint,p_preferences jsonb,p_batch uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); rid uuid; bid uuid; ids uuid[]; fingerprint text; result jsonb='[]';
begin
 if actor is null then raise exception 'Sign in first';end if;
 if p_batch is null or p_restaurants is null or cardinality(p_restaurants) not between 1 and 10 or array_position(p_restaurants,null) is not null or p_start is null or p_start<=now() or p_start>now()+interval '8 days' or p_party is null or p_party not between 1 and 30 or p_bill is null or p_bill not between 100 and 100000000 or p_preferences is null or jsonb_typeof(p_preferences)<>'object' or length(p_preferences::text)>2000 then raise exception 'Select 1–10 restaurants, a future date within 7 days, 1–30 guests and a valid bill';end if;
 select array_agg(distinct x order by x) into ids from unnest(p_restaurants) x;
 fingerprint=encode(sha256(convert_to(jsonb_build_object('ids',ids,'start',p_start,'party',p_party,'bill',p_bill,'preferences',p_preferences)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 if exists(select 1 from public.d2_bookings where customer_id=actor and quote_batch=p_batch) then
  if exists(select 1 from public.d2_bookings where customer_id=actor and quote_batch=p_batch and quote_fingerprint<>fingerprint) then raise exception 'Retry details changed. Start a new request';end if;
  return (select jsonb_agg(id) from public.d2_bookings where customer_id=actor and quote_batch=p_batch);
 end if;
 if (select count(distinct quote_batch) from public.d2_bookings where customer_id=actor and created_at>now()-interval '10 minutes')>=10 then raise exception 'Please wait before sending more requests';end if;
 if (select count(*) from public.d2_restaurants where id=any(ids) and active)<>cardinality(ids) then raise exception 'One selected restaurant is no longer listed. Refresh and select again';end if;
 foreach rid in array ids loop
  insert into public.d2_bookings(customer_id,restaurant_id,starts_at,party,discount,min_bill_paise,token_paise,cancel_before,exclusions,preferences,expires_at,is_test,test_bill_paise,quote_batch,quote_fingerprint)
  values(actor,rid,p_start,p_party,0,p_bill,0,p_start,'Offer terms pending',p_preferences,least(p_start,now()+interval '24 hours'),true,p_bill,p_batch,fingerprint) returning id into bid;
  perform public.d2_event(bid,'requested');result=result||jsonb_build_array(bid);
 end loop;
 return result;
end $$;
create function public.d2_quote_offer(p_booking uuid,p_discount int,p_minimum bigint,p_terms text) returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings;
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if not public.d2_is_partner(b.restaurant_id) or not exists(select 1 from public.d2_restaurants where id=b.restaurant_id and active) then raise exception 'Not authorised';end if;
 if b.quote_batch is null or b.status<>'requested' or b.expires_at<=now() then raise exception 'Request is no longer available';end if;
 if p_discount is null or p_discount not between 0 and 100 or p_minimum is null or p_minimum not between 100 and 100000000 or p_terms is null or length(trim(p_terms)) not between 1 and 2000 then raise exception 'Enter valid discount, minimum bill and terms';end if;
 update public.d2_bookings set discount=p_discount,min_bill_paise=p_minimum,exclusions=trim(p_terms),status='offered',expires_at=least(starts_at,now()+interval '5 minutes') where id=b.id;
 perform public.d2_event(b.id,'offered');
end $$;
create table public.d2_messages(id uuid primary key default gen_random_uuid(),booking_id uuid not null references public.d2_bookings,sender uuid not null references auth.users,body text not null check(length(body) between 1 and 1000),created_at timestamptz not null default now());
create index d2_messages_booking on public.d2_messages(booking_id,created_at);
create index d2_messages_sender on public.d2_messages(sender);
alter table public.d2_messages enable row level security;
revoke all on public.d2_messages from public,anon,authenticated;
grant select on public.d2_messages to authenticated;
create policy message_participants on public.d2_messages for select to authenticated using(public.d2_can_read(booking_id));
create function public.d2_send_message(p_booking uuid,p_body text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.d2_bookings; actor uuid=auth.uid();
begin
 select * into strict b from public.d2_bookings where id=p_booking for update;
 if actor is null or not public.d2_can_read(b.id) then raise exception 'Not authorised';end if;
 if p_id is null or p_body is null or length(trim(p_body)) not between 1 and 1000 then raise exception 'Enter a message up to 1000 characters';end if;
 if exists(select 1 from public.d2_messages where id=p_id and sender=actor and booking_id=b.id and body=trim(p_body)) then return;end if;
 if b.status in('cancelled','completed') then raise exception 'This conversation is closed';end if;
 if (select count(*) from public.d2_messages where booking_id=b.id and sender=actor and created_at>now()-interval '1 minute')>=10 then raise exception 'Please wait before sending more messages';end if;
 insert into public.d2_messages(id,booking_id,sender,body) values(p_id,b.id,actor,trim(p_body));
 insert into public.d2_notices(recipient,booking_id,kind,dedupe) select recipient,b.id,'message_received',p_id::text||':'||recipient::text from
 (select b.customer_id recipient union select user_id from public.d2_members where restaurant_id=b.restaurant_id) recipients where recipient<>actor;
end $$;
revoke all on function public.d2_request_quotes(uuid[],timestamptz,int,bigint,jsonb,uuid),public.d2_quote_offer(uuid,int,bigint,text),public.d2_send_message(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.d2_request_quotes(uuid[],timestamptz,int,bigint,jsonb,uuid),public.d2_quote_offer(uuid,int,bigint,text),public.d2_send_message(uuid,text,uuid) to authenticated;
commit;
