import os
import sys
from datetime import date, timedelta
from email.message import EmailMessage

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
os.environ.setdefault('GROQ_API_KEY', 'test')

import extract  # noqa: E402
import reminders  # noqa: E402
from common import icon_for, today_il  # noqa: E402


def minimal_pdf(text: str) -> bytes:
    """A one-page PDF with a single line of (ASCII) text, built by hand."""
    stream = f'BT /F1 12 Tf 40 700 Td ({text}) Tj ET'.encode()
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    out, offsets = b'%PDF-1.4\n', []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    out += b''.join(b'%010d 00000 n \n' % off for off in offsets)
    out += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF' % (len(objs) + 1, xref)
    return out


def make_mail(sender='Thankyou@partner.net.il', subject='החשבונית החודשית שלך', html=None, plain=None, pdf=None):
    m = EmailMessage()
    m['From'] = f'Partner <{sender}>'
    m['To'] = 'house@gmail.com'
    m['Subject'] = subject
    m['Message-ID'] = '<abc@partner>'
    m['Date'] = 'Mon, 29 Sep 2026 15:56:49 +0000'
    m.set_content(plain or 'ראו חשבונית מצורפת')
    if html:
        m.add_alternative(html, subtype='html')
    if pdf:
        m.add_attachment(pdf, maintype='application', subtype='octet-stream', filename='invoice.pdf')
    return m.as_bytes()


def test_parse_reads_pdf_attachment_with_octet_stream_type():
    mail = extract.parse(make_mail(pdf=minimal_pdf('Amount due 189.90 ILS')))
    assert mail['sender'] == 'thankyou@partner.net.il'
    assert mail['has_pdf']
    assert '189.90' in mail['text']
    assert mail['message_id'] == '<abc@partner>'


def test_parse_finds_original_sender_of_forwarded_mail():
    body = ('---------- Forwarded message ---------\nFrom: חברת החשמל <noreply@iec.co.il>\n'
            'Subject: חשבון חשמל\n\nסכום לתשלום 412 ש"ח')
    mail = extract.parse(make_mail(sender='roni@gmail.com', plain=body))
    assert mail['sender'] == 'noreply@iec.co.il'


def test_html_to_text():
    assert extract.html_to_text('<p>סכום&nbsp;לתשלום</p><style>x{}</style><b>412</b>') .split() == ['סכום', 'לתשלום', '412']


def test_clean_rejects_invented_or_broken_values():
    far = (today_il() + timedelta(days=900)).isoformat()
    c = extract._clean({'kind': 'bill', 'amount': '₪1,234.50', 'due_date': far, 'category': 'nope', 'provider': ' פרטנר '})
    assert c['amount'] == 1234.5 and c['due_date'] is None and c['category'] == 'other' and c['provider'] == 'פרטנר'
    assert extract._clean({'kind': 'weird', 'amount': -5})['kind'] == 'other'
    assert extract._clean({'amount': -5})['amount'] is None


def test_reminder_stages():
    today = date(2026, 10, 11)
    t = {'next_due': '2026-10-14', 'remind_days_before': 3, 'autopay': False}
    assert reminders.stage_for(t, today) == 'before'
    assert reminders.stage_for({**t, 'next_due': '2026-10-15'}, today) is None
    assert reminders.stage_for({**t, 'next_due': '2026-10-11'}, today) == 'due'
    assert reminders.stage_for({**t, 'next_due': '2026-10-01'}, today) == 'overdue'
    assert reminders.stage_for({**t, 'autopay': True}, today) is None


def test_reminder_text():
    today = date(2026, 10, 11)
    task = {'title': 'ועד בית', 'kind': 'recurring', 'next_due': '2026-10-12', 'amount': 250}
    title, body = reminders.message(task, 'before', today)
    assert title == 'תזכורת: ועד בית' and 'מחר' in body and '250' in body


def test_icons():
    assert icon_for('חשבון חשמל') == 'bolt'
    assert icon_for('אינטרנט (HOT)') == 'wifi'
    assert icon_for('משהו אחר') == 'checklist'


def test_fix_glyph_names_decodes_reversed_hebrew():
    raw = '/uni05DA/uni05D9/uni05E8/uni05D0/uni05EA 25/09/26'
    assert extract.fix_glyph_names(raw) == 'תאריך 25/09/26'
    assert extract.fix_glyph_names('plain text') == 'plain text'
