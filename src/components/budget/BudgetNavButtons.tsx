import { useLocation, useNavigate } from 'react-router-dom'
import { useLastBudgetCard } from '@/lib/lastBudgetCard'

/**
 * "חזרה" — לדף הקודם בדפדפן, בכל מסכי התקציב. כשהגיעו ישר (קישור, רענון) ואין
 * דף קודם באתר — לתמונת התקציב. בתמונת התקציב עצמה, בלי דף קודם — לא מוצג.
 */
export function BackButton({ home }: { home: string }) {
  const navigate = useNavigate()
  const { key, pathname, search } = useLocation()
  // react-router: 'default' = הדף הראשון בהיסטוריה של האתר
  const first = key === 'default'
  if (first && pathname === home) return null
  return (
    <button
      onClick={() => (first ? navigate(`${home}${search}`) : navigate(-1))}
      title={first ? 'לתמונת התקציב' : 'חזרה לדף הקודם'}
      className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-600 transition hover:border-emerald-300 hover:text-emerald-800"
    >
      <span aria-hidden>→</span> חזרה
    </button>
  )
}

/**
 * "הסעיף האחרון: <מספר> · <שם>" — בכותרת של מסכי התקציב, כמו "התלמיד האחרון"
 * בבגרות. לחיצה פותחת את הכרטיס באותה שנה ותקופה ועם אותה רשימת דפדוף. לא מוצג
 * כשאין סעיף אחרון, כשהוא של רשות אחרת, או כשכבר עומדים עליו.
 */
export function LastCardLink({ code }: { code: string }) {
  const last = useLastBudgetCard()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  if (!last || last.code !== code || pathname === last.href.split('?')[0]) return null
  return (
    <button
      onClick={() => navigate(last.href, { state: last.nav })}
      title="חזרה לכרטיס הסעיף האחרון שפתחת"
      className="flex min-w-0 shrink items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100"
    >
      <span className="text-xs text-emerald-700">הסעיף האחרון:</span>
      <span className="font-mono text-xs text-emerald-700" dir="ltr">{last.card}</span>
      <span className="max-w-[14rem] truncate font-semibold">{last.name}</span>
    </button>
  )
}
