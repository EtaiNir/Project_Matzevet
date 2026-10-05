import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import {
  BAGRUT_ROLE_LABELS,
  clearRoundCache,
  detectBagrutRole,
  fetchBagrutUploads,
  fetchRounds,
  missingBagrutRoles,
  uploadBagrutRound,
  type BagrutRole,
  type BagrutUpload,
} from '@/lib/bagrut'
import { Card, Empty } from '@/components/bagrut/ui'

const STATUS: Record<BagrutUpload['status'], { label: string; cls: string }> = {
  pending: { label: 'ממתין לסוכן', cls: 'bg-slate-100 text-slate-700' },
  processing: { label: 'בעיבוד…', cls: 'bg-sky-100 text-sky-800' },
  done: { label: 'נקלט', cls: 'bg-emerald-100 text-emerald-800' },
  failed: { label: 'נכשל', cls: 'bg-rose-100 text-rose-800' },
}

/**
 * קליטת סבב בגרות — בדפוס של עדכון המצב"ת: בוחרים סבב, מעלים את הקבצים,
 * והסוכן עושה את השאר. המבנה קבוע (T1, T2, מצפן) ולכן אין מיפוי ואין
 * אישור; הבדיקה רצה בסוכן, ומה שמצאה מוצג כאן בהיסטוריה.
 *
 * מנהל-על בלבד בשלב זה — נאכף במדיניות bagrut_uploads ובבאקט, לא רק כאן.
 */
