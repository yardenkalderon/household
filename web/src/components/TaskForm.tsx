import { IconChevronDown } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { iconFor } from '../lib/icons'
import { supabase, type Member, type Task, type TaskKind } from '../lib/supabase'
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

/** New: just a name (details optional). Edit: every field, and only what changed is saved. */
export function TaskForm({
  task, members, householdId, myId, onClose, onSaved,
}: {
  task: Task | null; members: Member[]; householdId: string; myId: string
  onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [isBill, setIsBill] = useState(task?.is_bill ?? false)
  const [repeat, setRepeat] = useState<Repeat>(task ? repeatOf(task) : 'once')
  const [due, setDue] = useState(task?.next_due ?? '')
  const [assignee, setAssignee] = useState(task?.assignee_id ?? myId)
  const [amount, setAmount] = useState(task?.amount != null ? String(task.amount) : '')
  const [gasDays, setGasDays] = useState(String(task?.interval_days ?? 45))
  const [autopay, setAutopay] = useState(task?.autopay ?? false)
  const [remind, setRemind] = useState(String(task?.remind_days_before ?? 3))
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [more, setMore] = useState(!!task)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function chooseType(bill: boolean) {
    setIsBill(bill)
    if (!task && bill && repeat === 'once') setRepeat('m1')
    if (!task && !bill) { setRepeat('once'); setAutopay(false) }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError(isBill ? 'כתבו שם לחשבון' : 'כתבו מה צריך לעשות')
    const amt = amount.trim() ? Number(amount.replace(/[,₪\s]/g, '')) : null
    if (amt != null && (!Number.isFinite(amt) || amt < 0)) return setError('הסכום צריך להיות מספר')
    const days = Number(gasDays)
    if (repeat === 'consumption' && (!Number.isInteger(days) || days < 1)) return setError('כמה ימים בערך בין הזמנות?')

    const kind: TaskKind = repeat === 'once' ? 'once' : repeat === 'consumption' ? 'consumption' : 'recurring'
    const row: Partial<Task> = {
      title: title.trim(),
      icon: task?.icon && task.title === title.trim() ? task.icon : iconFor(title),
      is_bill: isBill,
      kind,
      interval_months: kind === 'recurring' ? Number(repeat.slice(1)) : null,
      interval_days: kind === 'consumption' ? days : null,
      anchor_day: kind === 'recurring' && due ? Number(due.slice(8, 10)) : null,
      next_due: due || null,
      assignee_id: assignee || null,
      amount: amt,
      autopay: isBill && autopay,
      remind_days_before: Number(remind),
      notes: notes.trim() || null,
    }
    setBusy(true)
    let error
    if (task) {
      // Only send what the user changed, so a bill that arrived meanwhile is not overwritten.
      const changed = Object.fromEntries(
        Object.entries(row).filter(([k, v]) => (task as Record<string, unknown>)[k] !== v),
      ) as Partial<Task>
      if ('amount' in changed) changed.amount_estimated = false
      ;({ error } = Object.keys(changed).length
        ? await supabase.from('tasks').update(changed).eq('id', task.id)
        : { error: null })
    } else {
      ;({ error } = await supabase.from('tasks').insert({ ...row, household_id: householdId }))
    }
    setBusy(false)
    if (error) return setError('השמירה נכשלה. בדקו חיבור לאינטרנט ונסו שוב.')
    toast(task ? 'נשמר' : 'נוסף')
    onSaved()
    onClose()
  }

  async function remove() {
    if (!task || !confirm(`למחוק את "${task.title}" כולל כל ההיסטוריה שלו?\nאם רק סימנתם "שולם" בטעות, עדיף ללחוץ "ביטול" בהיסטוריה.`)) return
    const { error } = await supabase.from('tasks').delete().eq('id', task.id)
    if (error) return setError('המחיקה נכשלה')
    toast('נמחק')
    onSaved()
    onClose()
  }

  const typeButton = (bill: boolean, label: string) => (
    <button type="button" onClick={() => chooseType(bill)}
      className={`min-h-11 flex-1 rounded-lg text-sm ${isBill === bill ? 'bg-card font-medium shadow-sm' : 'text-ink-2'}`}>
      {label}
    </button>
  )

  return (
    <Sheet title={task ? 'עריכה' : 'הוספה'} onClose={onClose}>
      <form onSubmit={save} className="space-y-3 pb-4">
        <div className="flex gap-1 rounded-xl bg-soft p-1">
          {typeButton(false, 'מטלה')}
          {typeButton(true, 'חשבון')}
        </div>
        <Field label={isBill ? 'איזה חשבון' : 'מה צריך לעשות'}>
          <input value={title} onChange={(e) => { setTitle(e.target.value); setError('') }}
            placeholder={isBill ? 'ועד בית' : 'לתקן את הברז'} autoFocus={!task} enterKeyHint="done" />
        </Field>

        {!more ? (
          <button type="button" onClick={() => setMore(true)} className="flex min-h-11 items-center gap-1 text-sm text-ink-2">
            עוד פרטים (תאריך, אחראי, חזרה…) <IconChevronDown size={16} />
          </button>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={repeat === 'consumption' ? 'ההזמנה הבאה בערך' : repeat === 'once' ? 'עד מתי (לא חובה)' : 'המועד הבא'}>
                <input type="date" value={due} onChange={(e) => { setDue(e.target.value); setError('') }} />
              </Field>
              <Field label="אחראי/ת">
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === myId ? `${m.display_name} (אני)` : m.display_name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="חזרה">
                <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
                  {REPEATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              {isBill ? (
                <Field label="סכום">
                  <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }} placeholder="₪" />
                </Field>
              ) : (
                <Field label="תזכורת">
                  <select value={remind} onChange={(e) => setRemind(e.target.value)}>
                    {[['0', 'ביום עצמו'], ['1', 'יום לפני'], ['3', '3 ימים לפני'], ['7', 'שבוע לפני'], ['14', 'שבועיים לפני'], ['30', 'חודש לפני']]
                      .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              )}
            </div>
            {repeat === 'consumption' && (
              <Field label="בערך כל כמה ימים מזמינים?" hint="אחרי כמה הזמנות האפליקציה תחשב את זה לבד לפי ההיסטוריה.">
                <input inputMode="numeric" value={gasDays} onChange={(e) => { setGasDays(e.target.value); setError('') }} />
              </Field>
            )}
            {isBill && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="תזכורת">
                  <select value={remind} onChange={(e) => setRemind(e.target.value)}>
                    {[['0', 'ביום עצמו'], ['1', 'יום לפני'], ['3', '3 ימים לפני'], ['7', 'שבוע לפני'], ['14', 'שבועיים לפני']]
                      .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <label className="flex min-h-11 items-end gap-2 pb-3 text-sm">
                  <input type="checkbox" className="h-5 w-5 accent-brand" style={{ width: 20 }} checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
                  הוראת קבע
                </label>
              </div>
            )}
            <Field label="הערות">
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="מספר לקוח, טלפון של הספק…" />
            </Field>
          </>
        )}

        {error && <p className="text-sm text-late">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="submit" variant="primary" disabled={busy} className="min-h-12 flex-1">{task ? 'שמירה' : 'הוספה'}</Button>
          {task && <Button variant="danger" onClick={remove} className="min-h-12">מחיקה</Button>}
        </div>
      </form>
    </Sheet>
  )
}
