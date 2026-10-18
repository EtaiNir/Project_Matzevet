import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { daysUntil } from '@/lib/bagrutCycle'
import type { BagrutContextValue } from '@/pages/bagrut/context'

/**
 * התראה כשמגיע מועד המעקב הבא (משימה 5, פגישת 14.10) — פס דק בראש כל מסכי
 * הבגרות: כמה תלמידים שמועד המעקב שלהם היום, וכמה שעבר. לחיצה פותחת את
 * "מעקב השבוע", ממוין לפי מועד.
 *
 * רק "היום" ו"באיחור" — מה שמגיע בהמשך השבוע כבר בסרגל ("מעקב השבוע"), והתראה
 * על כל השבוע הייתה הופכת לרעש קבוע. מוצג למי שרשאי לעדכן מעקב: למי שאינו
 * יכול לפעול, התראה היא רק רעש. "הסתרה" — עד הטעינה הבאה, בזיכרון הדף בלבד.
 */
let hiddenFor = '' // סבב + ספירות שהוסתרו; ספירה שהשתנתה מציגה שוב

export default function FollowupAlert({ ctx }: { ctx: BagrutContextValue }) {
  const { data, base, round, canEditTracking } = ctx
  const { pathname, search } = useLocation()
  const [, rerender] = useState(0)

  let overdue = 0
  let today = 0
  for (const s of data.students) {
    const d = data.tracking.get(s.student_id)?.next_followup
    if (!d) continue
    const n = daysUntil(d)
    if (n < 0) overdue++
    else if (n === 0) today++
  }
  const key = `${round.id}:${overdue}:${today}`
  const onList = pathname === `${base}/students` && new URLSearchParams(search).get('view') === 'followup'
  if (!canEditTracking || overdue + today === 0 || onList || hiddenFor === key) return null

  const n = (k: number) => (k === 1 ? 'תלמיד אחד' : `${k} תלמידים`)
  const parts = [
    today ? `${n(today)} — המעקב היום` : '',
    overdue ? `${n(overdue)} — מועד המעקב עבר` : '',
  ].filter(Boolean)

  return (
    <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-sm ${overdue ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${overdue ? 'bg-rose-500' : 'bg-amber-400'}`} />
      <span className="font-semibold">מעקב:</span>
      <span>{parts.join(' · ')}</span>
      <Link to={`${base}/students?view=followup`} className="font-bold underline-offset-2 hover:underline">
        לרשימה
      </Link>
      <button
        onClick={() => {
          hiddenFor = key
          rerender((x) => x + 1)
        }}
        className="mr-auto text-xs opacity-60 hover:opacity-100"
        title="הסתרה עד הטעינה הבאה של הדף"
      >
        הסתרה
      </button>
    </div>
  )
}
