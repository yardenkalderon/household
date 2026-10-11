import { useState, type FormEvent } from 'react'
import { addDays, money, shortDate, todayIL } from '../lib/dates'
import { iconFor } from '../lib/icons'
import { supabase, type Bill, type Member, type Task, type TaskKind } from '../lib/supabase'
import { Button, Field, Sheet, toast } from './ui'

type Repeat = 'once' | 'm1' | 'm2' | 'm3' | 'm6' | 'm12' | 'consumption'

const REPEATS: [Repeat, string][] = [
  ['once', 'פעם אחת'],
  ['m1', 'כל חודש'],
  ['m2', 'כל חודשיים'],
  ['m3', 'כל 3 חודשים'],
  ['m6', 'כל חצי שנה'],
  ['m12', 'כל שנה'],
  ['consumption', 'לפי צריכה (כמו גז)'],
]

function repeatOf(t: Task): Repeat {
  if (t.kind === 'consumption') return 'consumption'
  if (t.kind === 'once') return 'once'
  return (`m${t.interval_months ?? 1}` as Repeat)
}

export function TaskForm({
  task, members, householdId, myId, bill, onClose, onSaved,
}: {
  task: Task | null; members: Member[]; householdId: string; myId: string; bill?: Bill
  onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [repeat, setRepeat] = useState<Repeat>(task ? repeatOf(task) : 'once')
  const [due, setDue] = useState(task?.next_due ?? addDays(todayIL(), 7))
  const [assignee, setAssignee] = useState(task?.assignee_id ?? myId)
  const [amount, setAmount] = useState(task?.amount != null ? String(task.amount) : '')
  const [gasDays, setGasDays] = useState(String(task?.interval_days ?? 45))
  const [autopay, setAutopay] = useState(task?.autopay ?? false)
  const [remind, setRemind] = useState(String(task?.remind_days_before ?? 3))
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('כתבו שם למטלה')
    if (!due) return setError('בחרו תאריך')
    const amt = amount.trim() ? Number(amount.replace(/[,₪\s]/g, '')) : null
    if (amt != null && (!Number.isFinite(amt) || amt < 0)) return setError('הסכום צריך להיות מספר')
    const days = Number(gasDays)
    if (repeat === 'consumption' && (!Number.isInteger(days) || days < 1)) return setError('כמה ימים בערך בין הזמנות?')

    const kind: TaskKind = repeat === 'once' ? 'once' : repeat === 'consumption' ? 'consumption' : 'recurring'
    const row = {
      household_id: householdId,
      title: title.trim(),
      icon: task?.icon && task.title === title.trim() ? task.icon : iconFor(title),
      kind,
      interval_months: kind === 'recurring' ? Number(repeat.slice(1)) : null,
      interval_days: kind === 'consumption' ? days : null,
      anchor_day: kind === 'recurring' ? Number(due.slice(8, 10)) : null,
      next_due: due,
      assignee_id: assignee || null,
      amount: amt,
      amount_estimated: task && amt === task.amount ? task.amount_estimated : false,
      autopay,
      remind_days_before: Number(remind),
      notes: notes.trim() || null,
    }
    setBusy(true)
    const { error } = task
      ? await supabase.from('tasks').update(row).eq('id', task.id)
      : await supabase.from('tasks').insert(row)
    setBusy(false)
    if (error) return setError('השמירה נכשלה. בדקו חיבור לאינטרנט ונסו שוב.')
    toast(task ? 'נשמר' : 'נוספה מטלה')
    onSaved()
    onClose()
  }

  async function remove() {
    if (!task || !confirm(`למחוק את "${task.title}"?`)) return
    const { error } = await supabase.from('tasks').delete().eq('id', task.id)
    if (error) return setError('המחיקה נכשלה')
    toast('נמחק')
    onSaved()
    onClose()
  }

  return (
    <Sheet title={task ? 'עריכת מטלה' : 'מטלה חדשה'} onClose={onClose}>
      {bill && (
        <div className="mb-4 rounded-xl bg-mail-soft p-3 text-sm text-mail">
          <div className="font-medium">{bill.kind === 'receipt' ? 'קבלה מהמייל' : 'חשבון מהמייל'}: {bill.provider_name ?? ''}</div>
          <div>
            {bill.amount != null ? money(bill.amount) : 'סכום לא ידוע'}
            {bill.due_date && ` · לתשלום עד ${shortDate(bill.due_date)}`}
            {bill.period && ` · ${bill.period}`}
          </div>
          {bill.summary && <div className="mt-1 opacity-80">{bill.summary}</div>}
          {bill.link?.startsWith('https://') && (
            <a href={bill.link} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-block rounded-lg bg-card px-3 py-1.5 font-medium text-mail">
              פתיחת החשבון באתר ↗
            </a>
          )}
        </div>
      )}
      <form onSubmit={save} className="space-y-3 pb-4">
        <Field label="מה צריך לעשות">
          <input value={title} onChange={(e) => { setTitle(e.target.value); setError('') }} placeholder="לחדש תו חניה" autoFocus={!task} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="חזרה">
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              {REPEATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="אחראי/ת">
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={repeat === 'consumption' ? 'ההזמנה הבאה בערך' : repeat === 'once' ? 'עד מתי' : 'המועד הבא'}>
            <input type="date" value={due} onChange={(e) => { setDue(e.target.value); setError('') }} />
          </Field>
          <Field label="סכום (לא חובה)">
            <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }} placeholder="₪" />
          </Field>
        </div>
        {repeat === 'consumption' && (
          <Field label="בערך כל כמה ימים מזמינים?" hint="אחרי כמה הזמנות האפליקציה תחשב את זה לבד לפי ההיסטוריה.">
            <input inputMode="numeric" value={gasDays} onChange={(e) => { setGasDays(e.target.value); setError('') }} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="תזכורת">
            <select value={remind} onChange={(e) => setRemind(e.target.value)}>
              {[['0', 'ביום עצמו'], ['1', 'יום לפני'], ['3', '3 ימים לפני'], ['7', 'שבוע לפני'], ['14', 'שבועיים לפני'], ['30', 'חודש לפני']]
                .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <label className="flex items-end gap-2 pb-3 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-brand" style={{ width: 20 }} checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
            בהוראת קבע (בלי תזכורת)
          </label>
        </div>
        <Field label="הערות">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="מספר לקוח, טלפון של הספק…" />
        </Field>
        {error && <p className="text-sm text-late">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="submit" variant="primary" disabled={busy} className="flex-1">{task ? 'שמירה' : 'הוספה'}</Button>
          {task && <Button variant="danger" onClick={remove}>מחיקה</Button>}
        </div>
      </form>
    </Sheet>
  )
}
