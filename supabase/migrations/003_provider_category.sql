-- One sender can bill several services (Partner: internet and electricity), so providers are per category.
alter table household.providers add column if not exists category text;
alter table household.bills add column if not exists category text;
