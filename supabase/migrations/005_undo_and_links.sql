-- Every completion remembers what it changed, so a mistaken "paid" can be undone (household.undo_complete).
-- Applied in Supabase as migrations household_undo_complete, household_undo_guard, household_link_http;
-- complete_task and undo_complete bodies live there.
alter table household.task_events
  add column if not exists prev_next_due date,
  add column if not exists prev_done_at timestamptz,
  add column if not exists prev_amount_estimated boolean,
  add column if not exists paid_bill_ids bigint[];

-- Some providers' invoice links are plain http (tracking redirects).
alter table household.bills drop constraint if exists bills_link_check;
alter table household.bills add constraint bills_link_check check (link is null or link ~* '^https?://');
