import { IconCheck, IconPlus } from '@tabler/icons-react'
import { useRef, useState, type FormEvent } from 'react'
import { supabase, type Member, type ShoppingItem } from '../lib/supabase'
import { toast } from './ui'

/** "חלב, ביצים ולחם" -> ["חלב", "ביצים", "לחם"] */
export function splitItems(text: string): string[] {
  return text
    .split(/[,،\n]|\s+ו(?=[^\s])(?=\S{2,})/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80)
}

export function Shopping({
  items, setItems, members, householdId,
}: {
  items: ShoppingItem[]; setItems: (fn: (prev: ShoppingItem[]) => ShoppingItem[]) => void
  members: Member[]; householdId: string
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // Items just checked stay in place briefly, so the next tap doesn't land on a row that slid up.
  const [settling, setSettling] = useState<number[]>([])
  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? ''

  const open = items.filter((i) => !i.checked || settling.includes(i.id)).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const done = items.filter((i) => i.checked && !settling.includes(i.id))
  const checkedCount = items.filter((i) => i.checked).length

  async function add(e: FormEvent) {
    e.preventDefault()
    const names = splitItems(text)
    if (names.length === 0) return setError('כתבו מה צריך לקנות')
    setText(''); setError('')
    input.current?.focus()
    const { data, error } = await supabase
      .from('shopping_items')
      .insert(names.map((name) => ({ household_id: householdId, name })))
      .select()
    if (error) { setText(names.join(', ')); return toast('ההוספה נכשלה. נסו שוב.') }
    setItems((prev) => [...prev.filter((p) => !data.some((d) => d.id === p.id)), ...(data as ShoppingItem[])])
  }

  async function toggle(item: ShoppingItem) {
    const checked = !item.checked
    setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, checked } : p)))
    if (checked) {
      setSettling((prev) => [...prev, item.id])
      window.setTimeout(() => setSettling((prev) => prev.filter((id) => id !== item.id)), 1500)
    }
    const { error } = await supabase
      .from('shopping_items')
      .update({ checked, checked_at: checked ? new Date().toISOString() : null })
      .eq('id', item.id)
    if (error) {
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, checked: !checked } : p)))
      toast('העדכון נכשל')
    }
  }

  async function clearDone() {
    const ids = items.filter((i) => i.checked).map((d) => d.id)
    setItems((prev) => prev.filter((p) => !ids.includes(p.id)))
    const { error } = await supabase.from('shopping_items').delete().in('id', ids)
    if (error) return toast('הניקוי נכשל')
    toast(`נוקו ${ids.length} פריטים`)
  }

  const row = (i: ShoppingItem) => (
    <li key={i.id} className="border-t border-line first:border-t-0">
      <button onClick={() => toggle(i)} className="flex w-full items-center gap-3 px-3 py-3 text-start">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          i.checked ? 'border-brand bg-brand text-white dark:text-page' : 'border-ink-3'}`}>
          {i.checked && <IconCheck size={15} stroke={2.5} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] ${i.checked ? 'text-ink-3 line-through' : 'font-medium'}`}>{i.name}</span>
          {nameOf(i.added_by) && <span className="block text-xs text-ink-3">{nameOf(i.added_by)}</span>}
        </span>
      </button>
    </li>
  )

  return (
    <div className="px-4">
      <h1 className="text-xl font-medium">רשימת קניות</h1>
      <p className="text-sm text-ink-2">{items.length - checkedCount} פריטים · מתעדכן אצל שניכם</p>

      <form onSubmit={add} className="mt-4 flex gap-2">
        <input
          ref={input}
          value={text}
          onChange={(e) => { setText(e.target.value); setError('') }}
          placeholder="חלב, ביצים, לחם"
          enterKeyHint="done"
          aria-label="מה צריך לקנות"
        />
        <button type="submit" aria-label="הוספה" className="flex w-12 shrink-0 items-center justify-center rounded-xl bg-brand text-white dark:text-page">
          <IconPlus size={22} stroke={2} />
        </button>
      </form>
      {error && <p className="mt-1 text-sm text-late">{error}</p>}

      {items.length === 0 ? (
        <p className="mt-12 text-center text-sm text-ink-2">הרשימה ריקה. מה צריך לקנות?</p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-xl border border-line bg-card">
          {open.map(row)}
          {done.map(row)}
        </ul>
      )}
      {checkedCount > 0 && (
        <button onClick={clearDone} className="mt-3 w-full rounded-xl border border-line bg-card py-2.5 text-sm active:scale-[0.98]">
          ניקוי {checkedCount} מסומנים
        </button>
      )}
    </div>
  )
}
