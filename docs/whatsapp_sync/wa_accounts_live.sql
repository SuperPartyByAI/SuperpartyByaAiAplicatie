-- CREATE VIEW for Realtime User Interface Observing Whatsapp Connection Health
-- Acest script adaugă două coloane vitale (is_online_real, is_stale) calculate pe baza 
-- timestamp-ului (bigint ms) luat prin metoda de Heartbeat.

CREATE OR REPLACE VIEW public.wa_accounts_live WITH (security_invoker = off) AS
SELECT *,
       CASE
           WHEN status = 'connected' AND (EXTRACT(EPOCH FROM CLOCK_TIMESTAMP()) * 1000 - last_ping_at) <= 45000 THEN true
           ELSE false
       END as is_online_real,
       CASE
           WHEN status = 'connected' AND (EXTRACT(EPOCH FROM CLOCK_TIMESTAMP()) * 1000 - last_ping_at) > 45000 THEN true
           ELSE false
       END as is_stale
FROM public.wa_accounts;
