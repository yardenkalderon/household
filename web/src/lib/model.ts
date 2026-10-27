import { daysUntil, shortDate, todayIL } from './dates'
import { supabase, type Bill, type Member, type Task, type TaskEvent } from './supabase'
import { toast } from '../components/ui'

/** The latest unpaid email bill of a task, if any. */
export function openBill(t: Task, bills: Bill[]): Bill | undefined {
  return bills.find((b) => b.task_id === t.id && b.status === 'new')
}

export function latestBill(t: Task, bills: Bill[]): Bill | undefined {
  return bills.find((b) => b.task_id === t.id)
}

export const isPayLink = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url)

/** Needs one of you now: overdue or due within a week, or a bill that arrived without a date or amount. */
export function needsAttention(t: Task, bills: Bill[]): boolean {
  if (t.done_at || t.autopay) return false
  if (t.next_due && daysUntil(t.next_due) <= 7) return true
  return t.is_bill && !!openBill(t, bills) && (!t.next_due || t.amount == null)
}

export function lastEvent(t: Task, events: TaskEvent[]): TaskEvent | undefined {
  return events.find((e) => e.task_id === t.id)
}

export function doneLabel(t: Task): string {
  if (t.kind === 'consumption') return 'הזמנתי'
  return t.is_bill ? 'שילמתי' : 'בוצע'
}

export function whoLabel(id: string | null, members: Member[], myId: string): string {
  if (!id) return ''
  if (id === myId) return 'אני'
  return members.find((m) => m.user_id === id)?.display_name ?? ''
}

/** Totals for the summary line, all for the next 30 days. */
export function summary(tasks: Task[], bills: Bill[], events: TaskEvent[]) {
  const in30 = (d: string | null) => d != null && daysUntil(d) <= 30
  const open = tasks.filter((t) => !t.done_at)
  const manual = open.filter((t) => t.is_bill && !t.autopay)
  const toPay = manual.filter((t) => in30(t.next_due) && t.amount != null).reduce((s, t) => s + (t.amount ?? 0), 0)
  const unknown = manual.filter((t) => openBill(t, bills) && t.amount == null).length
  const auto = open.filter((t) => t.autopay && in30(t.next_due)).reduce((s, t) => s + (t.amount ?? 0), 0)
  const month = todayIL().slice(0, 7)
  const billIds = new Set(tasks.filter((t) => t.is_bill).map((t) => t.id))
  const paidThisMonth = events
    .filter((e) => e.done_on.startsWith(month) && billIds.has(e.task_id) && e.amount != null)
    .reduce((s, e) => s + (e.amount ?? 0), 0)
  const urgent = open.filter((t) => needsAttention(t, bills)).length
  return { toPay, unknown, auto, paidThisMonth, urgent }
}

/** Marks a task done/paid, with a 6-second undo. */
export async function completeTask(
  t: Task,
  onChanged: (t: Task) => void,
  reload: () => void,
  onBillsPaid?: (taskId: number) => void,
): Promise<boolean> {
  onBillsPaid?.(t.id)  // show it as paid right away; the server answer follows (the DB is far away)
  const { data, error } = await supabase.rpc('complete_task', { p_task_id: t.id, p_expected_due: t.next_due })
  if (error) {
    toast(/already updated/.test(error.message) ? 'כבר עודכן ממכשיר אחר' : 'לא הצלחנו לעדכן. נסו שוב.')
    reload()
    return false
  }
  const updated = data as Task
  onChanged(updated)
  const undo = {
    label: 'ביטול',
    run: async () => {
      const { data: restored, error } = await supabase.rpc('undo_complete', { p_task_id: t.id })
      if (error) return toast('הביטול נכשל')
      onChanged(restored as Task)
      toast('בוטל')
      reload()
    },
  }
  const verb = t.kind === 'consumption' ? 'נרשם' : t.is_bill ? 'שולם' : 'בוצע'
  const next = updated.done_at || !updated.next_due ? '' : `. הבא: ${shortDate(updated.next_due)}`
  toast(verb + next, undo)
  reload()
  return true
}
