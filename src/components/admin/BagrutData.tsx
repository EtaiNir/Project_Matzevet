import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchBagrutUploads, fetchRounds, schoolsOf, type BagrutRound } from '@/lib/bagrut'
import { BagrutUploadPanel } from '@/pages/bagrut/BagrutUpload'

/**
 * נתוני הבגרות של לקוח — ברמת בית הספר (החלטה 016).
 *
 * כרטיס לכל בית ספר; בוחרים אחד ורואים את הסבבים שלו, נכנסים אליו במערכת
 * ומעלים לו סבב חדש. בית ספר חדש נוצר מהקליטה הראשונה שלו — מקלידים סמל
 * מוסד, והסוכן בודק שהוא תואם לקבצים.
 *
 * בית הספר שנבחר נשמר בכתובת (`?school=`), כדי שאפשר יהיה לקשר אליו.
 */

interface SchoolRow {
  code: string
  name: string
  rounds: BagrutRound[]
  /** קליטה שעוד לא הסתיימה או שנכשלה — בית ספר שעדיין אין לו סבב */
  pendingOnly: boolean
}

export default function BagrutData({ code }: { code: string }) {
  const [params, setParams] = useSearchParams()
  const selected = params.get('school')
  const [schools, setSchools] = useState<SchoolRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newCode, setNewCode] = useState('')

  useEffect(() => {
    setSchools(null)
    Promise.all([fetchRounds(code), fetchBagrutUploads(code)])
      .then(([rounds, uploads]) => {
        const rows: SchoolRow[] = schoolsOf(rounds).map((s) => ({ ...s, pendingOnly: false }))
        // בית ספר שנשלחה לו קליטה ועוד אין לו סבב — שיופיע, כדי שיהיה אפשר לעקוב
        for (const u of uploads) {
          if (rows.some((r) => r.code === u.school_code)) continue
          rows.push({ code: u.school_code, name: u.report?.school_name ?? `מוסד ${u.school_code}`, rounds: [], pendingOnly: true })
        }
        setSchools(rows)
      })
      .catch((e: Error) => setError(e.message))
  }, [code])

  const choose = (school: string | null) => {
    setAdding(false)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('product', 'bagrut')
      if (school) next.set('school', school)
      else next.delete('school')
      return next
    }, { replace: true })
  }

  const current = useMemo(() => {
    if (!selected) return null
    return schools?.find((s) => s.code === selected) ?? { code: selected, name: `מוסד ${selected}`, rounds: [], pendingOnly: true }
  }, [schools, selected])

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">שגיאה: {error}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-sky-800">בתי הספר</h3>
        <p className="mb-4 text-sm text-slate-500">
          נתוני הבגרות נקלטים ונצפים לכל בית ספר בנפרד. בוחרים בית ספר כדי לראות את הסבבים שלו ולהעלות לו סבב חדש.
        </p>

        {schools == null ? (
          <p className="text-sm text-slate-400">טוען…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {schools.map((s) => {
              const last = s.rounds[0]
              const active = s.code === selected
              return (
                <button
                  key={s.code}
                  onClick={() => choose(active ? null : s.code)}
                  className={`flex flex-col rounded-xl border p-4 text-right transition ${
                    active ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-200' : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/40'
                  }`}
                >
                  <span className="font-bold text-slate-800">{s.name}</span>
                  <span className="font-mono text-xs text-slate-400" dir="ltr">{s.code}</span>
                  <span className="mt-2 text-xs text-slate-500">
                    {last
                      ? `${last.season} ${last.school_year} · ${last.stats?.students?.toLocaleString('he-IL') ?? '—'} תלמידים${s.rounds.length > 1 ? ` · ${s.rounds.length} סבבים` : ''}`
                      : 'עוד אין סבב שנקלט'}
                  </span>
                </button>
              )
            })}

            {adding ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (/^\d+$/.test(newCode)) {
                    choose(newCode)
                    setNewCode('')
                  }
                }}
                className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-sky-300 p-4"
              >
                <label className="text-sm font-semibold text-slate-600">
                  סמל מוסד
                  <input
                    autoFocus
                    dir="ltr"
                    inputMode="numeric"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="610006"
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300"
                  />
                </label>
                <div className="flex gap-2">
                  <button disabled={!newCode} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                    המשך לקליטה
                  </button>
                  <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
                    ביטול
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex min-h-[5.5rem] items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-sm font-medium text-sky-700 transition hover:border-sky-400 hover:bg-sky-50"
              >
                + בית ספר חדש
              </button>
            )}
          </div>
        )}
      </section>

      {current && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-violet-900">
                  {current.name} <span className="font-mono text-sm font-normal text-slate-400" dir="ltr">{current.code}</span>
                </h3>
                <p className="text-sm text-slate-500">
                  {current.rounds.length
                    ? 'תמונת המצב, רשימת התלמידים, המעקב ותוכנית ההתערבות של בית הספר.'
                    : 'לבית הספר הזה עוד לא נקלט סבב. העלו את הקבצים למטה — בית הספר ייווצר מהקליטה.'}
                </p>
              </div>
              {current.rounds.length > 0 && (
                <Link
                  to={`/bagrut/${code}/${current.code}`}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700"
                >
                  פתיחת בית הספר ←
                </Link>
              )}
            </div>

            {current.rounds.length > 0 && (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-right text-sky-700">
                    <th className="pb-2 font-semibold">סבב</th>
                    <th className="pb-2 font-semibold">נקלט</th>
                    <th className="pb-2 font-semibold">תלמידים</th>
                    <th className="pb-2 font-semibold">ניתוחי זכאות (T2)</th>
                    <th className="pb-2 font-semibold">ציונים</th>
                  </tr>
                </thead>
                <tbody>
                  {current.rounds.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 font-medium">{r.season} {r.school_year}</td>
                      <td className="py-2 text-slate-600">{new Date(r.created_at).toLocaleString('he-IL')}</td>
                      <td className="py-2 tabular-nums">{r.stats?.students?.toLocaleString('he-IL') ?? '—'}</td>
                      <td className="py-2 tabular-nums">{r.stats?.eligibility?.toLocaleString('he-IL') ?? '—'}</td>
                      <td className="py-2 tabular-nums">{r.stats?.grades?.toLocaleString('he-IL') ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* key — מתחילים קליטה נקייה כשעוברים בית ספר */}
          <BagrutUploadPanel key={current.code} code={code} school={current.code} embedded />
        </>
      )}
    </div>
  )
}
