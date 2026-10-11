import { IconHome, IconShoppingCart } from '@tabler/icons-react'
import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { Home } from './components/Home'
import { Login } from './components/Login'
import { Settings } from './components/Settings'
import { Shopping } from './components/Shopping'
import { ToastHost } from './components/ui'
import { bucketOf } from './lib/dates'
import { supabase, type Bill, type Member, type ShoppingItem, type Task } from './lib/supabase'

type Tab = 'home' | 'shop'

function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

export default function App() {
  const session = useSession()
  if (session === undefined) return null
  if (!session) return (<><Login /><ToastHost /></>)
  return <House myId={session.user.id} />
}

function House({ myId }: { myId: string }) {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('tab') as Tab) || 'home')
  const [settings, setSettings] = useState(false)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [offline, setOffline] = useState(false)

  const householdId = members?.find((m) => m.user_id === myId)?.household_id

  const loadTasks = useCallback(async () => {
    const [t, b] = await Promise.all([
      supabase.from('tasks').select('*').is('done_at', null),
      supabase.from('bills').select('id,task_id,kind,provider_name,amount,due_date,period,subject,summary,received_at,status,link')
        .order('received_at', { ascending: false }).limit(100),
    ])
    setOffline(Boolean(t.error))
    if (!t.error) setTasks(t.data as Task[])
    if (!b.error) setBills(b.data as Bill[])
  }, [])

  const loadItems = useCallback(async () => {
    const { data, error } = await supabase.from('shopping_items').select('*')
    if (!error) setItems(data as ShoppingItem[])
  }, [])

  const [loadError, setLoadError] = useState(false)
  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase.from('members').select('*')
    setLoadError(Boolean(error))
    if (!error) setMembers(data as Member[])
  }, [])

  useEffect(() => {
    loadMembers()
    loadTasks()
    loadItems()
  }, [loadMembers, loadTasks, loadItems])

  // Live sync between the two phones, plus a refresh whenever the app comes back to the foreground.
  useEffect(() => {
    const channel = supabase.channel('household-live')
      .on('postgres_changes', { event: '*', schema: 'household', table: 'shopping_items' }, loadItems)
      .on('postgres_changes', { event: '*', schema: 'household', table: 'tasks' }, loadTasks)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') { loadTasks(); loadItems() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible) }
  }, [loadTasks, loadItems])

  useEffect(() => { try { localStorage.setItem('tab', tab) } catch { /* private mode */ } }, [tab])

  if (members === null) {
    if (!loadError) return null
    return (
      <div className="pt-safe mx-auto max-w-md px-6 text-center">
        <p className="mt-24 font-medium">אין חיבור לשרת</p>
        <p className="mt-1 text-sm text-ink-2">בדקו את החיבור לאינטרנט ונסו שוב.</p>
        <button className="mt-4 rounded-xl border border-line bg-card px-4 py-2 text-sm" onClick={loadMembers}>ניסיון חוזר</button>
      </div>
    )
  }
  if (!householdId) {
    return (
      <div className="pt-safe mx-auto max-w-md px-6 text-center">
        <p className="mt-24 font-medium">החשבון הזה לא משויך לבית</p>
        <button className="mt-4 text-sm text-ink-2 underline" onClick={() => supabase.auth.signOut()}>התנתקות</button>
      </div>
    )
  }

  const urgent = tasks.filter((t) => !t.autopay && ['late', 'week'].includes(bucketOf(t.next_due))).length
  const openItems = items.filter((i) => !i.checked).length

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col">
      <main className="pt-safe flex-1 pb-28">
        {offline && <p className="mx-4 mb-3 rounded-lg bg-week-soft px-3 py-2 text-sm text-week">אין חיבור כרגע. מוצגים הנתונים האחרונים.</p>}
        {tab === 'home'
          ? <Home tasks={tasks} bills={bills} members={members} myId={myId} householdId={householdId} reload={loadTasks} onSettings={() => setSettings(true)}
              onTaskChanged={(u) => setTasks((prev) => (u.done_at ? prev.filter((t) => t.id !== u.id) : prev.map((t) => (t.id === u.id ? u : t))))} />
          : <Shopping items={items} setItems={setItems} members={members} householdId={householdId} />}
      </main>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-md">
          {([['home', 'הבית', IconHome, urgent], ['shop', 'קניות', IconShoppingCart, openItems]] as const).map(([key, label, Icon, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-current={tab === key ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 pt-2 text-xs ${tab === key ? 'text-brand font-medium' : 'text-ink-2'}`}
            >
              <span className="relative">
                <Icon size={24} stroke={1.75} />
                {count > 0 && (
                  <span className="absolute -top-1 -left-2.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[11px] leading-[18px] text-white dark:text-page">
                    {count}
                  </span>
                )}
              </span>
              {label}
            </button>
          ))}
        </div>
      </nav>
      {settings && <Settings members={members} myId={myId} householdId={householdId} onClose={() => setSettings(false)} />}
      <ToastHost />
    </div>
  )
}