export default function BagrutUpload() {
  const { code = '' } = useParams()
  const { profile } = useAuth()
  const isSuperAdmin = profile?.role === 'super_admin'

  const [school, setSchool] = useState('')
  const [season, setSeason] = useState<'קיץ' | 'חורף'>('קיץ')
  const [year, setYear] = useState('')
  const [picked, setPicked] = useState<{ file: File; role: BagrutRole | null }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<BagrutUpload[]>([])

  // ברירות מחדל מהסבב האחרון של הרשות
  useEffect(() => {
    fetchRounds(code)
      .then((rs) => {
        const last = rs[0]
        setSchool((s) => s || last?.school_code || code)
        setYear((y) => y || last?.school_year || '')
      })
      .catch(() => setSchool((s) => s || code))
  }, [code])

  const reload = useCallback(() => {
    fetchBagrutUploads(code).then(setUploads).catch((e: Error) => setError(e.message))
  }, [code])
  useEffect(reload, [reload])

  // בזמן שיש עבודה בתור — רענון כל 5 שניות, כמו במסך הגנים
  const active = uploads.some((u) => u.status === 'pending' || u.status === 'processing')
  useEffect(() => {
    if (!active) return
    const t = setInterval(reload, 5000)
    return () => clearInterval(t)
  }, [active, reload])

  // קליטה שהסתיימה → הנתונים שבזיכרון כבר לא נכונים
  const doneIds = uploads.filter((u) => u.status === 'done').map((u) => u.id).join()
  useEffect(() => {
    if (doneIds) clearRoundCache()
  }, [doneIds])

  const roles = picked.map((p) => p.role).filter(Boolean) as BagrutRole[]
  const missing = useMemo(() => missingBagrutRoles(roles), [roles])
  const unknown = picked.filter((p) => !p.role)
  const dupes = (['details', 't1_11', 't1_12', 't2', 'compass', 'accdb'] as BagrutRole[]).filter(
    (r) => roles.filter((x) => x === r).length > 1,
  )
  const ready = picked.length > 0 && !missing.length && !unknown.length && !dupes.length && /^\d+$/.test(school) && year.trim()

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await uploadBagrutRound(code, { school, season, year: year.trim() },
        picked.map((p) => ({ file: p.file, role: p.role! })))
      setPicked([])
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!isSuperAdmin) {
    return <Empty title="קליטת סבב זמינה למנהל-על">הנתונים נקלטים מקובצי T1, T2 והמצפן שמכין סבא.</Empty>
  }

  const input = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-800">קליטת סבב בגרות</h1>
        <p className="mt-1 text-sm text-slate-500">
          T1, T2 והמצפן של בית הספר. הסוכן בודק את הקבצים וטוען — סבב קיים של אותו מוסד, מועד ושנה מוחלף,
          וסימוני המעקב של הצוות נשמרים.
        </p>
      </div>

      {/* ── 1. הסבב ── */}
      <Card title="1 · הסבב">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold text-slate-600">
            סמל מוסד
            <input value={school} onChange={(e) => setSchool(e.target.value.trim())} className={`${input} mt-1 block w-32 tabular-nums`} />
          </label>
          <label className="text-sm font-semibold text-slate-600">
            מועד
            <select value={season} onChange={(e) => setSeason(e.target.value as 'קיץ' | 'חורף')} className={`${input} mt-1 block`}>
              <option>קיץ</option>
              <option>חורף</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-600">
            שנה
            <input value={year} onChange={(e) => setYear(e.target.value)} placeholder='תשפ"ו' className={`${input} mt-1 block w-28`} />
          </label>
          <p className="mb-2 text-xs text-slate-400">הסוכן משווה את סמל המוסד לסמל שבקובץ פרטי התלמידים, ועוצר אם אינם תואמים.</p>
        </div>
      </Card>

      {/* ── 2. הקבצים ── */}
      <Card title="2 · הקבצים">
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center transition hover:border-sky-400 hover:bg-sky-50">
          <span className="text-sm font-bold text-slate-700">בחירת קבצים</span>
          <span className="text-xs text-slate-500">ייצוא האקסל של טבלאות האקסס (זכאות 1, 11, 12, 13, 14) והמצפן — או קובץ האקסס והמצפן</span>
          <input
            type="file"
            multiple
            accept=".xlsx,.accdb"
            className="hidden"
            onChange={(e) => {
              const list = [...(e.target.files ?? [])].map((file) => ({ file, role: detectBagrutRole(file.name) }))
              setPicked((p) => [...p, ...list])
              e.target.value = ''
            }}
          />
        </label>

        {picked.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {picked.map((p, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className={p.role ? 'text-emerald-600' : 'text-rose-600'}>{p.role ? '✓' : '✕'}</span>
                <span className="truncate text-slate-700">{p.file.name}</span>
                <span className="mr-auto shrink-0">
                  <select
                    value={p.role ?? ''}
                    onChange={(e) => setPicked((all) => all.map((x, j) => (j === i ? { ...x, role: (e.target.value || null) as BagrutRole | null } : x)))}
                    className={`rounded-md border px-2 py-0.5 text-xs ${p.role ? 'border-slate-200' : 'border-rose-300 bg-rose-50'}`}
                  >
                    <option value="">— תפקיד לא זוהה —</option>
                    {(Object.keys(BAGRUT_ROLE_LABELS) as BagrutRole[]).map((r) => (
                      <option key={r} value={r}>{BAGRUT_ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </span>
                <button onClick={() => setPicked((all) => all.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600" title="הסרה">✕</button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {missing.map((r) => (
            <span key={r} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
              חסר: {BAGRUT_ROLE_LABELS[r]}
            </span>
          ))}
          {dupes.map((r) => (
            <span key={r} className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-200">
              כפול: {BAGRUT_ROLE_LABELS[r]}
            </span>
          ))}
        </div>

        {error && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}

        <div className="mt-4 flex items-center gap-3">
          <button
            disabled={!ready || busy}
            onClick={submit}
            className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-sky-700 disabled:opacity-40"
          >
            {busy ? 'מעלה…' : '⬆ העלאה לקליטה'}
          </button>
          <span className="text-xs text-slate-500">הקבצים נמחקים מהמחשב של הסוכן מיד בסיום העיבוד.</span>
        </div>
      </Card>

      {/* ── 3. היסטוריה ── */}
      <Card title="3 · היסטוריית קליטות" action={active && <span className="text-xs text-sky-700">מתעדכן כל 5 שניות…</span>}>
        {uploads.length === 0 ? (
          <p className="text-sm text-slate-400">עדיין לא נקלט סבב דרך האתר.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {uploads.map((u) => {
              const r = u.report ?? {}
              const c = r.counts ?? {}
              return (
                <div key={u.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS[u.status].cls}`}>{STATUS[u.status].label}</span>
                    <strong className="text-slate-800">{r.school_name ?? `מוסד ${u.school_code}`}</strong>
                    <span className="text-slate-500">· {u.season} {u.school_year} · {u.file_count} קבצים</span>
                    <span className="mr-auto text-xs text-slate-400">{new Date(u.uploaded_at).toLocaleString('he-IL')}</span>
                  </div>
                  {u.status === 'done' && (
                    <div className="mt-2 text-sm text-slate-600">
                      {c.students} תלמידים · {c.t2} ניתוחי זכאות · {c.grades?.toLocaleString('he-IL')} ציונים · {c.subjects} מקצועות
                      {c.tracking ? ` · ${c.tracking} סימוני מעקב` : ''}
                      {u.round_id && (
                        <a href={`/bagrut/${code}`} className="mr-2 font-semibold text-sky-700 hover:underline">לסבב ←</a>
                      )}
                    </div>
                  )}
                  {u.status === 'failed' && (
                    <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                      {u.error_message ?? 'הקליטה נכשלה'}
                    </div>
                  )}
                  {(r.warnings?.length ?? 0) > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {r.warnings!.map((w, i) => (
                        <li key={i} className="flex gap-2 text-xs text-amber-800">
                          <span>⚠</span>
                          <span>{w.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
