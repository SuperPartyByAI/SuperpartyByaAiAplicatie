-- 04_migration_best_effort.sql
-- NOTA: Migrarea se face folosind scriptul `migrate_clients.mjs` cu libphonenumber-js.
-- Rulați pe server: `node migrate_clients.mjs`
-- Acest fisier este gol întrucât SQL curat (regex regex_replace etc.) nu curăță formatele de România 100% sigur (+4007 vs 07 vs 407).
select 'Use Node migrate_clients.mjs!' as migration_status;
