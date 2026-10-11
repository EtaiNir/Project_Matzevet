import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  fetchBagrutUploads,
  fetchRounds,
  fetchSchoolNames,
  saveBagrutSchool,
  schoolsOf,
  type BagrutRound,
} from '@/lib/bagrut'
import { BagrutUploadPanel } from '@/pages/bagrut/BagrutUpload'

/**
 * נתוני הבגרות של לקוח — ברמת בית הספר (החלטה 016).
 *
 * כרטיס לכל בית ספר; בוחרים אחד ורואים את הסבבים שלו, נכנסים אליו במערכת
 * ומעלים לו סבב חדש. בית ספר חדש נרשם עם סמל ושם (מיגרציה 033) — והשם הזה
 * גובר על השם שבקבצים. הסוכן בודק שסמל המוסד תואם לקבצים.
 *
 * בית הספר שנבחר נשמר בכתובת (`?school=`), כדי שאפשר יהיה לקשר אליו.
 */

interface SchoolRow {
  code: string
  name: string
  rounds: BagrutRound[]
}

const input = 'block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300'

export default function BagrutData({ code }: { code: string }) {
  const [params, setParams] = useSearchParams()
  const selected = params.get('school')
  const [schools, setSchools] = useState<SchoolRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // בית ספר חדש
  const [adding, setAdding] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  // שינוי שם
  const [renaming, setRenaming] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [rounds, uploads, names] = await Promise.all([fetchRounds(code), fetchBagrutUploads(code), fetchSchoolNames(code)])
    const rows: SchoolRow[] = schoolsOf(rounds, names)
    const has = (c: string) => rows.some((r) => r.code === c)
    // בית ספר שנרשם ועוד לא נקלט לו סבב
    for (const [c, name] of names) if (!has(c)) rows.push({ code: c, name, rounds: [] })
    // קליטה ישנה בלי רישום — שתופיע, כדי שיהיה אפשר לעקוב
    for (const u of uploads) if (!has(u.school_code)) rows.push({ code: u.school_code, name: u.report?.school_name ?? `מוסד ${u.school_code}`, rounds: [] })
    rows.sort((a, b) => a.name.localeCompare(b.name, 'he'))
    setSchools(rows)
  }, [code])

  useEffect(() => {
    setSchools(null)
    load().catch((e: Error) => setError(e.message))
  }, [load])

  const choose = (school: string | null) => {
    setAdding(false)
    setRenaming(null)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('product', 'bagrut')
      if (school) next.set('school', school)
      else next.delete('school')
      return next
    }, { replace: true })
  }

  async function addSchool() {
    setError(null)
    if (schools?.some((s) => s.code === newCode)) {
      setError(`בית ספר ${newCode} כבר קיים — בחרו אותו מהרשימה`)
      return
    }
    setSaving(true)
    try {
      await saveBagrutSchool(code, newCode, newName)
      await load()
      choose(newCode)
      setNewCode('')
      setNewName('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function rename(school: string) {
    if (!renaming?.trim()) return
    setSaving(true)
    setError(null)
    try {
      await saveBagrutSchool(code, school, renaming)
      await load()
      setRenaming(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const current = useMemo(() => {
    if (!selected) return null
    return schools?.find((s) => s.code === selected) ?? { code: selected, name: `מוסד ${selected}`, rounds: [] }
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
                  if (newCode && newName.trim()) addSchool()
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
                    className={`${input} mt-1 font-mono`}
                  />
                </label>
                <label className="text-sm font-semibold text-slate-600">
                  שם בית הספר
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="אג'יאל"
                    className={`${input} mt-1`}
                  />
                </label>
                <div className="flex gap-2">
                  <button disabled={!newCode || !newName.trim() || saving} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                    {saving ? 'שומר…' : 'הוספה וקליטה'}
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
              <div className="min-w-0">
                {renaming != null ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      rename(current.code)
                    }}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} className={`${input} w-64`} />
                    <button disabled={!renaming.trim() || saving} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                      {saving ? 'שומר…' : 'שמירה'}
                    </button>
                    <button type="button" onClick={() => setRenaming(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
                      ביטול
                    </button>
                  </form>
                ) : (
                  <h3 className="flex flex-wrap items-center gap-2 font-bold text-violet-900">
                    {current.name}
                    <span className="font-mono text-sm font-normal text-slate-400" dir="ltr">{current.code}</span>
                    <button onClick={() => setRenaming(current.name)} className="rounded-md px-1.5 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-50">
                      שינוי שם
                    </button>
                  </h3>
                )}
                <p className="text-sm text-slate-500">
                  {current.rounds.length
                    ? 'תמונת המצב, רשימת התלמידים, המעקב ותוכנית ההתערבות של בית הספר.'
                    : 'לבית הספר הזה עוד לא נקלט סבב. העלו את הקבצים למטה.'}
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
