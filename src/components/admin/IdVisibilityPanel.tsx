import { useState } from 'react'
import { ID_LEVELS, saveIdVisibility, useIdSettings, type IdLevel } from '@/lib/idVisibility'

/**
 * חשיפת תעודות זהות לפי רמת הרשאה (מיגרציה 040) — מנהל־על בוחר לכל רמה.
 * כבוי = הרמה רואה •••••1234 בכרטיס, ואינה רואה ת"ז (של התלמיד ושל ההורים)
 * בטבלאות, בסינון ובייצוא. מנהל־על רואה תמיד. lib/idVisibility.ts.
 */
export default function IdVisibilityPanel() {
  const settings = useIdSettings()
  const [busy, setBusy] = useState<IdLevel | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const toggle = async (level: IdLevel) => {
    setBusy(level)
    setErr(null)
    try {
      await saveIdVisibility(level, !(settings.get(level) ?? true))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const group = (product: 'matzevet' | 'bagrut', title: string) => (
    <div>
      <div className="mb-2 text-xs font-bold text-slate-500">{title}</div>
      <ul className="flex flex-col gap-1.5">
        {ID_LEVELS.filter((l) => l.product === product).map(({ level, label }) => {
          const on = settings.get(level) ?? true
          return (
            <li key={level} className="flex items-center gap-3 text-sm">
              <button
                role="switch"
                aria-checked={on}
                disabled={busy !== null}
                onClick={() => toggle(level)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}
                title={on ? 'רואה ת"ז — לחיצה מסתירה' : 'ת"ז מוסתרת — לחיצה חושפת'}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'right-0.5' : 'right-[1.125rem]'}`} />
              </button>
              {/* המצב צמוד לשם — לא בקצה השורה: במסך רחב הוא נדד לעמודה השנייה ונראה שייך לה */}
              <span className="text-slate-700">{label}</span>
              <span className={`text-xs ${on ? 'text-emerald-700' : 'font-semibold text-slate-500'}`}>· {on ? 'רואה ת"ז' : 'ת"ז מוסתרת'}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-sky-800">חשיפת תעודות זהות</h2>
      <p className="mt-1 text-sm text-slate-500">
        לכל רמת הרשאה: האם היא רואה ת"ז של התלמיד ושל ההורים. רמה מוסתרת רואה <bdi dir="ltr">•••••1234</bdi> בכרטיס, ואינה רואה ת"ז בטבלאות,
        בסינון ובייצוא. מנהל־על רואה תמיד. משתמש עם כמה תפקידים בבגרות — אם אחד מהם מוסתר, ת"ז מוסתרת.
      </p>
      <p className="mt-1 text-xs text-amber-700">
        הסתרה במסך ובייצוא בלבד — הנתון עדיין יוצא מהמסד למי שרואה את השורה. האכיפה במסד היא שלב נפרד.
      </p>
      {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</p>}
      <div className="mt-4 grid max-w-3xl gap-6 sm:grid-cols-2">
        {group('matzevet', 'מצבת תלמידים')}
        {group('bagrut', 'זכאות לבגרות')}
      </div>
    </section>
  )
}
