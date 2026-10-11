-- Household management: everything lives in the `household` schema.
-- Nothing here touches the expense bot's tables in `public`.

create schema if not exists household;
grant usage on schema household to authenticated, service_role;

-- ---------------------------------------------------------------- tables

create table household.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Who may sign up. A user whose email is not here cannot create an account.
create table household.invites (
  email         text primary key check (email = lower(email)),
  household_id  uuid not null references household.households on delete cascade,
  display_name  text not null
);

create table household.members (
  household_id  uuid not null references household.households on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  display_name  text not null,
  email         text not null,
  created_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

-- One entity for everything the house has to do: bills, renewals, gas, chores.
create table household.tasks (
  id                  bigint generated always as identity primary key,
  household_id        uuid not null references household.households on delete cascade,
  title               text not null check (char_length(title) between 1 and 120),
  icon                text not null default 'checklist',
  kind                text not null default 'once'
                        check (kind in ('once', 'recurring', 'consumption')),
  interval_months     int check (interval_months between 1 and 120),
  interval_days       int check (interval_days between 1 and 3650),
  anchor_day          int check (anchor_day between 1 and 31),
  next_due            date,
  assignee_id         uuid references auth.users on delete set null,
  amount              numeric(12,2) check (amount >= 0),
  amount_estimated    boolean not null default false,
  autopay             boolean not null default false,
  remind_days_before  int not null default 3 check (remind_days_before between 0 and 60),
  notes               text check (char_length(notes) <= 2000),
  done_at             timestamptz,
  created_by          uuid default auth.uid() references auth.users on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (kind <> 'recurring' or interval_months is not null or interval_days is not null)
);
create index on household.tasks (household_id, next_due) where done_at is null;

create table household.providers (
  id               bigint generated always as identity primary key,
  household_id     uuid not null references household.households on delete cascade,
  name             text not null,
  sender_patterns  text[] not null default '{}',
  task_id          bigint references household.tasks on delete set null,
  autopay          boolean not null default false,
  created_at       timestamptz not null default now()
);

create table household.bills (
  id                bigint generated always as identity primary key,
  household_id      uuid not null references household.households on delete cascade,
  provider_id       bigint references household.providers on delete set null,
  task_id           bigint references household.tasks on delete set null,
  kind              text not null default 'bill' check (kind in ('bill', 'receipt', 'other')),
  provider_name     text,
  amount            numeric(12,2),
  due_date          date,
  period            text,
  email_message_id  text not null,
  email_from        text,
  subject           text,
  received_at       timestamptz,
  summary           text,
  confidence        real,
  status            text not null default 'new' check (status in ('new', 'paid', 'ignored')),
  created_at        timestamptz not null default now(),
  unique (household_id, email_message_id)
);

create table household.task_events (
  id            bigint generated always as identity primary key,
  task_id       bigint not null references household.tasks on delete cascade,
  household_id  uuid not null references household.households on delete cascade,
  done_on       date not null default (now() at time zone 'Asia/Jerusalem')::date,
  done_by       uuid references auth.users on delete set null,
  amount        numeric(12,2),
  source        text not null default 'app' check (source in ('app', 'email', 'worker')),
  bill_id       bigint references household.bills on delete set null,
  created_at    timestamptz not null default now()
);
create index on household.task_events (task_id, done_on desc);

create table household.shopping_items (
  id            bigint generated always as identity primary key,
  household_id  uuid not null references household.households on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  qty           text check (char_length(qty) <= 30),
  checked       boolean not null default false,
  checked_at    timestamptz,
  added_by      uuid default auth.uid() references auth.users on delete set null,
  created_at    timestamptz not null default now()
);
create index on household.shopping_items (household_id, checked);

create table household.push_subscriptions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  household_id  uuid not null references household.households on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now()
);

-- Worker-only: dedupes reminders so each stage is sent once per due date.
create table household.reminder_log (
  task_id   bigint not null references household.tasks on delete cascade,
  due_date  date not null,
  stage     text not null check (stage in ('before', 'due', 'overdue')),
  sent_at   timestamptz not null default now(),
  primary key (task_id, due_date, stage)
);

-- ---------------------------------------------------------------- helpers

