import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { fetchAllStudents, type StudentRow } from '@/lib/students'
import { withComputedFields } from '@/lib/computed'
import { applyFilters, isConditionReady, type FilterCondition } from '@/lib/filters'
import { fetchAuthorities, type Authority } from '@/lib/admin'
import { fieldLabel, ALL_FIELDS, useFieldsVersion } from '@/config/fields'
import { ACTIVE_STATUS_FIELD, ACTIVE_STATUS_VALUE } from '@/config/presets'
import {
  buildPivot,
  cellValue,
  PIVOT_PRESETS,
  type PivotNavState,
  type PivotPreset,
} from '@/lib/pivot'
import { downloadWorkbook } from '@/lib/xlsx'

const DEFAULT_FILTERS: FilterCondition[] = [
  {
    id: 'pivot-active',
    field: ACTIVE_STATUS_FIELD,
    operator: 'equals',
    value: ACTIVE_STATUS_VALUE,
  },
]

/**
 * דף הפיבוטים — הערה 7 של סבא.
 *
 * זרימת העבודה שהוא ביקש: מסננים ומצמצמים בטבלה הראשית, שולחים לכאן,
 * ומחוללים את הסיכום על מה שסונן. אפשר גם להגיע ישירות — ואז מוצג
 * הסינון הרגיל של תלמידים משובצים.
 */
