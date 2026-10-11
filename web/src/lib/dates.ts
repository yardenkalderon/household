const TZ = 'Asia/Jerusalem'

/** Today's date in Israel as YYYY-MM-DD, regardless of the phone's timezone. */
export function todayIL(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

function utc(d: string): number {
  const [y, m, day] = d.split('-').map(Number)
  return Date.UTC(y, m - 1, day)
}

export function daysUntil(d: string): number {
  return Math.round((utc(d) - utc(todayIL())) / 86_400_000)
}

/** 2026-10-20 -> 20.10 (adds the year when it is not the current one). */
export function shortDate(d: string): string {
  const [y, m, day] = d.split('-')
  const sameYear = y === todayIL().slice(0, 4)
  return `${day}.${m}${sameYear ? '' : '.' + y.slice(2)}`
}

export function addDays(d: string, n: number): string {
  return new Date(utc(d) + n * 86_400_000).toISOString().slice(0, 10)
}

export function longToday(): string {
  return new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' })
    .format(new Date())
}

export type Bucket = 'late' | 'week' | 'later' | 'none'

export function bucketOf(nextDue: string | null): Bucket {
  if (!nextDue) return 'none'
  const n = daysUntil(nextDue)
  return n < 0 ? 'late' : n <= 7 ? 'week' : 'later'
}

export function money(n: number): string {
  return `${Math.round(n).toLocaleString('he-IL')} ₪`
}
