import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBagrut, type CardNavState } from './context'
import { Empty } from '@/components/bagrut/ui'
import { classSortKey, displayName, FLAG_FIELD_LABELS, reviewFlag, studentPath, type BagrutFlag } from '@/lib/bagrut'
import { fmtDate } from '@/lib/bagrutCycle'

type Show = 'open' | 'reviewed' | 'all'
const SHOW_LABELS: Record<Show, string> = { open: 'לטיפול', reviewed: 'נבדקו', all: 'הכול' }

/** מה אומר כל סוג דגל — ומה עושים איתו */
const FIELD_HINT: Record<string, string> = {
  completion_status: 'לפי המצפן המקצוע הושלם, ועיבוד הציונים אומר שלא (או להפך). ייתכן ששאלון חסר במצפן של בית הספר. נשמרה הקביעה של עיבוד הציונים.',
  final_grade: 'הציון הסופי שחושב מציוני השאלונים שונה מהציון שבעיבוד הציונים.',
  cumulative_grade: 'הציון המצטבר שחושב מציוני השאלונים שונה מהציון שבעיבוד הציונים — בדרך כלל כשהתלמיד נבחן בשני שאלונים חלופיים.',
  total_units: 'ניתוח הזכאות ספר יח"ל אחרות מהמנוע — למשל מקצוע חובה והמורחב שלו יחד.',
  core_units: 'ניתוח הזכאות ספר יח"ל מלל אחרות מהמנוע.',
  negatives_count: 'ניתוח הזכאות ספר מספר שליליים אחר מהמנוע.',
  blockers: 'ניתוח הזכאות מנה חסמים מסוג אחר מהמנוע.',
  status: 'ניתוח הזכאות קבע סטטוס זכאות אחר מהמנוע.',
}

/**
 * דגלים אדומים (041, decisions/021): כל מקום שבו מנוע הזכאות אינו מסכים עם
 * הקבצים של סבא — **בנתון שלא נערך באתר**. תלמיד שציון שלו עודכן צפוי להיות
 * שונה, ולכן אין לו דגלים. המנוע מייצר ומוחק את הדגלים בכל חישוב; כאן רק
 * בודקים, מסמנים "נבדק" ומשאירים הערה. דגל שנבדק נפתח מחדש אם אחד הערכים השתנה.
 * מנהל־על ורכז/ת בגרויות בלבד (התפריט; האכיפה במסד).
 */
