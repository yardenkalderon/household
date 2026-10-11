import { IconShare2, IconSquarePlus } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { disablePush, enablePush, pushState, type PushState } from '../lib/push'
import { supabase, type Member } from '../lib/supabase'
import { Button, Sheet, toast } from './ui'

const HOUSE_EMAIL = import.meta.env.VITE_HOUSE_EMAIL as string | undefined

export function Settings({ members, myId, householdId, onClose }: {
  members: Member[]; myId: string; householdId: string; onClose: () => void
}) {
  const [push, setPush] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { pushState().then(setPush) }, [])

  async function togglePush() {
    setBusy(true)
    try {
      if (push === 'on') { await disablePush(); setPush('off'); toast('ההתראות כובו') }
      else { const s = await enablePush(householdId); setPush(s); if (s === 'on') toast('ההתראות הופעלו') }
    } catch {
      toast('לא הצלחנו להפעיל התראות')
    }
    setBusy(false)
  }

  return (
    <Sheet title="הגדרות" onClose={onClose}>
      <section className="rounded-xl border border-line bg-card p-3">
        <h3 className="font-medium">התראות לטלפון</h3>
        {push === 'needs-install' ? (
          <div className="mt-2 space-y-2 text-sm text-ink-2">
            <p>באייפון, התראות עובדות רק כשהאפליקציה מותקנת במסך הבית:</p>
            <p className="flex items-center gap-1">1. לחצו על <IconShare2 size={16} /> (שיתוף) בתחתית Safari</p>
            <p className="flex items-center gap-1">2. בחרו <IconSquarePlus size={16} /> "הוספה למסך הבית"</p>
            <p>3. פתחו את האפליקציה מהאייקון וחזרו לכאן.</p>
          </div>
        ) : push === 'unsupported' ? (
          <p className="mt-1 text-sm text-ink-2">הדפדפן הזה לא תומך בהתראות.</p>
        ) : push === 'denied' ? (
          <p className="mt-1 text-sm text-ink-2">ההתראות חסומות. אפשר להפעיל אותן בהגדרות הטלפון ← התראות ← הבית.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-2">חשבון חדש שהגיע במייל, ותזכורת לפני כל מועד.</p>
            <Button variant={push === 'on' ? 'outline' : 'primary'} onClick={togglePush} disabled={busy || push === null} className="mt-3 w-full">
              {push === 'on' ? 'כיבוי התראות' : 'הפעלת התראות'}
            </Button>
          </>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-line bg-card p-3">
        <h3 className="font-medium">חשבונות מהמייל</h3>
        <p className="mt-1 text-sm text-ink-2">
          {HOUSE_EMAIL
            ? <>העבירו חשבונות (חשמל, מים, אינטרנט) לכתובת <span dir="ltr" className="font-medium text-ink">{HOUSE_EMAIL}</span>, והם ייכנסו לבד כמטלות.</>
            : 'קליטת חשבונות מהמייל עוד לא הוגדרה.'}
        </p>
      </section>

      <section className="mt-3 rounded-xl border border-line bg-card p-3">
        <h3 className="font-medium">מי בבית</h3>
        <ul className="mt-1 text-sm">
          {members.map((m) => (
            <li key={m.user_id} className="flex justify-between py-1">
              <span>{m.display_name}{m.user_id === myId ? ' (אני)' : ''}</span>
              <span dir="ltr" className="text-ink-3">{m.email}</span>
            </li>
          ))}
        </ul>
      </section>

      <Button variant="ghost" className="mt-3 mb-4 w-full" onClick={() => supabase.auth.signOut()}>התנתקות</Button>
    </Sheet>
  )
}
