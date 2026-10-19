import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { fetchAllStudents, type StudentRow } from '@/lib/students'
import { OUTSIDE_STUDENT, RESIDENT_STUDIES_OUTSIDE, SPECIAL_ED_PLACEMENT, withComputedFields } from '@/lib/computed'
import { fetchAuthorities, type Authority } from '@/lib/admin'
import { ALL_FIELDS, fieldLabel, useFieldsVersion } from '@/config/fields'
import { ACTIVE_STATUS_FIELD, ACTIVE_STATUS_VALUE } from '@/config/presets'
import { buildPivot, cellValue, type PivotNavState } from '@/lib/pivot'
import { CLASS_SIZE_BINS, classSizes, countBy, keyOf, splitKeys, topN, type Bucket } from '@/lib/charts'
import { ChartCard, Columns, Donut, Heatmap, HBars, Legend, Stat } from '@/components/charts/Charts'

/** סינון שנוסף בלחיצה על פס או פלח: שדה = ערך */
interface Pick {
  field: string
  value: string
}

type Base = 'active' | 'all'

const fmt = (n: number) => n.toLocaleString('he-IL')
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '—')

/**
 * מסך הגרפים — תמונת הרשות במבט אחד (אייל, 19.10). אחות של הפיבוטים:
 * אותם נתונים בזיכרון, אותה ברירת מחדל (תלמידים משובצים), ואותו "שליחה
 * מהטבלה" — מגיעים מהטבלה עם הסינון, והגרפים מחושבים על מה שהיה על המסך.
 *
 * הגרפים נבחרו לפי הפיבוטים המוגדרים מראש (מוסדות × שכבה, יישוב, תלמידי חוץ
 * ופנים, חינוך מיוחד) ומה שמעניין בנתונים עצמם (מגדר, מגמות, גודל כיתה).
 *
 * **לחיצה על פס או פלח מסננת את כל המסך** — "בנות", ואז "שכבה ט", ואז רואים
 * איפה הן לומדות. הסינונים מוצגים כתגיות, וכל אחד מוסר בנפרד.
 */
