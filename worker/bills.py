"""Reads the house mailbox and turns bills into tasks."""
import imaplib
from datetime import date, timedelta

import push
from common import env, icon_for, log, money, short_date, today_il
from extract import CATEGORY_TITLES, classify, parse


def _domain(sender: str) -> str:
    return sender.split('@')[-1] if '@' in sender else sender


def find_provider(client, household_id: str, sender: str, provider_name: str | None, category: str) -> dict | None:
    """Matches on sender AND service: Partner sends both internet and electricity bills from one address."""
    providers = client.table('providers').select('*').eq('household_id', household_id).execute().data or []
    providers = [p for p in providers if p.get('category') in (None, category)]
    domain = _domain(sender)
    for p in providers:
        if any(pat and (pat == sender or pat == domain or domain.endswith('.' + pat)) for pat in p['sender_patterns']):
            return p
    if provider_name:
        for p in providers:
            if p['name'] == provider_name:
                return p
    return None


def next_month_estimate(months: int) -> str:
    """For autopay bills with no due date: the next charge is about one period from today."""
    t = today_il()
    m = t.month - 1 + months
    y, m = t.year + m // 12, m % 12 + 1
    return date(y, m, min(t.day, 28)).isoformat()


def ensure_task(client, household_id: str, provider: dict | None, info: dict) -> dict:
    """The recurring task this provider's bills belong to; created on first sight."""
    if provider and provider.get('task_id'):
        rows = client.table('tasks').select('*').eq('id', provider['task_id']).execute().data
        if rows:
            return rows[0]
    title, months = CATEGORY_TITLES[info['category']]
    title = title or info['provider'] or 'חשבון'
    if info['provider'] and info['category'] != 'other':
        title = f"{title} ({info['provider']})" if title != info['provider'] else title
    task = client.table('tasks').insert({
        'household_id': household_id,
        'title': title,
        'icon': icon_for(f"{title} {info['provider'] or ''}"),
        'kind': 'recurring',
        'interval_months': months,
        'next_due': info['due_date'] or (next_month_estimate(months) if info['autopay'] else None),
        'anchor_day': int(info['due_date'][8:10]) if info['due_date'] else None,
        'amount': info['amount'],
        'autopay': info['autopay'],
        'notes': 'נוצר אוטומטית מחשבון במייל',
        'is_bill': True,
    }).execute().data[0]
    log.info('created task %s for a new provider', task['id'])
    return task


def apply(client, household_id: str, mail: dict, info: dict) -> tuple[str | None, int | None]:
    """Saves the bill and updates its task. Returns (notification text or None, task id)."""
    note, task_id = _apply(client, household_id, mail, info)
    return note, task_id


