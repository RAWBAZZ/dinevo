CREATE OR REPLACE FUNCTION public.d2_request_quotes(
  p_restaurants uuid[],
  p_start timestamp with time zone,
  p_party integer,
  p_bill bigint,
  p_preferences jsonb,
  p_batch uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid=auth.uid();
  rid uuid;
  bid uuid;
  ids uuid[];
  fingerprint text;
  result jsonb='[]';
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_batch IS NULL OR p_restaurants IS NULL OR cardinality(p_restaurants) NOT BETWEEN 1 AND 10
     OR array_position(p_restaurants,NULL) IS NOT NULL OR p_start IS NULL OR p_start<=now()
     OR p_start>now()+interval '8 days' OR p_party IS NULL OR p_party NOT BETWEEN 1 AND 30
     OR p_bill IS NULL OR p_bill NOT BETWEEN 100 AND 100000000 OR p_preferences IS NULL
     OR jsonb_typeof(p_preferences)<>'object' OR length(p_preferences::text)>2000 THEN
    RAISE EXCEPTION 'Select 1–10 restaurants, a future date within 7 days, 1–30 guests and a valid bill';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_restaurants) x;
  fingerprint=encode(sha256(convert_to(jsonb_build_object('ids',ids,'start',p_start,'party',p_party,'bill',p_bill,'preferences',p_preferences)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
  IF EXISTS(SELECT 1 FROM public.d2_bookings WHERE customer_id=actor AND quote_batch=p_batch) THEN
    IF EXISTS(SELECT 1 FROM public.d2_bookings WHERE customer_id=actor AND quote_batch=p_batch AND quote_fingerprint<>fingerprint) THEN
      RAISE EXCEPTION 'Retry details changed. Start a new request';
    END IF;
    RETURN (SELECT jsonb_agg(id) FROM public.d2_bookings WHERE customer_id=actor AND quote_batch=p_batch);
  END IF;
  IF (SELECT count(DISTINCT quote_batch) FROM public.d2_bookings WHERE customer_id=actor AND created_at>now()-interval '10 minutes')>=10 THEN
    RAISE EXCEPTION 'Please wait before sending more requests';
  END IF;
  IF (SELECT count(*) FROM public.d2_restaurants WHERE id=ANY(ids) AND active)<>cardinality(ids) THEN
    RAISE EXCEPTION 'One selected restaurant is no longer listed. Refresh and select again';
  END IF;
  IF EXISTS(
    SELECT 1 FROM unnest(ids) AS selected(restaurant_id)
    WHERE NOT EXISTS(
      SELECT 1 FROM public.d2_slots s
      WHERE s.restaurant_id=selected.restaurant_id
        AND s.open
        AND s.starts_at>now()
        AND s.max_party>=p_party
        AND greatest(0,s.capacity-coalesce((
          SELECT sum(b.party)::int
          FROM public.d2_bookings b
          WHERE b.slot_id=s.id
            AND b.status NOT IN('cancelled','completed')
            AND NOT b.is_test
            AND (b.expires_at IS NULL OR b.expires_at>now())
        ),0))>=p_party
    )
  ) THEN
    RAISE EXCEPTION 'One or more selected restaurants are opening soon or do not have space for your group. Refresh and select available restaurants only';
  END IF;
  FOREACH rid IN ARRAY ids LOOP
    INSERT INTO public.d2_bookings(customer_id,restaurant_id,starts_at,party,discount,min_bill_paise,token_paise,cancel_before,exclusions,preferences,expires_at,is_test,test_bill_paise,quote_batch,quote_fingerprint)
    VALUES(actor,rid,p_start,p_party,0,p_bill,0,p_start,'Offer terms pending',p_preferences,least(p_start,now()+interval '24 hours'),true,p_bill,p_batch,fingerprint)
    RETURNING id INTO bid;
    PERFORM public.d2_event(bid,'requested');
    result=result||jsonb_build_array(bid);
  END LOOP;
  RETURN result;
END
$function$;
