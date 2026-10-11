import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY,
  { db: { schema: 'household' }, auth: { persistSession: true, autoRefreshToken: true } },
)

export type TaskKind = 'once' | 'recurring' | 'consumption'

export type Task = {
  id: number
  household_id: string
  title: string
  icon: string
  kind: TaskKind
  interval_months: number | null
  interval_days: number | null
  anchor_day: number | null
  next_due: string | null
  assignee_id: string | null
  amount: number | null
  amount_estimated: boolean
  autopay: boolean
  remind_days_before: number
  notes: string | null
  done_at: string | null
}

export type Member = { household_id: string; user_id: string; display_name: string; email: string }

export type ShoppingItem = {
  id: number
  household_id: string
  name: string
  qty: string | null
  checked: boolean
  added_by: string | null
  created_at: string
}

export type Bill = {
  id: number
  task_id: number | null
  kind: 'bill' | 'receipt' | 'other'
  provider_name: string | null
  amount: number | null
  due_date: string | null
  period: string | null
  subject: string | null
  summary: string | null
  received_at: string | null
  status: 'new' | 'paid' | 'ignored'
}
