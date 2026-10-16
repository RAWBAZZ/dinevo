create sequence if not exists public.d2_booking_code_seq
  as integer minvalue 10000 maxvalue 99999 start with 10000 no cycle;

alter table public.d2_bookings
  add column if not exists booking_code integer;

update public.d2_bookings
  set booking_code = nextval('public.d2_booking_code_seq')
  where booking_code is null;

alter table public.d2_bookings
  alter column booking_code set default nextval('public.d2_booking_code_seq');
alter table public.d2_bookings
  alter column booking_code set not null;
alter sequence public.d2_booking_code_seq
  owned by public.d2_bookings.booking_code;

create unique index if not exists d2_bookings_booking_code_key
  on public.d2_bookings(booking_code);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.d2_bookings'::regclass
      and conname = 'd2_bookings_booking_code_range'
  ) then
    alter table public.d2_bookings
      add constraint d2_bookings_booking_code_range
      check (booking_code between 10000 and 99999);
  end if;
end;
$$;
