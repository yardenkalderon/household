import { useState } from 'react'
import { money, shortDate } from '../lib/dates'
import { TaskIcon } from '../lib/icons'
import { completeTask, doneLabel, isPayLink, latestBill, openBill, whoLabel } from '../lib/model'
import { supabase, type Bill, type Member, type Task, type TaskEvent } from '../lib/supabase'
import { Button, Sheet, toast } from './ui'

const REPEAT_LABEL: Record<number, string> = { 1: 'כל חודש', 2: 'כל חודשיים', 3: 'כל 3 חודשים', 6: 'כל חצי שנה', 12: 'כל שנה' }

function repeatText(t: Task): string {
  if (t.kind === 'once') return 'פעם אחת'
  if (t.kind === 'consumption') return `לפי צריכה (~${t.interval_days ?? 45} ימים)`
  return t.interval_months ? REPEAT_LABEL[t.interval_months] ?? `כל ${t.interval_months} חודשים` : `כל ${t.interval_days} ימים`
}

/** Read-only view of a task: what it is, the bill from the mail, who did what, and the main action. */
export function TaskDetails({
  task: t, bills, events, members, myId, onClose, onEdit, onTaskChanged, reload, onBillsPaid,
}: {
  task: Task; bills: Bill[]; events: TaskEvent[]; members: Member[]; myId: string
  onClose: () => void; onEdit: () => void; onTaskChanged: (t: Task) => void; reload: () => void
  onBillsPaid: (taskId: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const bill = openBill(t, bills) ?? latestBill(t, bills)
  const history = events.slice(0, 6)

  async function done() {
    setBusy(true)
    onClose()  // close at once; the list already shows it as paid and the toast offers undo
    await completeTask(t, onTaskChanged, reload, onBillsPaid)
    setBusy(false)
  }

  async function undoLast() {
    const { data, error } = await supabase.rpc('undo_complete', { p_task_id: t.id })
    if (error) return toast('אי אפשר לבטל את הרישום הזה')
    onTaskChanged(data as Task)
    toast('בוטל')
    reload()
  }

  const facts: [string, string][] = [
    ['סכום', t.amount != null ? (t.amount_estimated ? '~' : '') + money(t.amount) : 'לא ידוע'],
    [t.autopay ? 'חיוב הבא' : 'מועד', t.next_due ? shortDate(t.next_due) : 'לא ידוע'],
    ['חזרה', repeatText(t)],
    ['אחראי/ת', whoLabel(t.assignee_id, members, myId) || 'שנינו'],
  ]
  if (!t.is_bill) facts.shift()

  return (
    <Sheet title={t.title} onClose={onClose}>
      <div className="mb-3 flex items-center gap-2 text-sm text-ink-2">
        <TaskIcon name={t.icon} />
        <span>{t.is_bill ? 'חשבון' : 'מטלה'}{t.autopay ? ' · הוראת קבע' : ''}</span>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        {facts.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-card px-3 py-2">
            <dt className="text-xs text-ink-2">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {bill && (
        <div className="mt-3 rounded-xl bg-mail-soft p-3 text-sm text-mail">
          <div className="font-medium">
            {bill.kind === 'receipt' ? 'קבלה מהמייל' : 'חשבון אחרון מהמייל'}{bill.provider_name ? `: ${bill.provider_name}` : ''}
          </div>
          <div>
            {bill.amount != null ? money(bill.amount) : 'הסכום לא מופיע במייל'}
            {bill.due_date && ` · עד ${shortDate(bill.due_date)}`}
            {bill.period && ` · ${bill.period}`}
          </div>
          {isPayLink(bill.link) ? (
            <a href={bill.link} target="_blank" rel="noopener noreferrer"
              className="mt-2 flex min-h-11 items-center justify-center rounded-xl bg-card px-3 font-medium text-mail">
              פתיחת החשבון באתר הספק ↗
            </a>
          ) : bill.amount == null && (
            <p className="mt-1 opacity-80">אין קישור במייל. התשלום באתר הספק עצמו.</p>
          )}
        </div>
      )}

      {t.notes && <p className="mt-3 whitespace-pre-line rounded-xl border border-line bg-card px-3 py-2 text-sm">{t.notes}</p>}

      <div className="mt-4 flex gap-2">
        {t.autopay ? (
          <p className="flex-1 rounded-xl bg-soft px-3 py-3 text-center text-sm text-ink-2">נגבה אוטומטית, אין מה לעשות</p>
        ) : (
          <Button variant="primary" onClick={done} disabled={busy} className="min-h-12 flex-1">
            {busy ? '…' : doneLabel(t)}
          </Button>
        )}
        <Button onClick={onEdit} className="min-h-12">עריכה</Button>
      </div>

      <h3 className="mt-5 mb-1 text-sm font-medium text-ink-2">היסטוריה</h3>
      {history.length === 0 ? (
        <p className="pb-4 text-sm text-ink-3">עוד לא סומן כ{t.is_bill ? 'שולם' : 'בוצע'}.</p>
      ) : (
        <ul className="mb-4 overflow-hidden rounded-xl border border-line bg-card text-sm">
          {history.map((e, i) => (
            <li key={e.id} className="flex min-h-11 items-center justify-between border-t border-line px-3 first:border-t-0">
              <span>
                {shortDate(e.done_on)} · {e.source === 'app' ? (whoLabel(e.done_by, members, myId) || 'אחד מכם')
                  : e.source === 'email' ? 'לפי קבלה במייל' : 'נגבה אוטומטית'}
                {e.amount != null && t.is_bill ? ` · ${money(e.amount)}` : ''}
              </span>
              {i === 0 && e.prev_amount_estimated != null && (
                <button onClick={undoLast} className="min-h-9 rounded-lg px-2 text-late">ביטול</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
