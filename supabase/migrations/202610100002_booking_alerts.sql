begin;
create extension if not exists pg_cron;
select cron.schedule('dinevo-booking-updates','* * * * *','select public.d2_process_notices();');
commit;