export default function Pivot() {
  const { profile } = useAuth()
  const { code: codeFromUrl } = useParams()
  const location = useLocation()
  const navState = (location.state ?? {}) as PivotNavState

  const [authorities, setAuthorities] = useState<Authority[]>([])
  const authorityCode = codeFromUrl ?? profile?.authority_codes?.[0] ?? ''

  const [rawStudents, setRawStudents] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [preset, setPreset] = useState<PivotPreset>(PIVOT_PRESETS[0])
  const [rowField, setRowField] = useState(PIVOT_PRESETS[0].rowField)
  const [colField, setColField] = useState(PIVOT_PRESETS[0].colField)
  /** ההיקף שהגענו איתו — ניתן להסרה כדי לראות את כל הרשות */
  const incoming = Boolean(navState.ids?.length || navState.filters?.length)
  const [useIncoming, setUseIncoming] = useState(incoming)

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

  const students = useMemo(
    () => withComputedFields(rawStudents, moeCode),
    [rawStudents, moeCode],
  )

  const filters = useMemo(() => {
    const source = useIncoming && navState.filters?.length ? navState.filters : DEFAULT_FILTERS
    return source.filter(isConditionReady)
  }, [useIncoming, navState.filters])

  /**
   * רשימת הת"ז שהגיעה מהטבלה גוברת על התנאים.
   *
   * היא כבר מגלמת את **כל** הצמצומים שהיו על המסך — סינון, טבלה
   * ייעודית וזיהוי אחים — ולכן הפיבוט מחושב על בדיוק אותן שורות
   * שהמשתמש ראה, ולא על שחזור מקורב שלהן.
   */
  const incomingIds = useMemo(
    () => (navState.ids?.length ? new Set(navState.ids) : null),
    [navState.ids],
  )

  const rows = useMemo(() => {
    if (useIncoming && incomingIds) {
      return students.filter((s) => incomingIds.has(String(s['MISPAR_ZEHUT'] ?? '')))
    }
    return applyFilters(students, filters)
  }, [students, filters, useIncoming, incomingIds])
  const pivot = useMemo(() => buildPivot(rows, rowField, colField), [rows, rowField, colField])

  function choosePreset(p: PivotPreset) {
    setPreset(p)
    setRowField(p.rowField)
    setColField(p.colField)
  }

  async function exportPivot() {
    const headers = [fieldLabel(rowField), ...pivot.colKeys, 'סך הכול']
    const data = pivot.rowKeys.map((r) => [
      r,
      ...pivot.colKeys.map((c) => cellValue(pivot, r, c)),
      pivot.rowTotals.get(r) ?? 0,
    ])
    data.push([
      'סך הכול',
      ...pivot.colKeys.map((c) => pivot.colTotals.get(c) ?? 0),
      pivot.total,
    ])

    // כל העמודות חוץ מהראשונה הן ספירות
    const numericColumns = new Set(headers.map((_, i) => i).filter((i) => i > 0))
    const stamp = new Date().toISOString().slice(0, 10)

    await downloadWorkbook(
      { sheetName: preset.name.slice(0, 31), headers, rows: data, numericColumns },
      `פיבוט_${preset.name}_${authority?.name ?? authorityCode}_${stamp}`,
    )
  }

  const fieldsVersion = useFieldsVersion()
  // ALL_FIELDS הוא binding חי שמשתנה ברישום עמודות תוספתיות
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fieldOptions = useMemo(() => ALL_FIELDS, [fieldsVersion])

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-sky-800">דוחות סיכום (פיבוטים)</h1>
          <span className="rounded-lg bg-sky-50 px-2 py-1 text-sm font-medium text-sky-800">
            {authority?.name ?? `רשות ${authorityCode}`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link
            to={`/students/${authorityCode}`}
            className="rounded-lg px-2 py-1 text-slate-500 transition hover:bg-sky-50 hover:text-sky-700"
          >
            → חזרה לטבלה
          </Link>
        </div>
      </header>

      {/* פיבוטים מוגדרים מראש */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-white px-4 pt-2">
        {PIVOT_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => choosePreset(p)}
            title={p.description}
            className={
              'rounded-t-lg px-3 py-2 text-sm font-medium transition ' +
              (preset.id === p.id
                ? 'border-b-2 border-sky-600 bg-sky-600 text-white'
                : 'border-b-2 border-transparent text-slate-600 hover:bg-sky-50 hover:text-sky-700')
            }
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* בחירה חופשית של הצירים */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-slate-500">שורות</span>
          <select
            value={rowField}
            onChange={(e) => setRowField(e.target.value)}
            className="max-w-[12rem] rounded-lg border border-slate-300 px-2 py-1"
          >
            {fieldOptions.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-slate-500">עמודות</span>
          <select
            value={colField}
            onChange={(e) => setColField(e.target.value)}
            className="max-w-[12rem] rounded-lg border border-slate-300 px-2 py-1"
          >
            {fieldOptions.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={exportPivot}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white shadow-sm transition hover:bg-emerald-700"
        >
          ⬇ ייצוא לאקסל
        </button>

        <span className="mr-auto text-slate-600">
          <strong className="text-sky-700">{pivot.total.toLocaleString('he-IL')}</strong> תלמידים ·{' '}
          {pivot.rowKeys.length} שורות × {pivot.colKeys.length} עמודות
        </span>
      </div>

      {incoming ? (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>
            {useIncoming
              ? `הפיבוט מחושב על מה שהיה על המסך — ${navState.fromLabel ?? 'הסינון שהגעת איתו'}` +
                (navState.ids ? ` (${navState.ids.length.toLocaleString('he-IL')} תלמידים)` : '')
              : 'הצמצום שהגעת איתו בוטל — הפיבוט מחושב על כל התלמידים המשובצים'}
          </span>
          <button
            onClick={() => setUseIncoming((v) => !v)}
            className="rounded border border-amber-300 px-2 py-0.5 hover:bg-amber-100"
          >
            {useIncoming ? 'ביטול הצמצום' : 'החזרת הצמצום'}
          </button>
        </div>
      ) : null}

      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <p className="p-8 text-center text-slate-400">טוען נתונים…</p>
        ) : error ? (
          <p className="p-8 text-center text-red-600">שגיאה: {error}</p>
        ) : pivot.rowKeys.length === 0 ? (
          <p className="p-8 text-center text-slate-400">אין נתונים להצגה</p>
        ) : (
          <table className="border-collapse bg-white text-sm shadow-sm">
            <thead>
              <tr>
                <th className="sticky right-0 top-0 z-20 border border-slate-200 bg-sky-100 px-3 py-2 text-right font-bold text-sky-900">
                  {fieldLabel(rowField)}
                </th>
                {pivot.colKeys.map((c) => (
                  <th
                    key={c}
                    className="sticky top-0 z-10 border border-slate-200 bg-sky-50 px-3 py-2 font-semibold text-sky-800"
                  >
                    {c}
                  </th>
                ))}
                <th className="sticky top-0 z-10 border border-slate-200 bg-sky-100 px-3 py-2 font-bold text-sky-900">
                  סך הכול
                </th>
              </tr>
            </thead>
            <tbody>
              {pivot.rowKeys.map((r) => (
                <tr key={r} className="hover:bg-sky-50">
                  <th className="sticky right-0 z-10 border border-slate-200 bg-white px-3 py-1.5 text-right font-medium text-slate-700">
                    {r}
                  </th>
                  {pivot.colKeys.map((c) => {
                    const v = cellValue(pivot, r, c)
                    return (
                      <td
                        key={c}
                        className={
                          'border border-slate-200 px-3 py-1.5 text-center ' +
                          (v === 0 ? 'text-slate-300' : 'text-slate-700')
                        }
                      >
                        {v === 0 ? '' : v.toLocaleString('he-IL')}
                      </td>
                    )
                  })}
                  <td className="border border-slate-200 bg-slate-50 px-3 py-1.5 text-center font-bold text-sky-800">
                    {(pivot.rowTotals.get(r) ?? 0).toLocaleString('he-IL')}
                  </td>
                </tr>
              ))}
              <tr>
                <th className="sticky right-0 z-10 border border-slate-200 bg-sky-100 px-3 py-2 text-right font-bold text-sky-900">
                  סך הכול
                </th>
                {pivot.colKeys.map((c) => (
                  <td
                    key={c}
                    className="border border-slate-200 bg-sky-50 px-3 py-2 text-center font-bold text-sky-800"
                  >
                    {(pivot.colTotals.get(c) ?? 0).toLocaleString('he-IL')}
                  </td>
                ))}
                <td className="border border-slate-200 bg-sky-100 px-3 py-2 text-center font-bold text-sky-900">
                  {pivot.total.toLocaleString('he-IL')}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
