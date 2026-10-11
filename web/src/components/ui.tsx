import { useEffect, useState, type ReactNode } from 'react'

let showToast: (msg: string) => void = () => {}
export const toast = (msg: string) => showToast(msg)

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let timer: number | undefined
    showToast = (m) => {
      setMsg(m)
      clearTimeout(timer)
      timer = window.setTimeout(() => setMsg(null), 2600)
    }
  }, [])
  if (!msg) return null
  return (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 pointer-events-none">
      <div className="rise rounded-xl bg-ink px-4 py-2 text-sm text-page shadow-lg">{msg}</div>
    </div>
  )
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="rise pb-safe max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-page px-4 pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">{title}</h2>
          <button onClick={onClose} className="rounded-full px-3 py-1 text-sm text-ink-2" aria-label="סגירה">סגירה</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Button({
  children, onClick, variant = 'outline', type = 'button', disabled, className = '',
}: {
  children: ReactNode; onClick?: () => void; variant?: 'outline' | 'primary' | 'danger' | 'ghost'
  type?: 'button' | 'submit'; disabled?: boolean; className?: string
}) {
  const styles = {
    outline: 'border border-line bg-card',
    primary: 'bg-brand text-white dark:text-page font-medium',
    danger: 'border border-late/40 text-late bg-card',
    ghost: 'text-ink-2',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-2.5 text-sm transition active:scale-[0.98] disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  )
}
