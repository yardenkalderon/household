import { IconChevronDown, IconMail, IconPlus, IconSettings } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { bucketOf, daysUntil, longToday, money, shortDate } from '../lib/dates'
import { TaskIcon } from '../lib/icons'
import {
  completeTask, doneLabel, isPayLink, lastEvent, needsAttention, openBill, summary, whoLabel,
} from '../lib/model'
import type { Bill, Member, Task, TaskEvent } from '../lib/supabase'
import { TaskDetails } from './TaskDetails'
import { TaskForm } from './TaskForm'

type Props = {
  tasks: Task[]; bills: Bill[]; events: TaskEvent[]; members: Member[]; myId: string; householdId: string
  workerLate: string | null
  reload: () => void; onSettings: () => void; onTaskChanged: (t: Task) => void
  onBillsPaid: (taskId: number) => void
  openTaskId: number | null; setOpenTaskId: (id: number | null) => void
}

const monthName = () => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', month: 'long' }).format(new Date())

const byDue = (a: Task, b: Task) => (a.next_due ?? '9999').localeCompare(b.next_due ?? '9999')

export function Home(p: Props) {
  const { tasks, bills, events, members, myId } = p
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [showAuto, setShowAuto] = useState(false)

  const open = tasks.filter((t) => !t.done_at)
  const attention = open.filter((t) => needsAttention(t, bills)).sort(byDue)
  const rest = open.filter((t) => !attention.includes(t))
  const manualBills = rest.filter((t) => t.is_bill && !t.autopay).sort(byDue)
  const autoBills = rest.filter((t) => t.is_bill && t.autopay).sort(byDue)
  // Undated chores close the list (not hidden), so something just added never seems to vanish.
  const chores = rest.filter((t) => !t.is_bill).sort(byDue)
  const s = summary(tasks, bills, events)
  const autoTotal = autoBills.reduce((sum, t) => sum + (t.amount ?? 0), 0)
  const me = members.find((m) => m.user_id === myId)?.display_name
  const selected = p.openTaskId != null ? tasks.find((t) => t.id === p.openTaskId) : undefined

  async function complete(t: Task) {
    setBusyId(t.id)
    await completeTask(t, p.onTaskChanged, p.reload, p.onBillsPaid)
    setBusyId(null)
  }

  function subtitle(t: Task): string {
    const parts: string[] = []
    const bill = openBill(t, bills)
    if (t.kind === 'consumption') {
      if (t.next_due) parts.push(`משוער ~${shortDate(t.next_due)}`)
    } else {
      if (t.amount != null) parts.push((t.amount_estimated ? '~' : '') + money(t.amount))
      else if (bill) parts.push('סכום באתר הספק')
      if (t.next_due) parts.push(t.autopay ? `ייגבה ~${shortDate(t.next_due)}` : `עד ${shortDate(t.next_due)}`)
      else if (bill) parts.push('תאריך לא ידוע')
    }
    const last = lastEvent(t, events)
    if (last && !needsAttention(t, bills) && daysUntil(last.done_on) >= -35) {
      const who = whoLabel(last.done_by, members, myId)
      parts.unshift(`✓ ${t.is_bill ? 'שולם' : 'בוצע'} ${shortDate(last.done_on)}${who ? ` ע"י ${who}` : ''}`)
    } else if (t.assignee_id && t.assignee_id !== myId) {
      parts.push(whoLabel(t.assignee_id, members, myId))
    }
    const n = t.next_due ? daysUntil(t.next_due) : 0
    const late = t.next_due && n < 0 && !t.autopay ? `באיחור ${-n === 1 ? 'יום' : `${-n} ימים`} · ` : ''
    return late + parts.join(' · ')
  }

  function action(t: Task) {
    if (t.autopay) return <span className="shrink-0 rounded-lg bg-soft px-2.5 py-2 text-xs text-ink-2">אוטומטי</span>
    const last = lastEvent(t, events)
    if (t.is_bill && !t.next_due && !openBill(t, bills) && last && daysUntil(last.done_on) >= -35) {
      return <span className="shrink-0 rounded-lg bg-brand-soft px-2.5 py-2 text-xs text-brand">שולם ✓</span>
    }
    const bill = openBill(t, bills)
    if (bill && isPayLink(bill.link) && needsAttention(t, bills)) {
      return (
        <a href={bill.link} target="_blank" rel="noopener noreferrer"
          className="flex min-h-11 shrink-0 items-center rounded-xl bg-brand px-3.5 text-sm font-medium text-white dark:text-page active:scale-95">
          לתשלום ↗
        </a>
      )
    }
    return (
      <button onClick={() => complete(t)} disabled={busyId === t.id}
        className="min-h-11 shrink-0 rounded-xl border border-line px-3.5 text-sm active:scale-95 disabled:opacity-50">
        {busyId === t.id ? '…' : doneLabel(t)}
      </button>
    )
  }

  function row(t: Task) {
    const b = bucketOf(t.next_due)
    const tone = t.autopay ? 'bg-soft text-ink-2'
      : b === 'late' ? 'bg-late-soft text-late' : b === 'week' ? 'bg-week-soft text-week' : 'bg-soft text-ink-2'
    return (
      <li key={t.id} className="flex items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0">
        <button onClick={() => p.setOpenTaskId(t.id)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}><TaskIcon name={t.icon} /></span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[15px] font-medium">
              <span className="truncate">{t.title}</span>
              {openBill(t, bills) && !t.autopay && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-mail-soft px-1.5 text-[11px] font-normal text-mail">
                  <IconMail size={12} /> חדש
                </span>
              )}
            </span>
            <span className={`block truncate text-xs ${b === 'late' && !t.autopay ? 'text-late' : 'text-ink-2'}`}>{subtitle(t)}</span>
          </span>
        </button>
        {action(t)}
      </li>
    )
  }

  const section = (title: string, children: ReactNode) => (
    <section>
      <h2 className="mx-1 mt-6 mb-1.5 text-sm font-medium text-ink-2">{title}</h2>
      <ul className="overflow-hidden rounded-xl border border-line bg-card">{children}</ul>
    </section>
  )

  return (
    <div className="px-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">{me ? `שלום ${me}` : 'הבית שלנו'}</h1>
          <p className="text-sm text-ink-2">{longToday()}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={p.onSettings} aria-label="הגדרות" className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card text-ink-2">
            <IconSettings size={20} stroke={1.75} />
          </button>
          <button onClick={() => setAdding(true)} aria-label="הוספה" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-white dark:text-page">
            <IconPlus size={22} stroke={2} />
          </button>
        </div>
      </header>

      {p.workerLate && (
        <p className="mt-3 rounded-lg bg-week-soft px-3 py-2 text-sm text-week">
          קליטת המייל והתזכורות לא רצו מאז {p.workerLate}. ייתכן שחשבונות אחרונים עוד לא הופיעו.
        </p>
      )}

      <div className="mt-4 rounded-xl border border-line bg-card px-4 py-3">
        <div className="text-xs text-ink-2">נשאר לשלם ב-30 הימים הקרובים</div>
        <div className="text-2xl font-medium">
          {money(s.toPay)}
          {s.unknown > 0 && (
            <span className="text-base font-normal text-ink-2"> + {s.unknown === 1 ? 'חשבון אחד' : `${s.unknown} חשבונות`} בלי סכום</span>
          )}
        </div>
        {(s.auto > 0 || s.paidThisMonth > 0) && (
          <div className="mt-0.5 text-xs text-ink-2">
            {[s.auto > 0 && `ועוד ~${money(s.auto)} שייגבו אוטומטית`, s.paidThisMonth > 0 && `כבר שולם ב${monthName()}: ${money(s.paidThisMonth)}`]
              .filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      {open.length === 0 && (
        <div className="mt-12 text-center">
          <p className="font-medium">הכול מסודר</p>
          <p className="mt-1 text-sm text-ink-2">אין מטלות פתוחות. חשבונות מהמייל יופיעו כאן לבד.</p>
        </div>
      )}

      {attention.length > 0 && section(`לטיפול עכשיו (${attention.length})`, attention.map(row))}

      {(manualBills.length > 0 || autoBills.length > 0) && section('חשבונות', (
        <>
          {manualBills.map(row)}
          {autoBills.length > 0 && (
            <li className="border-t border-line first:border-t-0">
              <button onClick={() => setShowAuto((v) => !v)} className="flex min-h-12 w-full items-center justify-between px-3 text-sm text-ink-2">
                <span>{autoBills.length} בהוראת קבע · ~{money(autoTotal)}</span>
                <IconChevronDown size={18} className={showAuto ? 'rotate-180' : ''} />
              </button>
              {showAuto && <ul className="border-t border-line">{autoBills.map(row)}</ul>}
            </li>
          )}
        </>
      ))}

      {chores.length > 0 && section('מטלות', chores.map(row))}

      {selected && (
        <TaskDetails
          task={selected} bills={bills} events={events.filter((e) => e.task_id === selected.id)}
          members={members} myId={myId}
          onClose={() => p.setOpenTaskId(null)}
          onEdit={() => { setEditing(selected); p.setOpenTaskId(null) }}
          onTaskChanged={p.onTaskChanged} reload={p.reload} onBillsPaid={p.onBillsPaid}
        />
      )}
      {(adding || editing) && (
        <TaskForm
          task={editing} members={members} householdId={p.householdId} myId={myId}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSaved={p.reload}
        />
      )}
    </div>
  )
}
