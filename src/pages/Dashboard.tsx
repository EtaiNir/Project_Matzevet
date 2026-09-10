import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import {
  fetchAllStudents,
  clearStudentsCache,
  type StudentRow,
} from '@/lib/students'
import { withComputedFields } from '@/lib/computed'
import {
  extraFieldKey,
  extraIdFromKey,
  fetchExtraColumns,
  fetchExtraValues,
  setExtraValue,
  toFieldDefs,
  withExtraValues,
  type ExtraColumn,
  type ExtraValues,
} from '@/lib/extraColumns'
import { applyFilters, isConditionReady, type FilterCondition } from '@/lib/filters'
import { columnValues } from '@/lib/columnValues'
import { sortRows, type SortState } from '@/lib/table'
import { exportToExcel } from '@/lib/exportExcel'
import {
  PRESETS,
  DEFAULT_PRESET,
  ACTIVE_STATUS_FIELD,
  ACTIVE_STATUS_VALUE,
  type Preset,
} from '@/config/presets'
import {
  PARENT_ID_FIELDS,
  fieldLabel,
  registerExtraFields,
  clearExtraFields,
} from '@/config/fields'
import { fetchAuthorities, ROLE_LABELS, type Authority } from '@/lib/admin'
import {
  fetchSavedView,
  fetchViewMembers,
  removeStudentFromView,
  type SavedView,
} from '@/lib/savedViews'
import FilterBar from '@/components/FilterBar'
import FieldPicker from '@/components/FieldPicker'
import StudentTable from '@/components/StudentTable'
import StudentCard from '@/components/StudentCard'
import ColumnFilterMenu from '@/components/ColumnFilterMenu'
import CellActionMenu from '@/components/CellActionMenu'
import ExtraColumnsManager from '@/components/ExtraColumnsManager'
import SaveToViewDialog from '@/components/SaveToViewDialog'
import Logo from '@/components/brand/Logo'

/** קו מפריד בין פריטי הסרגל העליון */
function Sep() {
  return (
    <span className="select-none text-slate-300" aria-hidden>
      |
    </span>
  )
}

function newId() {
  return Math.random().toString(36).slice(2, 9)
}

/**
 * הסינון שנפתח עם התצורה: מצב רישום "משובץ" לכולן, ועוד סינון ייעודי
 * לתצורות שרלוונטיות רק לחלק מהאוכלוסייה (חינוך מיוחד, מגמות).
 *
 * הכל מוצג בסרגל הסינון וניתן להסרה בלחיצה — "הכל ואז מצמצמים" נשמר.
 */
function presetFilters(preset: Preset): FilterCondition[] {
  const base: FilterCondition = {
    id: 'default-active-status',
    field: ACTIVE_STATUS_FIELD,
    operator: 'equals',
    value: ACTIVE_STATUS_VALUE,
  }
  const extra = (preset.defaultFilters ?? []).map((f, i) => ({
    id: `preset-${preset.id}-${i}`,
    ...f,
  }))
  return [base, ...extra]
}