create or replace function household.is_member(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from household.members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

create or replace function household.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;

create trigger tasks_touch before update on household.tasks
  for each row execute function household.touch_updated_at();

-- Next due date that keeps the original day of month (31 Jan -> 28 Feb -> 31 Mar).
create or replace function household.add_months_anchored(d date, months int, anchor int)
returns date
language sql immutable set search_path = ''
as $$
  select make_date(
    extract(year from t)::int,
    extract(month from t)::int,
    least(coalesce(anchor, extract(day from d)::int),
          extract(day from (date_trunc('month', t) + interval '1 month - 1 day'))::int)
  )
  from (select (date_trunc('month', d) + make_interval(months => months))::date as t) s;
$$;

-- Marks a task done and moves it forward. Single source of truth for app and worker.
create or replace function household.complete_task(
  p_task_id  bigint,
  p_amount   numeric default null,
  p_source   text    default 'app',
  p_done_by  uuid    default null,
  p_bill_id  bigint  default null,
  p_done_on  date    default null
)
returns household.tasks
language plpgsql security definer set search_path = ''
as $$
declare
  t        household.tasks;
  today    date := coalesce(p_done_on, (now() at time zone 'Asia/Jerusalem')::date);
  avg_gap  numeric;
  who      uuid := coalesce(auth.uid(), p_done_by);
begin
  select * into t from household.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task % not found', p_task_id;
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not household.is_member(t.household_id) then
    raise exception 'not allowed';
  end if;

  insert into household.task_events (task_id, household_id, done_on, done_by, amount, source, bill_id)
  values (t.id, t.household_id, today, who, coalesce(p_amount, t.amount), p_source, p_bill_id);

  update household.bills set status = 'paid'
  where task_id = t.id and status = 'new';

  if t.kind = 'once' then
    update household.tasks set done_at = now() where id = t.id returning * into t;

  elsif t.kind = 'recurring' then
    update household.tasks set
      next_due = case
        when interval_months is not null
          then household.add_months_anchored(coalesce(next_due, today), interval_months, anchor_day)
        else coalesce(next_due, today) + interval_days
      end,
      amount_estimated = amount is not null
    where id = t.id returning * into t;

  else -- consumption: average gap between the last (up to) 6 events
    select avg(gap) into avg_gap from (
      select done_on - lag(done_on) over (order by done_on) as gap
      from (select done_on from household.task_events
            where task_id = t.id order by done_on desc limit 6) last_events
    ) gaps where gap > 0;
    update household.tasks set
      next_due = today + coalesce(round(avg_gap)::int, interval_days, 45)
    where id = t.id returning * into t;
  end if;

  return t;
end;
$$;

-- Only invited emails may create an account; they join their household automatically.
create or replace function household.guard_signup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from household.invites i where i.email = lower(new.email)) then
    raise exception 'email not invited';
  end if;
  return new;
end;
$$;

create or replace function household.join_on_signup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into household.members (household_id, user_id, display_name, email)
  select i.household_id, new.id, i.display_name, i.email
  from household.invites i where i.email = lower(new.email)
  on conflict do nothing;
  return new;
end;
$$;

create trigger household_guard_signup before insert on auth.users
  for each row execute function household.guard_signup();
create trigger household_join_on_signup after insert on auth.users
  for each row execute function household.join_on_signup();

-- ---------------------------------------------------------------- RLS

alter table household.households         enable row level security;
alter table household.invites            enable row level security;
alter table household.members            enable row level security;
alter table household.tasks              enable row level security;
alter table household.providers          enable row level security;
alter table household.bills              enable row level security;
alter table household.task_events        enable row level security;
alter table household.shopping_items     enable row level security;
alter table household.push_subscriptions enable row level security;
alter table household.reminder_log       enable row level security;

create policy "members read" on household.households
  for select to authenticated using (household.is_member(id));

create policy "members read" on household.members
  for select to authenticated using (household.is_member(household_id));
create policy "self rename" on household.members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Same rule for every shared table: you see and change only your household's rows.
do $$
declare tbl text;
begin
  foreach tbl in array array['tasks', 'providers', 'bills', 'task_events', 'shopping_items'] loop
    execute format(
      'create policy "household rows" on household.%I for all to authenticated
         using (household.is_member(household_id))
         with check (household.is_member(household_id))', tbl);
  end loop;
end $$;

create policy "own subscriptions" on household.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and household.is_member(household_id));

-- invites and reminder_log: no policies -> only the worker (service_role) can touch them.

-- ---------------------------------------------------------------- grants

grant select, insert, update, delete on all tables in schema household to authenticated;
revoke all on household.invites, household.reminder_log from authenticated;
grant usage, select on all sequences in schema household to authenticated;
grant all on all tables in schema household to service_role;
grant usage, select on all sequences in schema household to service_role;
grant execute on function household.complete_task(bigint, numeric, text, uuid, bigint, date) to authenticated, service_role;
grant execute on function household.is_member(uuid) to authenticated, service_role;
revoke execute on function household.complete_task(bigint, numeric, text, uuid, bigint, date) from anon, public;
revoke execute on function household.is_member(uuid) from anon, public;
revoke execute on function household.guard_signup() from anon, authenticated, public;
revoke execute on function household.join_on_signup() from anon, authenticated, public;

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table household.shopping_items, household.tasks;
