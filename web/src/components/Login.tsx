import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field } from './ui'

const ERRORS: [RegExp, string][] = [
  [/not invited|Database error saving new user/i, 'המייל הזה לא מוזמן לבית. בדקו שהוא כתוב נכון.'],
  [/rate limit|security purposes|only request this after/i, 'נשלחו יותר מדי קודים. חכו דקה ונסו שוב.'],
  [/expired|invalid|Token has expired/i, 'הקוד שגוי או שפג תוקפו. בקשו קוד חדש.'],
  [/Invalid login credentials/i, 'פרטי התחברות שגויים.'],
]

function hebrewError(message: string): string {
  return ERRORS.find(([re]) => re.test(message))?.[1] ?? 'משהו השתבש. נסו שוב.'
}

export function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    const clean = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(clean)) return setError('כתבו כתובת מייל תקינה')
    setBusy(true); setError('')
    // Dev-only shortcut for local test accounts (never shipped to production builds).
    if (import.meta.env.DEV && password) {
      const { error } = await supabase.auth.signInWithPassword({ email: clean, password })
      setBusy(false)
      if (error) setError(hebrewError(error.message))
      return
    }
    const { error } = await supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } })
    setBusy(false)
    if (error) return setError(hebrewError(error.message))
    setStep('code')
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    const token = code.replace(/\D/g, '')
    if (token.length < 6) return setError('הקוד צריך להיות 6 ספרות לפחות')
    setBusy(true); setError('')
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' })
    setBusy(false)
    if (error) setError(hebrewError(error.message))
  }

  return (
    <div className="pt-safe mx-auto flex min-h-full max-w-md flex-col justify-center px-6 pb-16">
      <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" className="mb-6 h-16 w-16 rounded-2xl" />
      <h1 className="text-2xl font-medium">הבית שלנו</h1>
      <p className="mt-1 mb-8 text-sm text-ink-2">מטלות, חשבונות ורשימת קניות במקום אחד.</p>

      {step === 'email' ? (
        <form onSubmit={sendCode} className="space-y-4">
          <Field label="המייל שלך">
            <input
              type="email" inputMode="email" autoComplete="email" dir="ltr" placeholder="name@gmail.com"
              value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} autoFocus
            />
          </Field>
          {import.meta.env.DEV && (
            <Field label="סיסמת בדיקה (פיתוח בלבד)">
              <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          {error && <p className="text-sm text-late">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? 'שולח…' : 'שלחו לי קוד'}
          </Button>
          <p className="text-xs text-ink-3">נתחבר פעם אחת, והאפליקציה תזכור אותך בטלפון הזה.</p>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm">שלחנו קוד ל-<span dir="ltr">{email}</span></p>
          <Field label="הקוד מהמייל">
            <input
              inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={10} placeholder="123456"
              className="text-center tracking-[0.4em]"
              value={code} onChange={(e) => { setCode(e.target.value); setError('') }} autoFocus
            />
          </Field>
          {error && <p className="text-sm text-late">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? 'בודק…' : 'כניסה'}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => { setStep('email'); setCode(''); setError('') }}>
            שינוי מייל או שליחה מחדש
          </Button>
        </form>
      )}
    </div>
  )
}
