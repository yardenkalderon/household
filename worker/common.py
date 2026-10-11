"""Shared setup for the household worker: config, DB client, dates, icons."""
import logging
import os
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

from supabase import ClientOptions, create_client

TZ = ZoneInfo('Asia/Jerusalem')

logging.basicConfig(format='%(asctime)s %(levelname)s %(name)s: %(message)s', level=logging.INFO)
logging.getLogger('httpx').setLevel(logging.WARNING)
log = logging.getLogger('household')


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise SystemExit(f'missing env var {name}')
    return value


def db():
    return create_client(
        env('SUPABASE_URL'), env('SUPABASE_SECRET_KEY'),
        options=ClientOptions(schema='household'),
    )


def now_il() -> datetime:
    return datetime.now(TZ)


def today_il() -> date:
    return now_il().date()


def short_date(d: str | date) -> str:
    d = date.fromisoformat(d) if isinstance(d, str) else d
    return d.strftime('%d.%m') if d.year == today_il().year else d.strftime('%d.%m.%y')


def money(n: float) -> str:
    return f'{round(n):,} ₪'


# Keep in sync with web/src/lib/icons.tsx
_ICON_KEYWORDS = [
    (r'חשמל', 'bolt'),
    (r'מים|תאגיד', 'droplet'),
    (r'גז', 'flame'),
    (r'אינטרנט|בזק|הוט|hot|סיבים', 'wifi'),
    (r'פרטנר|סלקום|פלאפון|גולן|טלפון|סלולר', 'phone'),
    (r'ועד', 'building'),
    (r'ארנונה|עירייה|עיריית', 'receipt'),
    (r'ביטוח', 'shield'),
    (r'טסט|רכב|רישיון|מוסך', 'car'),
    (r'חניה|חנייה', 'parking'),
]


def icon_for(title: str) -> str:
    for pattern, icon in _ICON_KEYWORDS:
        if re.search(pattern, title, re.IGNORECASE):
            return icon
    return 'checklist'
