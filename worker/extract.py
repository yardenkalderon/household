"""Turns a raw email into plain text, then asks the LLM what kind of bill it is."""
import email
import hashlib
import html
import io
import json
import re
from datetime import date
from email.message import Message
from email.utils import parseaddr, parsedate_to_datetime

from groq import Groq
from pypdf import PdfReader

from common import env, log, today_il

TEXT_MODEL = env('GROQ_TEXT_MODEL', 'openai/gpt-oss-120b')
MAX_CHARS = 12_000

_FORWARD_FROM = re.compile(r'(?:From|מאת):\s*(?:"?[^<\n]*"?\s*)?<?([\w.+-]+@[\w.-]+)>?', re.IGNORECASE)


def html_to_text(raw: str) -> str:
    raw = re.sub(r'(?is)<(script|style).*?</\1>', ' ', raw)
    raw = re.sub(r'(?i)<br\s*/?>|</(p|div|tr|li|h\d)>', '\n', raw)
    raw = re.sub(r'<[^>]+>', ' ', raw)
    raw = html.unescape(raw)
    return re.sub(r'[ \t\r\f\v]+', ' ', re.sub(r'\n\s*\n+', '\n', raw)).strip()


def fix_glyph_names(text: str) -> str:
    """Some Israeli invoices (Partner) embed fonts without a Unicode map: pypdf then returns
    glyph names like /uni05EA and Hebrew in visual (reversed) order. Decode both."""
    if '/uni05' not in text:
        return text
    text = re.sub(r'/uni([0-9A-Fa-f]{4})', lambda m: chr(int(m.group(1), 16)), text)
    return re.sub(r'[\u0590-\u05FF"\']{2,}', lambda m: m.group(0)[::-1], text)


_REVERSED_AMOUNT = re.compile(r'(?<![\d.,])(\d{2})\.(\d{1,3}(?:,\d{3})*)(?![\d.,])')


def fix_reversed_amounts(text: str) -> str:
    """Partner's PDFs store numbers in visual order: 398.93 is extracted as "93.398".
    A shekel amount never has 3 digits after the point, so one such number marks the whole
    document as reversed, and every "XX.YYY" in it is swapped back."""
    if not re.search(r'(?<![\d.,])\d{2}\.\d{3}(?![\d.,])', text):
        return text
    return _REVERSED_AMOUNT.sub(lambda m: f'{m.group(2)}.{m.group(1)}', text)


def pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(''):
            return '[PDF מוגן בסיסמה]'
        text = '\n'.join(page.extract_text() or '' for page in reader.pages[:4])
        return fix_reversed_amounts(fix_glyph_names(text)).strip()
    except Exception as e:  # broken or unusual PDFs should not stop the run
        log.warning('pdf parse failed: %s', e)
        return ''