export default function Charts() {
  const { profile } = useAuth()
  const { code: codeFromUrl } = useParams()
  const location = useLocation()
  const navState = (location.state ?? {}) as PivotNavState

  const [authorities, setAuthorities] = useState<Authority[]>([])
  const authorityCode = codeFromUrl ?? profile?.authority_codes?.[0] ?? ''
  const [rawStudents, setRawStudents] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const incomingIds = useMemo(() => (navState.ids?.length ? new Set(navState.ids) : null), [navState.ids])
  const [useIncoming, setUseIncoming] = useState(Boolean(incomingIds))
  const [base, setBase] = useState<Base>('active')
  const [picks, setPicks] = useState<Pick[]>([])

  // הגרף החופשי
  const [freeField, setFreeField] = useState('SHLAV_HINUCH_TEUR')
  const [freeSplit, setFreeSplit] = useState('CODE_MIN')

  useEffect(() => {
    fetchAuthorities().then(setAuthorities).catch(() => setAuthorities([]))
  }, [])

  useEffect(() => {
    if (!authorityCode) return
    setLoading(true)
    fetchAllStudents(authorityCode)
      .then(setRawStudents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [authorityCode])

  const authority = authorities.find((a) => a.code === authorityCode)
  const moeCode = authority?.moe_code ?? authorityCode
  const students = useMemo(() => withComputedFields(rawStudents, moeCode), [rawStudents, moeCode])

  // הבסיס: מה שהגיע מהטבלה, או משובצים / כל הרשומות
  const baseRows = useMemo(() => {
    if (useIncoming && incomingIds) return students.filter((s) => incomingIds.has(String(s['MISPAR_ZEHUT'] ?? '')))
    if (base === 'all') return students
    return students.filter((s) => String(s[ACTIVE_STATUS_FIELD] ?? '').trim() === ACTIVE_STATUS_VALUE)
  }, [students, useIncoming, incomingIds, base])

  const rows = useMemo(
    () => (picks.length ? baseRows.filter((r) => picks.every((p) => keyOf(r[p.field]) === p.value)) : baseRows),
    [baseRows, picks],
  )

  const pick = (field: string) => (value: string) =>
    setPicks((prev) => [...prev.filter((p) => p.field !== field), { field, value }])
  const picked = (field: string) => picks.some((p) => p.field === field)

  const fieldsVersion = useFieldsVersion()
  // ALL_FIELDS הוא binding חי שמשתנה ברישום עמודות תוספתיות
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fieldOptions = useMemo(() => ALL_FIELDS, [fieldsVersion])

  const c = useMemo(() => {
    const total = rows.length
    const gender = countBy(rows, 'CODE_MIN', { blank: false })
    const byGrade = countBy(rows, 'SHICHVA', { splitBy: 'CODE_MIN', order: 'natural' })
    const status = countBy(rows, 'STATUS_TALMID_BARASHUT')
    const schools = countBy(rows, 'SHEM_MOSAD', { splitBy: 'STATUS_TALMID_BARASHUT' })
    const settlements = countBy(rows, 'TEUR_YISHUV1')
    const frameType = countBy(rows, 'SUG_MOSAD_TEUR')
    const classTypes = countBy(rows, 'TEUR_SUG_KITA', { blank: false }).filter((b) => b.key !== 'רגילה')
    const megamot = countBy(rows, 'TEUR_MEGAMA_MISRAD', { blank: false })
    const registration = countBy(rows, 'MATZAV_RISHUM_TEUR')

    const sizes = classSizes(rows)
    const sizeBins: Bucket[] = CLASS_SIZE_BINS.map((b) => ({ key: b.label, n: sizes.filter((s) => s.n >= b.min && s.n <= b.max).length }))
    const biggest = [...sizes].sort((a, b) => b.n - a.n).slice(0, 6)
    const avgClass = sizes.length ? sizes.reduce((s, x) => s + x.n, 0) / sizes.length : 0

    // מפת חום: 12 המוסדות הגדולים × שכבה
    const topSchools = new Set(schools.slice(0, 12).map((b) => b.key))
    const heat = buildPivot(rows.filter((r) => topSchools.has(keyOf(r['SHEM_MOSAD']))), 'SHEM_MOSAD', 'SHICHVA')
    const heatRows = schools.slice(0, 12).map((b) => b.key)

    const count = (field: string, value: string) => rows.filter((r) => keyOf(r[field]) === value).length
    return {
      total, gender, byGrade, status, schools, settlements, frameType, classTypes, megamot, registration,
      sizes, sizeBins, biggest, avgClass, heat, heatRows,
      schoolsN: new Set(rows.map((r) => keyOf(r['SEMEL_MOSAD']))).size,
      settlementsN: settlements.filter((b) => b.key !== '(ריק)').length,
      specialEd: count('STATUS_CHINUCH_MEYUCHAD', SPECIAL_ED_PLACEMENT),
      outside: count('STATUS_TALMID_BARASHUT', OUTSIDE_STUDENT),
      studiesOutside: count('STATUS_TALMID_BARASHUT', RESIDENT_STUDIES_OUTSIDE),
    }
  }, [rows])

  const free = useMemo(() => {
    const buckets = countBy(rows, freeField, freeSplit ? { splitBy: freeSplit } : {})
    return { buckets: topN(buckets, 20), keys: freeSplit ? splitKeys(buckets).slice(0, 10) : undefined, distinct: buckets.length }
  }, [rows, freeField, freeSplit])

  const gradeKeys = splitKeys(c.byGrade)
  const schoolKeys = splitKeys(c.schools)
  const girls = c.gender.find((b) => b.key === 'נקבה')?.n ?? 0
  const boys = c.gender.find((b) => b.key === 'זכר')?.n ?? 0
  const select = 'max-w-[12rem] rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm'

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-sky-800">גרפים</h1>
          <span className="rounded-lg bg-sky-50 px-2 py-1 text-sm font-medium text-sky-800">{authority?.name ?? `רשות ${authorityCode}`}</span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Link to={`/pivot/${authorityCode}`} state={useIncoming ? navState : undefined} className="rounded-lg px-2 py-1 text-slate-500 transition hover:bg-sky-50 hover:text-sky-700">
            ▦ פיבוטים
          </Link>
          <Link to={`/students/${authorityCode}`} className="rounded-lg px-2 py-1 text-slate-500 transition hover:bg-sky-50 hover:text-sky-700">
            → חזרה לטבלה
          </Link>
        </div>
      </header>

      {/* הבסיס והסינונים שנוספו בלחיצה */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-sm">
        {useIncoming && incomingIds ? (
          <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800 ring-1 ring-inset ring-amber-200">
            מחושב על מה שהיה על המסך — {navState.fromLabel ?? 'הסינון שהגעת איתו'} ({fmt(incomingIds.size)})
            <button onClick={() => setUseIncoming(false)} className="mr-2 underline">ביטול</button>
          </span>
        ) : (
          <div className="flex rounded-lg border border-slate-300 p-0.5">
            {([['active', 'תלמידים משובצים'], ['all', 'כל הרשומות']] as [Base, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setBase(k)} className={`rounded-md px-2.5 py-0.5 ${base === k ? 'bg-sky-100 font-bold text-sky-900' : 'text-slate-600 hover:bg-slate-100'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        {!useIncoming && incomingIds && (
          <button onClick={() => setUseIncoming(true)} className="rounded-lg border border-amber-300 px-2 py-0.5 text-amber-800 hover:bg-amber-50">החזרת הצמצום מהטבלה</button>
        )}
        {picks.map((p) => (
          <span key={p.field} className="flex items-center gap-1 rounded-full bg-sky-600 py-0.5 pl-1 pr-2.5 text-xs font-semibold text-white">
            {fieldLabel(p.field)}: {p.value}
            <button onClick={() => setPicks((prev) => prev.filter((x) => x.field !== p.field))} className="rounded-full px-1 hover:bg-sky-700" title="הסרת הסינון">✕</button>
          </span>
        ))}
        {picks.length > 0 ? (
          <button onClick={() => setPicks([])} className="text-xs text-slate-500 hover:underline">ניקוי הכול</button>
        ) : (
          <span className="text-xs text-slate-400">לחיצה על פס או פלח מסננת את כל הגרפים</span>
        )}
        <span className="mr-auto text-slate-600"><strong className="text-sky-700">{fmt(c.total)}</strong> תלמידים</span>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <p className="p-8 text-center text-slate-400">טוען נתונים…</p>
        ) : error ? (
          <p className="p-8 text-center text-red-600">שגיאה: {error}</p>
        ) : c.total === 0 ? (
          <p className="p-8 text-center text-slate-400">אין תלמידים בסינון הזה</p>
        ) : (
          <div className="mx-auto flex max-w-7xl flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <Stat value={fmt(c.total)} label="תלמידים" sub={base === 'active' && !useIncoming ? 'משובצים' : undefined} tone="text-sky-700" />
              <Stat value={pct(girls, girls + boys)} label="בנות" sub={`${fmt(girls)} בנות · ${fmt(boys)} בנים`} tone="text-pink-600" />
              <Stat value={fmt(c.schoolsN)} label="מוסדות" />
              <Stat value={fmt(c.settlementsN)} label="יישובי מגורים" />
              <Stat value={fmt(c.specialEd)} label="חינוך מיוחד (משבצת)" sub={pct(c.specialEd, c.total)} tone="text-violet-700" />
              <Stat value={fmt(c.outside)} label="תלמידי חוץ" sub={c.studiesOutside ? `${fmt(c.studiesOutside)} גרים כאן ולומדים בחוץ` : undefined} tone="text-amber-600" />
              <Stat value={c.avgClass ? c.avgClass.toFixed(1) : '—'} label="ממוצע תלמידים בכיתה" sub={`${fmt(c.sizes.length)} כיתות`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="תלמידים לפי שכבה" sub="בנים ובנות בכל שכבה" className="lg:col-span-2">
                <Columns items={c.byGrade} splitKeys={gradeKeys} onPick={pick('SHICHVA')} />
                <Legend keys={gradeKeys} />
              </ChartCard>
              <ChartCard title="סטטוס תלמיד ברשות" sub="איפה גר ואיפה לומד">
                <Donut items={c.status} onPick={pick('STATUS_TALMID_BARASHUT')} />
              </ChartCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="מוסדות" sub={`${fmt(c.schools.length)} מוסדות · 15 הגדולים · לפי סטטוס ברשות`}>
                <HBars items={topN(c.schools, 15)} splitKeys={schoolKeys} onPick={pick('SHEM_MOSAD')} />
                <Legend keys={schoolKeys} />
              </ChartCard>
              <ChartCard title="יישוב מגורים" sub={`${fmt(c.settlementsN)} יישובים`}>
                <HBars items={topN(c.settlements, 15)} onPick={pick('TEUR_YISHUV1')} />
              </ChartCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="גודל כיתה" sub={`כמה כיתות בכל טווח · ${fmt(c.sizes.length)} כיתות`}>
                <Columns items={c.sizeBins} height={120} />
                {c.biggest.length > 0 && (
                  <div className="mt-2 border-t border-slate-100 pt-2 text-xs">
                    <div className="mb-1 font-semibold text-slate-500">הכיתות הגדולות</div>
                    {c.biggest.map((x) => (
                      <div key={`${x.school}|${x.className}`} className="flex gap-2">
                        <span className="truncate text-slate-700">{x.school} · {x.className}</span>
                        <span className="mr-auto font-bold tabular-nums text-slate-800">{x.n}</span>
                      </div>
                    ))}
                  </div>
                )}
              </ChartCard>
              <ChartCard title="סוג מסגרת" sub="סוג המוסד">
                <Donut items={topN(c.frameType, 5)} onPick={pick('SUG_MOSAD_TEUR')} />
              </ChartCard>
              <ChartCard title="סוגי כיתות" sub="כל הכיתות שאינן רגילות — חינוך מיוחד, ל״ב, מרכז חינוך">
                {c.classTypes.length ? <HBars items={topN(c.classTypes, 10)} onPick={pick('TEUR_SUG_KITA')} /> : <p className="text-xs text-slate-400">אין כיתות שאינן רגילות</p>}
              </ChartCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="מוסדות × שכבה" sub="12 המוסדות הגדולים — לחיצה על תא מסננת לשניהם" className="lg:col-span-2">
                <Heatmap
                  rows={c.heatRows}
                  cols={c.heat.colKeys}
                  value={(r, col) => cellValue(c.heat, r, col)}
                  rowLabel="מוסד"
                  onPick={(r, col) => setPicks((prev) => [...prev.filter((p) => p.field !== 'SHEM_MOSAD' && p.field !== 'SHICHVA'), { field: 'SHEM_MOSAD', value: r }, { field: 'SHICHVA', value: col }])}
                />
              </ChartCard>
              <ChartCard title="מגמות" sub="מגמת משרד — לתלמידים שיש להם">
                {c.megamot.length ? <HBars items={topN(c.megamot, 10)} onPick={pick('TEUR_MEGAMA_MISRAD')} /> : <p className="text-xs text-slate-400">אין מגמות בסינון הזה</p>}
              </ChartCard>
            </div>

            {(base === 'all' || picked('MATZAV_RISHUM_TEUR')) && !useIncoming && (
              <ChartCard title="מצב רישום" sub="משובצים, עזבו, מועמדים">
                <Donut items={c.registration} onPick={pick('MATZAV_RISHUM_TEUR')} />
              </ChartCard>
            )}

            {/* גרף חופשי — כמו הבחירה החופשית בפיבוטים */}
            <ChartCard
              title="גרף חופשי"
              sub={`${fieldLabel(freeField)}${freeSplit ? ` לפי ${fieldLabel(freeSplit)}` : ''} · ${fmt(free.distinct)} ערכים${free.distinct > 21 ? ' · 20 השכיחים' : ''}`}
              action={
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-1">
                    <span className="text-slate-500">שדה</span>
                    <select value={freeField} onChange={(e) => setFreeField(e.target.value)} className={select}>
                      {fieldOptions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-slate-500">פיצול</span>
                    <select value={freeSplit} onChange={(e) => setFreeSplit(e.target.value)} className={select}>
                      <option value="">בלי</option>
                      {fieldOptions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                </div>
              }
            >
              <HBars items={free.buckets} splitKeys={free.keys} onPick={pick(freeField)} />
              {free.keys && <Legend keys={free.keys} />}
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  )
}
