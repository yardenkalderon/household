import { IconMail, IconPlus, IconSettings } from '@tabler/icons-react'
import { useState } from 'react'
import { bucketOf, daysUntil, longToday, money, shortDate, todayIL, type Bucket } from '../lib/dates'
import { TaskIcon } from '../lib/icons'
import { supabase, type Bill, type Member, type Task } from '../lib/supabase'
import { TaskForm } from './TaskForm'
import { toast } from './ui'

const SECTIONS: [Bucket, string][] = [['late', 'באיחור'], ['week', 'השבוע'], ['later', 'בהמשך'], ['none', 'בלי תאריך']]

function subtitle(t: Task, who: string | undefined): string {
  const parts: string[] = []
  if (t.kind === 'consumption') {
    if (t.next_due) parts.push(`משוער ~${shortDate(t.next_due)}`)
  } else {
    if (t.amount != null) parts.push((t.amount_estimated ? '~' : '') + money(t.amount))
    if (t.next_due) parts.push(t.autopay ? `ייגבה ~${shortDate(t.next_due)}` : `${t.amount != null ? 'לתשלום עד' : 'עד'} ${shortDate(t.next_due)}`)
  }
  if (who) parts.push(who)
  const n = t.next_due ? daysUntil(t.next_due) : 0
  const late = t.next_due && n < 0 ? `באיחור של ${-n === 1 ? 'יום' : `${-n} ימים`} · ` : ''
  return late + parts.join(' · ')
}

function doneLabel(t: Task): string {
  if (t.kind === 'consumption') return 'הזמנתי'
  if (t.amount != null) return 'שילמתי'
  return 'בוצע'
}

export function Home({
  tasks, bills, members, myId, householdId, reload, onSettings, onTaskChanged,
}: {
  tasks: Task[]; bills: Bill[]; members: Member[]; myId: string; householdId: string
  reload: () => void; onSettings: () => void; onTaskChanged: (t: Task) => void
}) {
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.display_name
  const me = nameOf(myId)
  const newBill = (taskId: number) => bills.find((b) => b.task_id === taskId && b.status === 'new')

  const open = tasks.filter((t) => !t.done_at).sort((a, b) => (a.next_due ?? '9999').localeCompare(b.next_due ?? '9999'))
  const grouped = SECTIONS.map(([b, label]) => [label, open.filter((t) => bucketOf(t.next_due) === b)] as const)
  const urgent = open.filter((t) => !t.autopay && ['late', 'week'].includes(bucketOf(t.next_due))).length
  const month = todayIL().slice(0, 7)
  const monthTotal = open
    .filter((t) => t.amount != null && !t.autopay && t.next_due?.startsWith(month))
    .reduce((s, t) => s + (t.amount ?? 0), 0)

  async function complete(t: Task) {
    setBusyId(t.id)
    const { data, error } = await supabase.rpc('complete_task', { p_task_id: t.id })
    setBusyId(null)
    if (error) return toast('לא הצלחנו לעדכן. נסו שוב.')
    const updated = data as Task
    onTaskChanged(updated)
    if (updated.done_at) toast('סומן כבוצע')
    else if (t.kind === 'consumption') toast(`נרשם. הזמנה הבאה בערך ב-${shortDate(updated.next_due!)}`)
    else toast(`${t.amount != null ? 'שולם' : 'בוצע'}. הבא: ${shortDate(updated.next_due!)}`)
    reload()
  }

  return (
    <div className="px-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">{me ? `שלום ${me}` : 'הבית שלנו'}</h1>
          <p className="text-sm text-ink-2">{longToday()}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onSettings} aria-label="הגדרות" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card text-ink-2">
            <IconSettings size={20} stroke={1.75} />
          </button>
          <button onClick={() => setEditing('new')} aria-label="מטלה חדשה" className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white dark:text-page">
            <IconPlus size={20} stroke={2} />
          </button>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-line bg-card px-3 py-2.5">
          <div className="text-xs text-ink-2">דחוף השבוע</div>
          <div className="text-xl font-medium">{urgent}</div>
        </div>
        <div className="rounded-xl border border-line bg-card px-3 py-2.5">
          <div className="text-xs text-ink-2">לתשלום החודש</div>
          <div className="text-xl font-medium">{money(monthTotal)}</div>
        </div>
      </div>

      {open.length === 0 && (
        <div className="mt-12 text-center">
          <p className="font-medium">עוד אין מטלות</p>
          <p className="mt-1 text-sm text-ink-2">הוסיפו את מה שהבית צריך: ועד בית, חשמל, גז, טסט…</p>
          <button onClick={() => setEditing('new')} className="mt-4 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white dark:text-page">
            הוספת מטלה ראשונה
          </button>
        </div>
      )}

      {grouped.map(([label, list]) => list.length > 0 && (
        <section key={label}>
          <h2 className="mx-1 mt-5 mb-1.5 text-xs text-ink-2">{label}</h2>
          <ul className="overflow-hidden rounded-xl border border-line bg-card">
            {list.map((t) => {
              const b = bucketOf(t.next_due)
              const bill = newBill(t.id)
              return (
                <li key={t.id} className="flex items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0">
                  <button onClick={() => setEditing(t)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      b === 'late' ? 'bg-late-soft text-late' : b === 'week' ? 'bg-week-soft text-week' : 'bg-soft text-ink-2'}`}>
                      <TaskIcon name={t.icon} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[15px] font-medium">
                        <span className="truncate">{t.title}</span>
                        {bill && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-mail-soft px-1.5 text-[11px] font-normal text-mail">
                            <IconMail size={12} /> מהמייל
                          </span>
                        )}
                      </span>
                      <span className={`block truncate text-xs ${b === 'late' ? 'text-late' : 'text-ink-2'}`}>
                        {subtitle(t, nameOf(t.assignee_id))}
                      </span>
                    </span>
                  </button>
                  {t.autopay ? (
                    <span className="shrink-0 rounded-lg bg-soft px-2.5 py-1.5 text-xs text-ink-2">הוראת קבע</span>
                  ) : (
                  <button
                    onClick={() => complete(t)}
                    disabled={busyId === t.id}
                    className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs active:scale-95 disabled:opacity-50"
                  >
                    {busyId === t.id ? '…' : doneLabel(t)}
                  </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {editing && (
        <TaskForm
          task={editing === 'new' ? null : editing}
          bill={editing === 'new' ? undefined : bills.find((b) => b.task_id === editing.id)}
          members={members}
          householdId={householdId}
          myId={myId}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}
