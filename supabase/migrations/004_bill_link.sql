-- Some providers (Mei Avivim) only send a link to the invoice; keep it so the app can open it.
alter table household.bills add column if not exists link text check (link is null or link like 'https://%');