_LINK = re.compile(r'<a\b[^>]*href=["\'](https://[^"\']+)["\'][^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
# Best label first; "view this email in a browser" links are never the invoice.
_LINK_RANKS = [re.compile(p, re.IGNORECASE) for p in (r'חשבונית|invoice', r'תשלום|לשלם|pay', r'חשבון|bill')]
_NOT_INVOICE = re.compile(r'דפדפן|browser|גרסה|גרסת|web ?version|הסרה|unsubscribe', re.IGNORECASE)


def invoice_link(html_parts: list[str]) -> str | None:
    """The "view invoice" / "pay" link, for providers that don't put the amount in the email."""
    links = [(html.unescape(url), html_to_text(label)) for raw in html_parts for url, label in _LINK.findall(raw)]
    links = [(u, l) for u, l in links if len(u) <= 1000 and not _NOT_INVOICE.search(l) and 'webversion' not in u]
    for rank in _LINK_RANKS:
        for url, label in links:
            if rank.search(label):
                return url
    return None


def parse(raw_bytes: bytes) -> dict:
    """Returns sender, subject, date, message id and the combined text of body + PDFs."""
    msg: Message = email.message_from_bytes(raw_bytes)
    sender = parseaddr(msg.get('From', ''))[1].lower()
    subject = str(email.header.make_header(email.header.decode_header(msg.get('Subject', ''))))
    try:
        received = parsedate_to_datetime(msg['Date']).isoformat() if msg.get('Date') else None
    except (TypeError, ValueError):
        received = None

    plain, htmls, pdfs, raw_htmls = [], [], [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = part.get_content_type()
        filename = (part.get_filename() or '').lower()
        payload = part.get_payload(decode=True) or b''
        if ctype == 'application/pdf' or filename.endswith('.pdf'):
            pdfs.append(pdf_text(payload))
        elif ctype == 'text/plain' and not filename:
            plain.append(payload.decode(part.get_content_charset() or 'utf-8', 'replace'))
        elif ctype == 'text/html' and not filename:
            raw_html = payload.decode(part.get_content_charset() or 'utf-8', 'replace')
            raw_htmls.append(raw_html)
            htmls.append(html_to_text(raw_html))
    body = '\n'.join(plain) if any(p.strip() for p in plain) else '\n'.join(htmls)

    # A manually forwarded email comes "from" one of us; the real sender is inside the body.
    forwarded = _FORWARD_FROM.search(body)
    original_sender = forwarded.group(1).lower() if forwarded and re.search(r'forward|הועבר', body, re.I) else sender

    text = f'נושא: {subject}\n\n{body}'
    for i, t in enumerate(pdfs, 1):
        if t:
            text += f'\n\n--- קובץ PDF מצורף {i} ---\n{t}'
    return {
        'message_id': (msg.get('Message-ID') or 'no-id-' + hashlib.sha1(raw_bytes).hexdigest()).strip(),
        'sender': original_sender,
        'subject': subject,
        'received_at': received,
        'text': text[:MAX_CHARS],
        'has_pdf': bool(pdfs),
        'link': invoice_link(raw_htmls),
    }


SYSTEM_PROMPT = """You read Israeli household emails (Hebrew or English) and extract billing data.
Return ONLY a JSON object with these keys:
- "kind": "bill" (a new invoice or a request to pay, INCLUDING invoices that are charged automatically by standing order or credit card), "receipt" (ONLY an explicit confirmation of a payment you made, e.g. "קבלה", "תודה על התשלום", "התשלום התקבל"), or "other" (anything else: ads, newsletters, food or shopping orders, personal mail)
- "provider": short Hebrew provider name, e.g. "חברת החשמל", "מי אביבים", "פרטנר", "בזק", "הוט", "עיריית תל אביב", "פזגז". null if unknown
- "category": one of "electricity", "water", "internet", "phone", "tv", "arnona", "gas", "insurance", "vaad", "other". Decide from the content, not the sender: Partner, Cellcom, Bezeq and others also sell electricity (kWh, קוט"ש, צריכת חשמל, מונה => "electricity")
- "amount": total amount to pay in ILS as a number, or null if it is not written anywhere in the text
- "due_date": last date to pay as "YYYY-MM-DD", or null if not written
- "period": billing period in short Hebrew, e.g. "ספטמבר-אוקטובר 2026", or null
- "autopay": true if the text says it is charged automatically (הוראת קבע, חיוב בכרטיס אשראי, ייגבה), else false
- "summary": one short Hebrew sentence describing the email
Never invent numbers or dates: if they are not in the text, use null."""

CATEGORY_TITLES = {
    'electricity': ('חשבון חשמל', 2), 'water': ('חשבון מים', 2), 'internet': ('אינטרנט', 1),
    'phone': ('חשבון טלפון', 1), 'tv': ('טלוויזיה', 1), 'arnona': ('ארנונה', 2),
    'gas': ('גז', 2), 'insurance': ('ביטוח', 12), 'vaad': ('ועד בית', 1), 'other': (None, 1),
}


def _clean(data: dict) -> dict:
    kind = data.get('kind') if data.get('kind') in ('bill', 'receipt', 'other') else 'other'
    amount = data.get('amount')
    if isinstance(amount, str):
        amount = re.sub(r'[^\d.]', '', amount) or None
    try:
        amount = round(float(amount), 2) if amount is not None else None
    except ValueError:
        amount = None
    if amount is not None and not (0 < amount < 100_000):
        amount = None
    due = data.get('due_date')
    try:
        due = date.fromisoformat(due).isoformat() if due else None
        if due and abs((date.fromisoformat(due) - today_il()).days) > 400:
            due = None  # almost certainly a misread
    except (TypeError, ValueError):
        due = None
    category = data.get('category') if data.get('category') in CATEGORY_TITLES else 'other'
    provider = (data.get('provider') or '').strip()[:60] or None
    return {
        'kind': kind, 'provider': provider, 'category': category, 'amount': amount, 'due_date': due,
        'period': (data.get('period') or None) and str(data['period'])[:60],
        'autopay': bool(data.get('autopay')),
        'summary': (data.get('summary') or '')[:300] or None,
    }


def classify(mail: dict) -> dict:
    client = Groq(api_key=env('GROQ_API_KEY'))
    last_error = None
    for attempt in range(3):
        try:
            completion = client.chat.completions.create(
                model=TEXT_MODEL,
                messages=[
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': f"Sender: {mail['sender']}\nToday: {today_il()}\n\n{mail['text']}"},
                ],
                response_format={'type': 'json_object'},
                max_completion_tokens=2000,
            )
            return _clean(json.loads(completion.choices[0].message.content))
        except json.JSONDecodeError as e:
            last_error = e
            break
        except Exception as e:  # API hiccup: retry
            last_error = e
            log.warning('groq call failed (attempt %d, model %s): %s', attempt + 1, TEXT_MODEL, e)
    raise RuntimeError(f'classification failed: {last_error}')