def _apply(client, household_id: str, mail: dict, info: dict) -> tuple[str | None, int | None]:
    exists = client.table('bills').select('id').eq('household_id', household_id) \
        .eq('email_message_id', mail['message_id']).execute().data
    if exists:
        return None, None

    provider = find_provider(client, household_id, mail['sender'], info['provider'], info['category'])
    # The same bill forwarded again (by the other filter, or by hand) has a new Message-ID: skip it.
    if provider and provider.get('task_id') and info['amount'] is not None and info['due_date']:
        same = client.table('bills').select('id').eq('task_id', provider['task_id']) \
            .eq('amount', info['amount']).eq('due_date', info['due_date']).limit(1).execute().data
        if same:
            log.info('duplicate of an existing bill, skipped')
            return None, None
    if provider and provider.get('autopay'):
        info = {**info, 'autopay': True}  # once marked as standing order, every bill from it is
    is_new_task = not (provider and provider.get('task_id'))
    task = ensure_task(client, household_id, provider, info)
    if not provider:
        provider = client.table('providers').insert({
            'household_id': household_id,
            'name': info['provider'] or task['title'],
            'sender_patterns': [_domain(mail['sender'])],
            'task_id': task['id'],
            'autopay': info['autopay'],
            'category': info['category'],
        }).execute().data[0]
    elif provider.get('task_id') != task['id']:
        client.table('providers').update({'task_id': task['id']}).eq('id', provider['id']).execute()
        provider = {**provider, 'task_id': task['id']}

    bill = client.table('bills').insert({
        'household_id': household_id, 'provider_id': provider['id'], 'task_id': task['id'],
        'kind': info['kind'], 'provider_name': info['provider'], 'category': info['category'], 'amount': info['amount'],
        'due_date': info['due_date'], 'period': info['period'], 'email_message_id': mail['message_id'],
        'email_from': mail['sender'], 'subject': mail['subject'][:300], 'received_at': mail['received_at'],
        'summary': info['summary'], 'status': 'new' if info['kind'] == 'bill' else 'paid', 'link': mail.get('link'),
        # No link recognised: keep what was there (private DB) so the matcher can be fixed.
        'link_candidates': None if mail.get('link') else [{'label': l[:80], 'url': u[:300]} for u, l in mail.get('links', [])],
    }).execute().data[0]

    name = info['provider'] or task['title']

    # An old bill (forwarded late, or an archive) is kept as history and never overwrites a newer one.
    newer_q = client.table('bills').select('id').eq('task_id', task['id']).neq('id', bill['id'])
    newer = (newer_q.gt('due_date', info['due_date']) if info['due_date']
             else newer_q.gt('received_at', mail['received_at'] or '9999-12-31')).limit(1).execute().data
    if newer and not info['due_date']:
        client.table('bills').update({'status': 'paid'}).eq('id', bill['id']).execute()
        log.info('old bill stored as history')
        return None, None
    if info['due_date'] and (newer or (date.fromisoformat(info['due_date']) - today_il()).days < -45):
        client.table('bills').update({'status': 'paid'}).eq('id', bill['id']).execute()
        log.info('old bill stored as history')
        return None, None

    if info['kind'] == 'receipt':
        if is_new_task:
            return f'התקבלה קבלה מ{name}. פתחתי מטלה "{task["title"]}" למעקב', task['id']
        due = task.get('next_due')
        if not task.get('done_at') and (not due or abs((date.fromisoformat(due) - today_il()).days) <= 60):
            client.rpc('complete_task', {
                'p_task_id': task['id'], 'p_amount': info['amount'], 'p_source': 'email', 'p_bill_id': bill['id'],
                'p_expected_due': task.get('next_due'),  # already marked paid in the app -> no double advance
            }).execute()
            return f'התקבלה קבלה מ{name}. סימנתי את "{task["title"]}" כשולם', task['id']
        return None, None

    # A newer bill replaces the previous unpaid one for the same task.
    client.table('bills').update({'status': 'ignored'}).eq('task_id', task['id']) \
        .eq('status', 'new').neq('id', bill['id']).execute()

    update = {'amount_estimated': False, 'is_bill': True}
    if info['amount'] is not None:
        update['amount'] = info['amount']
    if info['due_date']:
        update['next_due'] = info['due_date']
        update['anchor_day'] = int(info['due_date'][8:10])  # the real charge/pay day, not the invoice date
    elif info['autopay'] and task.get('interval_months'):
        update['next_due'] = next_month_estimate(task['interval_months'])
    if info['autopay']:
        update['autopay'] = True
    client.table('tasks').update(update).eq('id', task['id']).execute()

    parts = [money(info['amount']) if info['amount'] is not None else 'סכום לא ידוע']
    if info['due_date']:
        parts.append(f"לתשלום עד {short_date(info['due_date'])}")
    if info['autopay'] or task.get('autopay'):
        parts.append('בהוראת קבע')
    return f"חשבון {name}: " + ' · '.join(parts), task['id']


def run(client, household_id: str) -> int:
    imap = imaplib.IMAP4_SSL('imap.gmail.com')
    # Google shows app passwords as "abcd efgh ijkl mnop"; accept them pasted either way.
    imap.login(env('IMAP_USER').strip(), ''.join(env('IMAP_PASSWORD').split()))
    imap.select('INBOX')
    # Not "UNSEEN": opening the house mailbox by hand must not hide a bill. Every handled email is
    # recorded in mail_log, so looking back a few days is safe.
    since = (today_il() - timedelta(days=4)).strftime('%d-%b-%Y')
    status, data = imap.search(None, 'SINCE', since)
    ids = data[0].split() if status == 'OK' else []
    done = {r['message_id'] for r in client.table('mail_log').select('message_id')
            .eq('household_id', household_id).gte('processed_at', (today_il() - timedelta(days=10)).isoformat())
            .execute().data or []}
    handled = 0
    members = [m['user_id'] for m in push.members_of(client, household_id)]
    for msg_id in ids[-40:]:
        status, parts = imap.fetch(msg_id, '(BODY.PEEK[])')
        if status != 'OK' or not parts or not isinstance(parts[0], tuple):
            continue
        mail = parse(parts[0][1])
        if mail['message_id'] in done:
            continue
        try:
            info = classify(mail)
        except RuntimeError as e:
            log.error('skipped an email: %s', type(e).__name__)
            continue  # retried next run
        # The repo is public, so Actions logs are too: never log senders, providers or amounts.
        log.info('email classified as %s', info['kind'])
        try:
            note, task_id = apply(client, household_id, mail, info) if info['kind'] in ('bill', 'receipt') else (None, None)
        except Exception as e:
            log.error('could not save an email: %s', type(e).__name__)
            continue  # retried next run; the rest of the inbox still goes through
        client.table('mail_log').upsert({'household_id': household_id, 'message_id': mail['message_id'],
                                         'kind': info['kind']}).execute()
        imap.store(msg_id, '+FLAGS', '\\Seen')
        if note:
            push.send(client, members, 'הבית שלנו', note, tag=f"bill-{mail['message_id'][-20:]}", task_id=task_id)
        handled += 1
    imap.logout()
    return handled
