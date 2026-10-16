-- Accepting a restaurant offer records the customer's agreement but does not
-- confirm the reservation. The restaurant must make the final confirmation.
create or replace function public.d2_action(p_booking uuid,p_action text,p_value text default '')
returns void language plpgsql security definer set search_path to '' as $function$
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
 elsif p_action='accept' and b.customer_id=auth.uid() and b.status='offered' and b.accepted_at is null then
  update public.d2_bookings set accepted_at=now(),expires_at=null where id=b.id;
  perform public.d2_event(b.id,'terms_accepted');perform public.d2_event(b.id,'customer_accepted');return;
 elsif p_action='confirm' and partner and ((b.status='offered' and b.accepted_at is not null) or b.status='token_verified') then target='confirmed';
 elsif p_action='seated' and partner and b.status='arrived' then target='seated';
 elsif p_action='completed' and partner and b.status='seated' then target='completed';
 elsif p_action='preferences' and partner and b.status not in('completed','cancelled') then
  update public.d2_bookings set preferences_confirmed=true where id=b.id;perform public.d2_event(b.id,'preferences_confirmed');return;
 elsif p_action='late' and b.customer_id=auth.uid() and b.status='confirmed' then
  if p_value is null or p_value not in('5','10','15','20','30') then raise exception 'Choose 5–30 minutes';end if;
  wait=p_value::int;update public.d2_bookings set late_minutes=wait where id=b.id;perform public.d2_event(b.id,'running_late_'||wait::text);return;
 else raise exception 'Invalid booking transition';end if;
 update public.d2_bookings set status=target,expires_at=null where id=b.id;perform public.d2_event(b.id,target);
end $function$;
