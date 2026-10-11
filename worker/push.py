"""Web Push to the members' installed apps."""
import json

from pywebpush import WebPushException, webpush

from common import env, log


def send(client, user_ids: list[str], title: str, body: str, tag: str | None = None) -> int:
    """Sends to every subscribed device of the given users. Returns how many were delivered."""
    if not user_ids:
        return 0
    subs = client.table('push_subscriptions').select('*').in_('user_id', user_ids).execute().data or []
    payload = json.dumps({'title': title, 'body': body, 'tag': tag}, ensure_ascii=False)
    sent = 0
    for sub in subs:
        try:
            webpush(
                subscription_info={'endpoint': sub['endpoint'], 'keys': {'p256dh': sub['p256dh'], 'auth': sub['auth']}},
                data=payload,
                vapid_private_key=env('VAPID_PRIVATE_KEY'),
                vapid_claims={'sub': env('VAPID_SUBJECT', 'mailto:yardenkal207@gmail.com')},
                ttl=24 * 3600,
            )
            sent += 1
        except WebPushException as e:
            status = getattr(e.response, 'status_code', None)
            if status in (404, 410):  # the phone unsubscribed or the app was removed
                client.table('push_subscriptions').delete().eq('id', sub['id']).execute()
                log.info('removed expired push subscription %s', sub['id'])
            else:
                log.warning('push failed (%s): %s', status, e)
    return sent


def members_of(client, household_id: str) -> list[dict]:
    return client.table('members').select('user_id,display_name').eq('household_id', household_id).execute().data or []


def has_devices(client, user_ids: list[str]) -> bool:
    if not user_ids:
        return False
    rows = client.table('push_subscriptions').select('id').in_('user_id', user_ids).limit(1).execute().data
    return bool(rows)