export default function BagrutFlags() {
  const { data, index, round, base, canEditGrades } = useBagrut()
  const [params, setParams] = useSearchParams()
  const show = (['open', 'reviewed', 'all'] as string[]).includes(params.get('show') ?? '') ? (params.get('show') as Show) : 'open'
  const field = params.get('field') ?? ''
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const counts = useMemo(() => {
    const byField = new Map<string, number>()
    for (const f of data.flags) if (f.status === 'open') byField.set(f.field, (byField.get(f.field) ?? 0) + 1)
    return {
      open: data.flags.filter((f) => f.status === 'open').length,
      reviewed: data.flags.filter((f) => f.status === 'reviewed').length,
      byField: [...byField].sort((a, b) => b[1] - a[1]),
    }
  }, [data.flags])

  // לפי תלמיד — כל הדגלים שלו יחד, בסדר הכיתות
  const groups = useMemo(() => {
    const rows = data.flags.filter((f) => (show === 'all' || f.status === show) && (!field || f.field === field))
    const by = new Map<string, BagrutFlag[]>()
    for (const f of rows) by.set(f.student_id, [...(by.get(f.student_id) ?? []), f])
    return [...by].sort(([a], [b]) => {
      const sa = index.studentById.get(a)
      const sb = index.studentById.get(b)
      return classSortKey(sa?.class_name ?? null).localeCompare(classSortKey(sb?.class_name ?? null))
        || (sa ? displayName(sa) : '').localeCompare(sb ? displayName(sb) : '', 'he')
    })
  }, [data.flags, show, field, index])

  if (!canEditGrades) {
    return <Empty title="אין הרשאה">הדגלים האדומים — למנהל־על ולרכז/ת הבגרויות.</Empty>
  }
  if (!data.flags.length) {
    return (
      <Empty title="אין דגלים אדומים">
        מנוע הזכאות מסכים עם עיבוד הציונים ועם ניתוח הזכאות בכל הנתונים שלא נערכו באתר.
      </Empty>
    )
  }

  const navState: CardNavState = { ids: groups.map(([sid]) => sid), fromLabel: 'דגלים אדומים', backTo: `${base}/flags${params.toString() ? `?${params}` : ''}` }
  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1 text-sm font-semibold transition ${active ? 'bg-white text-rose-800 shadow-sm' : 'text-slate-500 hover:text-rose-700'}`

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-extrabold text-slate-800"><span className="text-rose-600">⚑</span> דגלים אדומים</h1>
        <p className="mt-1 text-sm text-slate-600">
          איפה מנוע הזכאות הגיע לתוצאה אחרת מהקבצים — בנתונים שלא נערכו באתר. מה שמוצג בכל המסכים הוא חישוב המנוע;
          כאן בודקים אם הקובץ או המצפן צריכים תיקון.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-0.5 rounded-xl bg-slate-100 p-1">
          {(Object.keys(SHOW_LABELS) as Show[]).map((k) => (
            <button key={k} onClick={() => set('show', k === 'open' ? '' : k)} className={tab(show === k)}>
              {SHOW_LABELS[k]}
              <span className="mr-1 text-xs font-normal opacity-70">({k === 'open' ? counts.open : k === 'reviewed' ? counts.reviewed : data.flags.length})</span>
            </button>
          ))}
        </div>
        <select value={field} onChange={(e) => set('field', e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
          <option value="">כל סוגי הדגלים</option>
          {Object.entries(FLAG_FIELD_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        {counts.byField.length > 0 && (
          <span className="text-xs text-slate-500">
            לטיפול: {counts.byField.map(([f, n]) => `${FLAG_FIELD_LABELS[f] ?? f} ${n}`).join(' · ')}
          </span>
        )}
      </div>

      {!groups.length ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">אין דגלים בתצוגה הזו.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map(([sid, flags]) => {
            const s = index.studentById.get(sid)
            return (
              <li key={sid} className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  {s ? (
                    <Link to={studentPath(base, round, sid)} state={navState} className="font-bold text-slate-800 hover:text-sky-700 hover:underline">
                      {displayName(s)}
                    </Link>
                  ) : (
                    <span className="font-bold text-slate-500">תלמיד שאינו בסבב</span>
                  )}
                  {s?.class_name && <span className="text-xs text-slate-500">{s.class_name}</span>}
                  <span className="text-xs text-slate-400">{flags.length} {flags.length === 1 ? 'דגל' : 'דגלים'}</span>
                </div>
                <ul className="flex flex-col divide-y divide-slate-100">
                  {flags.map((f) => <FlagRow key={f.id} flag={f} />)}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function FlagRow({ flag }: { flag: BagrutFlag }) {
  const { index, applyFlag } = useBagrut()
  const [note, setNote] = useState(flag.note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const subject = flag.subject_key ? index.subjectByKey.get(flag.subject_key)?.subject_name ?? flag.subject_key : null
  const source = flag.source === 't1' ? 'עיבוד הציונים' : 'ניתוח הזכאות'

  const save = async (reviewed: boolean) => {
    setBusy(true)
    setErr(null)
    try {
      applyFlag(await reviewFlag(flag.id, reviewed, note))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-slate-700">
          {FLAG_FIELD_LABELS[flag.field] ?? flag.field}{subject ? ` · ${subject}` : ''}
        </span>
        <span className="text-slate-500">ב{source}: <b className="text-slate-700">{flag.source_value ?? '—'}</b></span>
        <span className="text-slate-500">מחושב: <b className="text-rose-700">{flag.calc_value ?? '—'}</b></span>
        {flag.status === 'reviewed' && (
          <span className="rounded bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700">
            נבדק{flag.reviewed_by_email ? ` ע"י ${flag.reviewed_by_email}` : ''}{flag.reviewed_at ? ` · ${fmtDate(flag.reviewed_at)}` : ''}
          </span>
        )}
      </div>
      {FIELD_HINT[flag.field] && <p className="text-xs text-slate-500">{FIELD_HINT[flag.field]}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="הערה — מה נבדק, מה הוחלט"
          className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300"
        />
        {flag.status === 'open' ? (
          <button disabled={busy} onClick={() => save(true)}
            className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'שומר…' : '✓ נבדק'}
          </button>
        ) : (
          <>
            {note !== (flag.note ?? '') && (
              <button disabled={busy} onClick={() => save(true)}
                className="rounded-md bg-sky-600 px-3 py-1 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50">שמירת ההערה</button>
            )}
            <button disabled={busy} onClick={() => save(false)}
              className="rounded-md px-3 py-1 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50">החזרה לטיפול</button>
          </>
        )}
      </div>
      {err && <p className="text-xs text-rose-700">{err}</p>}
    </li>
  )
}
