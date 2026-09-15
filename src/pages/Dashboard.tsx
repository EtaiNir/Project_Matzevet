import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
  addStudentsToView,
  createViewFolder,
  deleteSavedView,
  deleteViewFolder,
  fetchSavedView,
  fetchSavedViews,
  fetchViewFolders,
  fetchViewMembers,
  moveViewFolder,
  moveViewToFolder,
  removeStudentFromView,
  renameViewFolder,
  type SavedView,
  type ViewFolder,
} from '@/lib/savedViews'
import type { PivotNavState } from '@/lib/pivot'
import FilterBar from '@/components/FilterBar'
import FieldPicker from '@/components/FieldPicker'
import StudentTable from '@/components/StudentTable'
import StudentCard from '@/components/StudentCard'
import ColumnFilterMenu from '@/components/ColumnFilterMenu'
import CellActionMenu from '@/components/CellActionMenu'
import ExtraColumnsManager from '@/components/ExtraColumnsManager'
import StudentsRail from '@/components/StudentsRail'
import RailTopBar from '@/components/RailTopBar'
import SaveToViewDialog from '@/components/SaveToViewDialog'

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
  const navigate = useNavigate()
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
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [viewFolders, setViewFolders] = useState<ViewFolder[]>([])

  const [saveToView, setSaveToView] = useState(false)
  /** הטבלה הייעודית שממתינה לאישור מחיקה מהסרגל */
  const [deletingView, setDeletingView] = useState<SavedView | null>(null)
  /** התיקייה שממתינה לאישור מחיקה. הטבלאות שבתוכה אינן נמחקות איתה. */
  const [deletingFolder, setDeletingFolder] = useState<ViewFolder | null>(null)
  /** מיזוג טבלה ייעודית לאחרת — מאישור ועד לתוצאה, באותו חלון */
  const [merging, setMerging] = useState<{
    source: SavedView
    target: SavedView
    busy?: boolean
    error?: string
    result?: { added: number; total: number }
  } | null>(null)
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

  const loadViews = useCallback(async () => {
    if (!authorityCode) return
    const [views, folders] = await Promise.all([
      fetchSavedViews(authorityCode),
      fetchViewFolders(authorityCode),
    ])
    setSavedViews(views)
    setViewFolders(folders)
  }, [authorityCode])

  /**
   * כל פעולות התיקיות עוברות דרך אותו מסלול: פעולה במסד, ואז טעינה
   * מחדש של הרשימה. אין עדכון אופטימי — טריגר במסד יכול לדחות מהלך
   * (מעגל, תיקייה של משתמש אחר), ומצב מקומי ש"הצליח" בזמן שהמסד סירב
   * הוא בדיוק סוג השקר שקשה לאתר אחר כך.
   */
  const folderAction = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        await loadViews()
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [loadViews],
  )

  useEffect(() => {
    loadViews()
  }, [loadViews])

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

  /**
   * כמה תלמידים בכל תצורה, לפי הסינון שנפתח איתה.
   *
   * מחושב על המערך שכבר בזיכרון — חמש תצורות על 8,000 שורות הן עבודה
   * זניחה, ובלי המספרים הסרגל הוא רשימת שמות בלבד.
   */
  const presetCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of PRESETS) {
      out[p.id] = applyFilters(allStudents, presetFilters(p).filter(isConditionReady)).length
    }
    return out
  }, [allStudents])

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

  /**
   * מחיקת טבלה ייעודית מהסרגל.
   *
   * אם מחקנו את זו שפתוחה כרגע חוזרים לטבלה הראשית — אחרת המסך היה
   * ממשיך להציג רשימה שכבר אינה קיימת.
   */
  /** מוחקת תיקייה. תיקיות המשנה נגררות; הטבלאות חוזרות לשורש. */
  async function confirmDeleteFolder(folder: ViewFolder) {
    setDeletingFolder(null)
    await folderAction(() => deleteViewFolder(folder.id))
  }

  async function confirmDeleteView(view: SavedView) {
    try {
      await deleteSavedView(view.id)
      setDeletingView(null)
      await loadViews()
      if (viewId === view.id) navigate(`/students/${authorityCode}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /**
   * מיזוג: כל התלמידים של המקור נוספים ליעד, ומי שכבר שם מדולג.
   *
   * **המקור אינו נמחק.** מחיקה אוטומטית הייתה גוררת איתה גם את העמודות
   * ששייכות רק לו (`on delete cascade` על `view_id`) — בלי סל גריעה.
   * מי שרוצה להיפטר ממנו מוחק בנפרד, עם האישור הרגיל.
   */
  async function confirmMerge() {
    if (!merging) return
    const { source, target } = merging
    setMerging({ ...merging, busy: true, error: undefined })
    try {
      const ids = [...(await fetchViewMembers(authorityCode, source.id))]
      const result = ids.length
        ? await addStudentsToView(target.id, ids)
        : { added: 0, total: target.member_count ?? 0 }
      setMerging({ source, target, result })
      await loadViews()
      // היעד פתוח כרגע — מרעננים רק את החברוּת, בלי לאפס תצוגה וסינון
      if (viewId === target.id) setViewMembers(await fetchViewMembers(authorityCode, target.id))
    } catch (e) {
      setMerging({ source, target, error: (e as Error).message })
    }
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
  /**
   * ההיקף שנשלח לפיבוט — בדיוק השורות שעל המסך, לפי ת"ז.
   *
   * נשלח רק כשבאמת צמצמנו משהו. בלי צמצום עדיף לא לשלוח 7,900 מזהים
   * דרך ה-state של הניווט, והפיבוט פותח ממילא בסינון ברירת המחדל שלו.
   */
  const pivotState = useMemo<PivotNavState | undefined>(() => {
    const narrowed = activeFilters.length > 0 || Boolean(viewMembers) || Boolean(siblingParentId)
    if (!narrowed) return undefined
    const label = activeView
      ? `טבלה ייעודית «${activeView.name}»`
      : siblingParentId
        ? `האחים של ת.ז. ${siblingParentId}`
        : `הסינון שבטבלה (${activeFilters.length} תנאים)`
    return {
      ids: results.map((r) => String(r['MISPAR_ZEHUT'] ?? '')).filter(Boolean),
      filters: activeFilters,
      fromLabel: label,
    }
  }, [results, activeFilters, viewMembers, siblingParentId, activeView])

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
    <div className="flex h-full flex-col overflow-hidden">
      <RailTopBar
        authorityCode={authorityCode}
        authorityName={authorityName}
        authorities={authorities}
        authorityLabel={(a) => {
          const name = allAuthorities.find((x) => x.code === a)?.name
          return name ? `${name} (${a})` : `רשות ${a}`
        }}
        onAuthorityChange={setAuthorityCode}
        shown={results.length}
        total={allStudents.length}
        filtered={activeFilters.length > 0 || Boolean(siblingParentId)}
        filterSlot={
          <FilterBar
            conditions={filters}
            onChange={setFilters}
            valuesFor={valuesForField}
            onReset={resetView}
            compact
          />
        }
        pivotState={pivotState}
        selectedFieldCount={selectedFields.length}
        onOpenPicker={() => setPickerOpen(true)}
        onExport={handleExport}
        exporting={exporting}
        onRefresh={refresh}
        refreshing={refreshing}
        canUpdateMoe={isSuperAdmin || profile?.role === 'admin'}
        isSuperAdmin={isSuperAdmin}
        identity={[profile?.display_name ?? profile?.email, ...identityParts]
          .filter(Boolean)
          .join(" · ")}
        onSignOut={signOut}
      />

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


      {/* הסרגל מימין; הטבלה משמאלו וגוללת בשני הצירים */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <StudentsRail
          authorityCode={authorityCode}
          presets={PRESETS}
          activePreset={activePreset}
          onPresetChange={(id) => {
            changePreset(id)
            // בחירת תצורה בזמן שטבלה ייעודית פתוחה — יוצאים ממנה,
            // אחרת התצורה מתחלפת אבל הרשימה ממשיכה לצמצם את השורות.
            if (viewId) navigate(`/students/${authorityCode}`)
          }}
          presetCounts={presetCounts}
          views={savedViews}
          activeViewId={viewId ?? null}
          onSaveToView={() => setSaveToView(true)}
          canSaveToView={!activeView && results.length > 0}
          folders={viewFolders}
          // מיגרציה 021: המשתמש רואה רק את מה שהוא עצמו יצר, ולכן אין
          // עוד מה לבדוק לפני מחיקה — הכול שלו
          onDeleteView={setDeletingView}
          onMergeView={(source, target) => setMerging({ source, target })}
          onCreateFolder={(name, parentId) =>
            folderAction(() => createViewFolder(authorityCode, name, parentId))
          }
          onRenameFolder={(id, name) => folderAction(() => renameViewFolder(id, name))}
          onDeleteFolder={setDeletingFolder}
          onMoveView={(viewId, folderId) => folderAction(() => moveViewToFolder(viewId, folderId))}
          onMoveFolder={(folderId, parentId) =>
            folderAction(() => moveViewFolder(folderId, parentId))
          }
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
        </div>
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

      {/* מחיקת תיקייה — האישור מסביר מה **לא** נמחק, כי זו השאלה */}
      {deletingFolder && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div dir="rtl" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="font-bold text-red-800">מחיקת התיקייה «{deletingFolder.name}»</h3>
            <p className="mt-2 text-sm text-slate-700">
              התיקיות שבתוכה יימחקו גם הן.{' '}
              <strong>הטבלאות הייעודיות אינן נמחקות</strong> — הן יחזרו לרשימה הראשית.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => confirmDeleteFolder(deletingFolder)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                מחיקה
              </button>
              <button
                onClick={() => setDeletingFolder(null)}
                className="text-sm text-slate-500 transition hover:text-slate-800"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* מיזוג טבלה ייעודית לאחרת — אישור, ואז התוצאה באותו חלון */}
      {merging && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div dir="rtl" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="font-bold text-sky-800">
              מיזוג «{merging.source.name}» לתוך «{merging.target.name}»
            </h3>
            {merging.result ? (
              <p className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <strong>{merging.result.added.toLocaleString('he-IL')}</strong> תלמידים נוספו
                ל«{merging.target.name}».
                <span className="mt-1 block">
                  סך הכול ברשימה: {merging.result.total.toLocaleString('he-IL')}
                </span>
              </p>
            ) : (
              <div className="mt-2 space-y-2 text-sm text-slate-700">
                <p>
                  {(merging.source.member_count ?? 0).toLocaleString('he-IL')} התלמידים של «
                  {merging.source.name}» יתווספו ל«{merging.target.name}». מי שכבר נמצא שם לא
                  ייכפל.
                </p>
                <p className="text-slate-500">
                  «{merging.source.name}» <strong>נשארת כמו שהיא</strong> — אפשר למחוק אותה אחר
                  כך. עמודות ששייכות רק לה אינן עוברות.
                </p>
                {merging.error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
                    המיזוג נכשל — {merging.error}
                  </p>
                )}
              </div>
            )}
            <div className="mt-4 flex items-center gap-3">
              {!merging.result && (
                <button
                  onClick={confirmMerge}
                  disabled={merging.busy}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
                >
                  {merging.busy ? 'ממזג…' : 'מיזוג'}
                </button>
              )}
              <button
                onClick={() => setMerging(null)}
                disabled={merging.busy}
                className="text-sm text-slate-500 transition hover:text-slate-800"
              >
                {merging.result ? 'סגירה' : 'ביטול'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* מחיקת טבלה ייעודית מהסרגל — אישור מפורש, כי אין ממנה חזרה */}
      {deletingView && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div dir="rtl" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="font-bold text-red-800">מחיקת «{deletingView.name}»</h3>
            <p className="mt-2 text-sm text-slate-700">
              הרשימה תימחק על {(deletingView.member_count ?? 0).toLocaleString('he-IL')} התלמידים
              שבה. <strong>נתוני התלמידים עצמם אינם נמחקים</strong> — רק הרשימה.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => confirmDeleteView(deletingView)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                מחיקה
              </button>
              <button
                onClick={() => setDeletingView(null)}
                className="text-sm text-slate-500 transition hover:text-slate-800"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
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
