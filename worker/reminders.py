"""Daily reminders: tells the person responsible that something is coming up or overdue."""
from datetime import date

import push
from common import log, money, short_date, today_il


def stage_for(task: dict, today: date) -> str | None:
    if not task.get('next_due') or task.get('autopay'):
        return None
    days = (date.fromisoformat(task['next_due']) - today).days
    if days < 0:
        return 'overdue'
    if days == 0:
        return 'due'
    if days <= task['remind_days_before']:
        return 'before'
    return None


def message(task: dict, stage: str, today: date) -> tuple[str, str]:
    due = date.fromisoformat(task['next_due'])
    days = (due - today).days
    amount = f"{money(task['amount'])} · " if task.get('amount') is not None else ''
    if task['kind'] == 'consumption':
        title = f"צריך להזמין {task['title']}"
        body = f"לפי ההזמנות הקודמות, זה הזמן (בערך {short_date(due)})"
    elif stage == 'overdue':
        title = f"{task['title']}: באיחור"
        body = f"{amount}היה צריך עד {short_date(due)}"
    elif stage == 'due':
        title = f"{task['title']}: היום"
        body = f"{amount}המועד הוא היום"
    else:
        title = f"תזכורת: {task['title']}"
        body = f"{amount}עד {short_date(due)} ({'מחר' if days == 1 else f'בעוד {days} ימים'})"
    return title, body


def advance_autopay(client, today: date) -> None:
    """Standing-order bills pay themselves: once their date passes, move them to the next period."""
    due = client.table('tasks').select('id,title').eq('autopay', True).eq('kind', 'recurring') \
        .is_('done_at', 'null').lt('next_due', today.isoformat()).execute().data or []
    for task in due:
        client.rpc('complete_task', {'p_task_id': task['id'], 'p_source': 'worker'}).execute()
        log.info('autopay advanced %s (%s)', task['id'], task['title'])


def run(client, force: bool = False) -> int:
    from common import now_il
    if not force and now_il().hour < 9:
        log.info('before 09:00 Israel time, reminders wait')
        return 0
    today = today_il()
    advance_autopay(client, today)
    tasks = client.table('tasks').select('*').is_('done_at', 'null').not_.is_('next_due', 'null').execute().data or []
    sent = 0
    for task in tasks:
        stage = stage_for(task, today)
        if not stage:
            continue
        users = [task['assignee_id']] if task.get('assignee_id') else \
            [m['user_id'] for m in push.members_of(client, task['household_id'])]
        if not push.has_devices(client, users):
            continue  # keep it pending until someone turns on notifications
        # Claim the reminder first so two overlapping runs cannot both send it.
        claim = client.table('reminder_log').upsert(
            {'task_id': task['id'], 'due_date': task['next_due'], 'stage': stage},
            on_conflict='task_id,due_date,stage', ignore_duplicates=True,
        ).execute()
        if not claim.data:
            continue
        title, body = message(task, stage, today)
        delivered = push.send(client, users, title, body, tag=f"task-{task['id']}")
        log.info('reminder %s/%s -> %d device(s)', task['id'], stage, delivered)
        sent += delivered
    return sent
