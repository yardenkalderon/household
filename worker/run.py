"""Entry point for the scheduled GitHub Action.

    python worker/run.py            # check mail (if configured) + send due reminders
    python worker/run.py --force    # send reminders even before 09:00 (manual test)
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))

import bills  # noqa: E402
import push  # noqa: E402
import reminders  # noqa: E402
from common import db, log  # noqa: E402


def main() -> None:
    client = db()
    client.table('worker_status').update({'last_run_at': datetime.now(timezone.utc).isoformat()}).eq('id', 1).execute()
    households = client.table('households').select('id,name').execute().data or []
    failed = False
    if os.environ.get('IMAP_USER') and os.environ.get('IMAP_PASSWORD'):
        house = next((h for h in households if h['name'] == 'הבית שלנו'), households[0] if households else None)
        try:
            log.info('mail: %d handled', bills.run(client, house['id']))
        except Exception:
            log.exception('mail check failed')
            failed = True
    else:
        log.info('mail: IMAP not configured, skipping')
    try:
        log.info('partner notices: %d sent', push.drain_outbox(client))
    except Exception:
        log.exception('outbox failed')
        failed = True
    try:
        log.info('reminders: %d sent', reminders.run(client, force='--force' in sys.argv))
    except Exception:
        log.exception('reminders failed')
        failed = True
    if not failed:
        client.table('worker_status').update({'last_ok_at': datetime.now(timezone.utc).isoformat()}).eq('id', 1).execute()
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