export default function Dashboard() {
  const { profile, signOut } = useAuth()
  // קוד הרשות מגיע מהנתיב (/students/:code) כשמגיעים ממסך המנהל
  // viewId קיים רק במסלול /views/:code/:viewId — מצב "טבלה ייעודית"
  const { code: codeFromUrl, viewId } = useParams()
  const isSuperAdmin = profile?.role === 'super_admin'

  // הרשויות הזמינות: מנהל־על רואה את כולן, משתמש רגיל רק את שלו
  const [allAuthorities, setAllAuthorities] = useState<Authority[]>([])
  const authorities = useMemo(
    () =>
      isSuperAdmin
        ? allAuthorities.map((a) => a.code)
        : (profile?.authority_codes ?? []),
    [isSuperAdmin, allAuthorities, profile?.authority_codes],
  )

  const [authorityCode, setAuthorityCode] = useState<string>(codeFromUrl ?? '')

  // נטען לכל משתמש (ולא רק למנהל־על): שם הרשות לתצוגה, וקוד משרד החינוך
  // שנדרש לחישוב "סטטוס תלמיד ברשות".
  useEffect(() => {
    fetchAuthorities().then(setAllAuthorities).catch(() => setAllAuthorities([]))
  }, [])

  // הפרופיל נטען אסינכרונית — נקבע את הרשות ברגע שהוא מגיע
  useEffect(() => {
    if (!authorityCode && authorities.length > 0) setAuthorityCode(authorities[0])
  }, [authorities, authorityCode])

  const authority = allAuthorities.find((a) => a.code === authorityCode)
  const authorityName = authority?.name ?? ''
  /** קוד הרשות במשרד החינוך — לא בהכרח הקוד שלנו (כפר = 120 / 5108) */
  const moeCode = authority?.moe_code ?? authorityCode

  const [rawStudents, setRawStudents] = useState<StudentRow[]>([])
  // העמודות שהמשתמש הוסיף, והערכים שמולאו בהן. שתי בקשות נפרדות
  // שמתחברות בזיכרון לפי תעודת זהות — ראה lib/extraColumns.ts
  const [extraColumns, setExtraColumns] = useState<ExtraColumn[]>([])
  const [extraValues, setExtraValues] = useState<ExtraValues>(() => new Map())
  // null = סגור. adding = להיפתח ישר על טופס ההוספה (כפתור ה-+ שבכותרת)
  const [manager, setManager] = useState<{ adding: boolean } | null>(null)
  const [saveToView, setSaveToView] = useState(false)
  // מצב טבלה ייעודית: הרשימה עצמה, והת"ז שבה
  const [activeView, setActiveView] = useState<SavedView | null>(null)
  const [viewMembers, setViewMembers] = useState<Set<string> | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET.id)
  const [selectedFields, setSelectedFields] = useState<string[]>(DEFAULT_PRESET.defaultFields)
  const [filters, setFilters] = useState<FilterCondition[]>(() => presetFilters(DEFAULT_PRESET))
  const [sort, setSort] = useState<SortState | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cardIndex, setCardIndex] = useState<number | null>(null)
  const [siblingParentId, setSiblingParentId] = useState<string | null>(null)
  const [columnMenu, setColumnMenu] = useState<{ field: string; anchor: DOMRect } | null>(null)
  const [cellMenu, setCellMenu] = useState<
    { index: number; field: string; anchor: DOMRect } | null
  >(null)


  // טעינת כל תלמידי הרשות (אפיון: "הכל ואז מצמצמים").
  // הטעינה עוברת דרך מטמון — חזרה למסך אינה טוענת הכל מחדש.
  useEffect(() => {
    if (!authorityCode) return
    setLoading(true)
    setError(null)
    fetchAllStudents(authorityCode)
      .then(setRawStudents)
      .catch((e) => setError(e.message ?? 'שגיאה בטעינת הנתונים'))
      .finally(() => setLoading(false))
  }, [authorityCode])

  /**
   * טוען את הקטלוג ואת הערכים, ורושם את העמודות כשדות.
   * מרגע הרישום הן שדות רגילים לכל דבר — סינון, מיון, ייצוא ופיבוט.
   */
  const loadExtra = useCallback(async () => {
    if (!authorityCode) {
      clearExtraFields()
      return
    }
    const [cols, vals] = await Promise.all([
      // בטבלה ראשית — רק עמודות הרשות. בטבלה ייעודית — גם אלה ששייכות לה.
      fetchExtraColumns(authorityCode, viewId ?? null),
      fetchExtraValues(authorityCode),
    ])
    registerExtraFields(toFieldDefs(cols))
    setExtraColumns(cols)
    setExtraValues(vals)
  }, [authorityCode, viewId])

  /**
   * מצב טבלה ייעודית: טוען את הרשימה ואת החברוּת, ופותח בתמהיל השדות
   * שנשמר איתה. הסינון של התצורה מנוקה — ברשימה רוצים לראות את כולם.
   */
  const loadView = useCallback(async () => {
    if (!viewId || !authorityCode) {
      setActiveView(null)
      setViewMembers(null)
      return
    }
    const [view, members] = await Promise.all([
      fetchSavedView(viewId),
      fetchViewMembers(authorityCode, viewId),
    ])
    setActiveView(view)
    setViewMembers(members)
    if (view?.fields?.length) setSelectedFields(view.fields)
    setFilters([])
  }, [viewId, authorityCode])

  useEffect(() => {
    loadView()
  }, [loadView])

  useEffect(() => {
    loadExtra()
    // ברשות אחרת יש עמודות אחרות — הרישום הישן חייב להתנקות
    return () => clearExtraFields()
  }, [loadExtra])

  async function refresh() {
    if (!authorityCode) return
    setRefreshing(true)
    setError(null)
    clearStudentsCache(authorityCode)
    try {
      setRawStudents(await fetchAllStudents(authorityCode, { force: true }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  // השדות המחושבים נגזרים בתצוגה ולא ב-pipeline — ראה lib/computed.ts
  const allStudents = useMemo(
    () => withExtraValues(withComputedFields(rawStudents, moeCode), extraValues),
    [rawStudents, moeCode, extraValues],
  )

  /** כמה תלמידים מחזיקים ערך בכל עמודה — מהנתונים שכבר בזיכרון,
   *  במקום קריאה נפרדת למסד לכל עמודה. */
  const extraUsage = useMemo(() => {
    const out: Record<string, number> = {}
    for (const values of extraValues.values()) {
      for (const [id, value] of Object.entries(values)) {
        if (value !== null && value !== undefined && value !== false && value !== '') {
          out[id] = (out[id] ?? 0) + 1
        }
      }
    }
    return out
  }, [extraValues])

  /** יצירה ומחיקה של עמודות — מנהל רשות ומעלה, כמו העלאת מצב"ת */
  const canManageColumns =
    isSuperAdmin ||
    (profile?.role === 'admin' && (profile.authority_codes ?? []).includes(authorityCode))

  const extraKeys = useMemo(
    () => extraColumns.map((c) => extraFieldKey(c.id)),
    [extraColumns],
  )

  /**
   * "מוסתרות" נגזר מהמצב ולא מדגל נפרד: יש עמודות תוספתיות, ואף אחת
   * מהן אינה בתמהיל הנוכחי. כך אין שני מקורות אמת שיכולים להתנתק —
   * גם הסתרה ידנית של העמודה האחרונה מצית את הכפתור.
   */
  const extraHidden =
    extraColumns.length > 0 && !selectedFields.some((k) => extraKeys.includes(k))

  function toggleExtraColumns() {
    setSelectedFields((prev) =>
      extraHidden
        ? [...prev, ...extraKeys.filter((k) => !prev.includes(k))]
        : prev.filter((k) => !extraKeys.includes(k)),
    )
  }

  /** הסרת תלמיד מהטבלה הייעודית הפתוחה. נתוניו אינם נמחקים. */
  async function removeFromView(misparZehut: string) {
    if (!activeView || !authorityCode) return
    try {
      await removeStudentFromView(authorityCode, activeView.id, misparZehut)
      setViewMembers((prev) => {
        if (!prev) return prev
        const next = new Set(prev)
        next.delete(misparZehut)
        return next
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** הסרה מהתצוגה בלבד — שום נתון אינו נמחק, והעמודה חוזרת מבורר השדות */
  function hideColumn(field: string) {
    setSelectedFields((prev) => (prev.length > 1 ? prev.filter((k) => k !== field) : prev))
  }

  /** מילוי ערכים — מדרגה נמוכה יותר: גם צופה, אם הוגדר לו can_edit_extra.
   *  משקף בדיוק את may_edit_extra() במסד; שם זה נאכף, כאן רק מוצג. */
  const canEditExtra =
    isSuperAdmin ||
    ((profile?.authority_codes ?? []).includes(authorityCode) &&
      (profile?.role === 'admin' || Boolean(profile?.can_edit_extra)))

  /**
   * שינוי ערך בעמודה תוספתית.
   *
   * המצב המקומי מתעדכן מיד ורק אחר כך נשלחת הבקשה — סימון צ'קבוקס
   * חייב להרגיש מיידי. אם הכתיבה נכשלה (למשל RLS), טוענים מחדש כדי
   * שהמסך לא יישאר עם ערך שלא נשמר.
   */
  async function handleExtraChange(
    index: number,
    field: string,
    value: string | boolean | null,
  ) {
    const columnId = extraIdFromKey(field)
    const zehut = String(results[index]?.['MISPAR_ZEHUT'] ?? '')
    if (!columnId || !zehut) return

    setExtraValues((prev) => {
      const next = new Map(prev)
      const row = { ...(next.get(zehut) ?? {}) }
      if (value === null || value === false || value === '') delete row[columnId]
      else row[columnId] = value
      next.set(zehut, row)
      return next
    })

    try {
      await setExtraValue(authorityCode, zehut, columnId, value)
    } catch (e) {
      setError(`שמירת «${fieldLabel(field)}» נכשלה — ${(e as Error).message}`)
      await loadExtra()
    }
  }


  // סינון + מיון — קובע גם את הייצוא וגם את ניווט הכרטיס
  const activeFilters = useMemo(() => filters.filter(isConditionReady), [filters])

  /** השורות אחרי סינון האחים בלבד — הבסיס לחישוב ערכי העמודות */
  const scopedRows = useMemo(() => {
    let rows = allStudents
    // טבלה ייעודית — רק מי שברשימה, לפי ת"ז
    if (viewMembers) {
      rows = rows.filter((r) => viewMembers.has(String(r['MISPAR_ZEHUT'] ?? '')))
    }
    if (siblingParentId) {
      rows = rows.filter((r) =>
        PARENT_ID_FIELDS.some((f) => String(r[f] ?? '') === siblingParentId),
      )
    }
    return rows
  }, [allStudents, siblingParentId, viewMembers])

  const results = useMemo(
    () => sortRows(applyFilters(scopedRows, activeFilters), sort),
    [scopedRows, activeFilters, sort],
  )

  /**
   * הערכים שיוצגו בתפריט הסינון של עמודה.
   *
   * מחושבים אחרי שאר הסינונים ולפני הסינון של העמודה עצמה — כך שהרשימה
   * מצטמצמת יחד עם שאר התנאים (כמו באקסל), אבל ביטול סימון בעמודה עצמה
   * אינו מעלים את שאר הערכים שלה.
   */
  function valuesForField(field: string) {
    const others = activeFilters.filter((c) => c.field !== field)
    return columnValues(applyFilters(scopedRows, others), field)
  }

  const menuValues = useMemo(
    () => (columnMenu ? valuesForField(columnMenu.field) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnMenu?.field, scopedRows, activeFilters],
  )

  /**
   * העמודות שיש עליהן סינון פעיל — לסימון המשפך בכותרת.
   * כל סוגי הסינון נספרים, לא רק בחירה מרובה.
   */
  const filteredFields = useMemo(
    () => new Set(activeFilters.map((c) => c.field)),
    [activeFilters],
  )

  function columnSelection(field: string): string[] | null {
    const cond = filters.find((c) => c.field === field && c.operator === 'one_of')
    return cond?.values ?? null
  }

  /** null = ביטול הסינון על העמודה */
  function setColumnSelection(field: string, values: string[] | null) {
    setFilters((prev) => {
      const rest = prev.filter((c) => !(c.field === field && c.operator === 'one_of'))
      if (values === null) return rest
      return [...rest, { id: newId(), field, operator: 'one_of', values }]
    })
  }

  /**
   * כל השדות שנבחרו מוצגים יחד, והטבלה נגללת אופקית כשהם חורגים מהמסך.
   *
   * קודם הם חולקו לדפים ברוחב המסך (אפיון §6.2) עם חצי ניווט. הדפדוף
   * הוסר: הוא מנע כל חריגה, ולכן סרגל הגלילה האופקי מעולם לא הופיע —
   * וגלילה היא מה שמשתמש מצפה לו בטבלה.
   */
  const currentFields = selectedFields

  function changePreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET
    setActivePreset(id)
    setSelectedFields(preset.defaultFields)
    setFilters(presetFilters(preset))
    setSort(null)
    setSiblingParentId(null)
  }

  /**
   * חזרה לנקודת האפס של התצורה: הסינון שלה, בלי מיון ובלי זיהוי אחים.
   * תמהיל השדות נשאר — לו יש איפוס נפרד בתוך בורר השדות.
   */
  function resetView() {
    const preset = PRESETS.find((p) => p.id === activePreset) ?? DEFAULT_PRESET
    setFilters(presetFilters(preset))
    setSort(null)
    setSiblingParentId(null)
  }

  /** חזרה לתמהיל השדות של התצורה, בלי לגעת בסינון */
  function resetFields() {
    const preset = PRESETS.find((p) => p.id === activePreset) ?? DEFAULT_PRESET
    setSelectedFields(preset.defaultFields)
  }

  function toggleField(key: string) {
    setSelectedFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  function handleSort(field: string) {
    setSort((prev) =>
      prev?.field === field
        ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'asc' },
    )
  }

  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    const preset = PRESETS.find((p) => p.id === activePreset)
    const stamp = new Date().toISOString().slice(0, 10)
    setExporting(true)
    try {
      await exportToExcel(
        results,
        selectedFields,
        `${authorityName || authorityCode}_${preset?.name ?? 'תלמידים'}_${stamp}`,
        { sheetName: preset?.name ?? 'תלמידים' },
      )
    } catch (e) {
      setError(`הייצוא נכשל: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  // זיהוי אחים — סינון על ת.ז. ההורה (אפיון §5, תצורה 2).
  function findSiblings(parentId: string) {
    setCardIndex(null)
    setSiblingParentId(parentId)
    setFilters([])
  }

  const roleLabel = profile?.role ? ROLE_LABELS[profile.role] : ''
  /** תפקיד, מוסד וסוג הרשאה — כל אחד פריט נפרד בסרגל העליון */
  const identityParts = [
    profile?.job_title,
    profile?.institution_name,
    roleLabel,
  ].filter(Boolean) as string[]

  return (
    <div className="flex h-full flex-col">
      {/* פס עליון */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Logo className="h-8 w-8 shrink-0" />
          <h1 className="text-lg font-bold text-sky-800">ניהול נתוני תלמידים</h1>
          {authorities.length > 1 ? (
            <select
              value={authorityCode}
              onChange={(e) => setAuthorityCode(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              {authorities.map((a) => {
                const name = allAuthorities.find((x) => x.code === a)?.name
                return (
                  <option key={a} value={a}>
                    {name ? `${name} (${a})` : `רשות ${a}`}
                  </option>
                )
              })}
            </select>
          ) : (
            <span className="rounded-lg bg-sky-50 px-2 py-1 text-sm font-medium text-sky-800">
              {authorityName ? `${authorityName} (${authorityCode})` : `רשות ${authorityCode || '—'}`}
            </span>
          )}
        </div>

        {/*
          זהות המשתמש — שם, תפקיד, מוסד וסוג הרשאה (הערות 1 ו-4).
          הכל בשורה אחת, מופרד בקווים אנכיים.
        */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {isSuperAdmin && (
            <>
              <Link
                to={authorityCode ? `/admin/client/${authorityCode}` : '/admin'}
                className="rounded-lg px-2 py-1 text-slate-500 transition hover:bg-sky-50 hover:text-sky-700"
                title="חזרה לכרטיס המועצה, בלי לצאת מהמערכת"
              >
                חזרה לניהול
              </Link>
              <Sep />
            </>
          )}

          <span className="font-medium text-slate-700">
            {profile?.display_name ?? profile?.email}
          </span>

          {identityParts.map((part, i) => (
            <Fragment key={i}>
              <Sep />
              <span className="text-slate-400">{part}</span>
            </Fragment>
          ))}

          <Sep />
          <button
            onClick={signOut}
            className="rounded-lg px-2 py-1 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
          >
            יציאה
          </button>
        </div>
      </header>

      {/* טאבים של תצורות */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-white px-4 pt-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => changePreset(p.id)}
            title={p.description}
            className={
              'rounded-t-lg px-4 py-2 text-sm font-medium transition ' +
              (activePreset === p.id
                ? 'border-b-2 border-sky-600 bg-sky-600 text-white shadow-sm'
                : 'border-b-2 border-transparent text-slate-600 hover:bg-sky-50 hover:text-sky-700')
            }
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* סרגל כלים */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPickerOpen(true)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
          >
            ⚙ בורר שדות ({selectedFields.length})
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 hover:shadow disabled:opacity-60"
          >
            {exporting ? '⬇ מייצא…' : '⬇ ייצוא לאקסל'}
          </button>
          {/* הסינון הנוכחי נוסע עם הניווט — סבא: "אחרי שהגדרת טבלה
              שסיננת וצמצמת, ייצוא לדף הפיבוט" */}
          <span className="group relative">
            <Link
              to={`/pivot/${authorityCode}`}
              state={{ filters: activeFilters }}
              className="block rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
            >
              ▦ פיבוטים
            </Link>
            {/* הסבר בריחוף — הפיבוט כבד ככל שהטבלה גדולה */}
            <span className="pointer-events-none absolute right-0 top-full z-40 mt-1 w-64 rounded-lg bg-slate-800 px-3 py-2 text-xs leading-relaxed text-white opacity-0 shadow-lg transition group-hover:opacity-100">
              דוחות סיכום — כמה תלמידים בכל מוסד, שכבה ויישוב.
              <span className="mt-1 block text-amber-200">
                מומלץ לסנן ולצמצם את הטבלה לפני השימוש בפיבוט.
              </span>
            </span>
          </span>
          {!activeView && (
            <button
              onClick={() => setSaveToView(true)}
              disabled={results.length === 0}
              title="לקחת את מי שסונן ולשמור אותו כרשימה קבועה"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-40"
            >
              ▦ טבלה ייעודית
            </button>
          )}
          <Link
            to={`/views/${authorityCode}`}
            className="rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-sky-50 hover:text-sky-700"
          >
            הטבלאות הייעודיות
          </Link>

          {/* מנהל רשות יכול לעדכן את הנתונים בעצמו, מתי שהוא רוצה */}
          {(isSuperAdmin || profile?.role === 'admin') && authorityCode && (
            <Link
              to={`/upload/${authorityCode}`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
              title="העלאת ששת קבצי המצב״ת ועדכון הנתונים"
            >
              ⬆ עדכון מצב״ת
            </Link>
          )}
          <button
            onClick={refresh}
            disabled={refreshing || loading}
            title="טעינה מחדש מהמסד — אחרי עדכון מצב״ת"
            className="rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-sky-50 hover:text-sky-700 disabled:opacity-40"
          >
            {refreshing ? '⟳ מרענן…' : '⟳ רענון'}
          </button>
        </div>

        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>
            <strong className="text-sky-700">{results.length.toLocaleString('he-IL')}</strong> תלמידים
            {(activeFilters.length > 0 || siblingParentId) &&
              ` (מתוך ${allStudents.length.toLocaleString('he-IL')})`}
          </span>

        </div>
      </div>

      {activeView && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
          <span>
            <strong>טבלה ייעודית: {activeView.name}</strong> ·{' '}
            {(viewMembers?.size ?? 0).toLocaleString('he-IL')} תלמידים ברשימה
            <span className="mr-2 text-sky-700">
              הרשימה קבועה — תלמידים חדשים אינם מצטרפים אליה מעצמם
            </span>
          </span>
          <Link
            to={`/views/${authorityCode}`}
            className="rounded border border-sky-300 bg-white px-2 py-0.5 hover:bg-sky-100"
          >
            כל הטבלאות
          </Link>
        </div>
      )}

      {/* באנר זיהוי אחים */}
      {siblingParentId && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>מציג אחים — כל התלמידים שההורה ת.ז. {siblingParentId} משויך אליהם</span>
          <button
            onClick={() => setSiblingParentId(null)}
            className="rounded border border-amber-300 px-2 py-0.5 hover:bg-amber-100"
          >
            ביטול
          </button>
        </div>
      )}

      {/* סינון */}
      <FilterBar
        conditions={filters}
        onChange={setFilters}
        valuesFor={valuesForField}
        onReset={resetView}
      />

      {/* הטבלה */}
      <div className="min-h-0 flex-1 bg-white">
        {loading ? (
          <div className="p-8 text-center text-slate-400">טוען תלמידים…</div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">שגיאה: {error}</div>
        ) : (
          <StudentTable
            rows={results}
            fields={currentFields}
            sort={sort}
            onSort={handleSort}
            onRowClick={setCardIndex}
            onCellClick={(index, field, anchor) => setCellMenu({ index, field, anchor })}
            filteredFields={filteredFields}
            onOpenFilter={(field, anchor) => setColumnMenu({ field, anchor })}
            canEditExtra={canEditExtra}
            onExtraChange={handleExtraChange}
            onAddColumn={canManageColumns ? () => setManager({ adding: true }) : undefined}
            onToggleExtra={toggleExtraColumns}
            extraHidden={extraHidden}
            hasExtraColumns={extraColumns.length > 0}
          />
        )}
      </div>

      {cellMenu && results[cellMenu.index] && (
        <CellActionMenu
          studentName={`${results[cellMenu.index]['SHEM_PRATI'] ?? ''} ${
            results[cellMenu.index]['SHEM_MISHPACHA'] ?? ''
          }`.trim()}
          columnLabel={fieldLabel(cellMenu.field)}
          cellValue={String(results[cellMenu.index][cellMenu.field] ?? '')}
          anchor={cellMenu.anchor}
          onOpenCard={() => {
            setCardIndex(cellMenu.index)
            setCellMenu(null)
          }}
          onOpenFilter={() => {
            // תפריט הסינון נפתח באותה נקודה שבה נלחץ התא
            setColumnMenu({ field: cellMenu.field, anchor: cellMenu.anchor })
            setCellMenu(null)
          }}
          onRemoveFromView={
            activeView
              ? () => {
                  removeFromView(String(results[cellMenu.index]?.['MISPAR_ZEHUT'] ?? ''))
                  setCellMenu(null)
                }
              : undefined
          }
          onHideColumn={() => {
            hideColumn(cellMenu.field)
            setCellMenu(null)
          }}
          onClose={() => setCellMenu(null)}
        />
      )}

      {columnMenu && (
        <ColumnFilterMenu
          title={fieldLabel(columnMenu.field)}
          values={menuValues}
          selected={columnSelection(columnMenu.field)}
          onChange={(values) => setColumnSelection(columnMenu.field, values)}
          onSort={(direction) => setSort({ field: columnMenu.field, direction })}
          anchor={columnMenu.anchor}
          onClose={() => setColumnMenu(null)}
        />
      )}

      {saveToView && (
        <SaveToViewDialog
          code={authorityCode}
          ids={results.map((r) => String(r['MISPAR_ZEHUT'] ?? '')).filter(Boolean)}
          filters={activeFilters}
          fields={selectedFields}
          basePreset={activePreset}
          onClose={() => setSaveToView(false)}
        />
      )}

      {manager && (
        <ExtraColumnsManager
          code={authorityCode}
          authorityName={authorityName}
          columns={extraColumns}
          usage={extraUsage}
          canManage={canManageColumns}
          onChanged={loadExtra}
          viewId={viewId ?? null}
          viewName={activeView?.name}
          onCreated={(key) =>
            setSelectedFields((prev) => (prev.includes(key) ? prev : [...prev, key]))
          }
          startAdding={manager.adding}
          onClose={() => setManager(null)}
        />
      )}

      {pickerOpen && (
        <FieldPicker
          selected={selectedFields}
          onToggle={toggleField}
          onSetSelected={setSelectedFields}
          onReset={resetFields}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {cardIndex !== null && results[cardIndex] && (
        <StudentCard
          rows={results}
          index={cardIndex}
          onNavigate={setCardIndex}
          onClose={() => setCardIndex(null)}
          onFindSiblings={findSiblings}
        />
      )}
    </div>
  )
}
