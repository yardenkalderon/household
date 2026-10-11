# הבית שלנו

אפליקציה לטלפון (PWA) לניהול משק בית של שני אנשים: מטלות חוזרות, חשבונות שנקלטים מהמייל, רשימת קניות משותפת ותזכורות.

```
המיילים שלכם ──(כלל העברה)──▶ Gmail של הבית
                                   │ IMAP, כל 15 דק'
                                   ▼
            worker/ (Python, GitHub Actions): חילוץ חשבון עם Groq ← מטלה ← Web Push
                                   │
                                   ▼
            Supabase (סכמה household, RLS) ◀──▶ web/ (React PWA, GitHub Pages)
```

| תיקייה | מה יש בה |
|---|---|
| `supabase/migrations/` | הטבלאות, ההרשאות (RLS) והפונקציה `complete_task` שמקדמת תאריכים |
| `web/` | האפליקציה. `npm run dev` להרצה מקומית, `npm run build` לבנייה |
| `worker/` | קריאת המייל והתזכורות. `python worker/run.py` |
| `.github/workflows/` | פריסת האפליקציה, והרצת ה-worker כל 15 דקות |

## עקרונות
- **ישות אחת לכל מה שצריך לעשות** (`tasks`): חד-פעמי, חוזר (כל N חודשים), או לפי צריכה (גז: המועד הבא לפי ממוצע ההזמנות הקודמות).
- **חשבון מהמייל הוא מופע של מטלה חוזרת.** חשבון חשמל מעדכן את המטלה "חשבון חשמל" (סכום ותאריך), ולא יוצר מטלה חדשה. קבלה מסמנת את המטלה כשולמה.
- **הרשמה רק בהזמנה:** מייל שאינו ב-`household.invites` לא יכול לפתוח חשבון.
- **הבית חי בסכמה נפרדת** בפרויקט Supabase של בוט ההוצאות, ולא נוגע בטבלאות שלו.

## סודות (GitHub → Settings → Secrets and variables → Actions)
| שם | מה |
|---|---|
| `SUPABASE_SECRET_KEY` | מפתח secret נפרד לבית (לא של הבוט) |
| `GROQ_API_KEY` | מפתח Groq |
| `IMAP_USER` / `IMAP_PASSWORD` | Gmail של הבית + סיסמת אפליקציה |
| `VAPID_PRIVATE_KEY` | מפתח לשליחת התראות (המפתח הציבורי נמצא ב-`web/.env`) |

משתנה `HOUSE_EMAIL` (Variables) מציג באפליקציה לאיזו כתובת להעביר חשבונות. `GROQ_TEXT_MODEL` מאפשר להחליף מודל אם Groq מוציא אותו משימוש.

## בדיקות
```bash
.venv/bin/python -m pytest worker/tests
cd web && npm run build
```
