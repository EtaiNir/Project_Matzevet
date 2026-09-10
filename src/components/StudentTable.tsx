import { useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { fieldLabel, getField } from '@/config/fields'
import { isChecked } from '@/lib/filters'
import { IconFilter, IconPin } from '@/components/brand/Icons'
import type { SortState } from '@/lib/table'

type Row = Record<string, unknown>

interface Props {
  rows: Row[]
  /** שדות הדף הנוכחי בלבד (אחרי דפדוף אופקי) */
  fields: string[]
  sort: SortState | null
  onSort: (field: string) => void
  /** לחיצה על מספר השורה — פותחת ישירות את הכרטיס */
  onRowClick: (index: number) => void
  /** לחיצה ימנית על תא — פותחת תפריט בחירה (כרטיס / סינון) בנקודת הלחיצה */
  onCellClick?: (index: number, field: string, anchor: DOMRect) => void
  /**
   * עמודות שיש עליהן סינון פעיל.
   *
   * סבא ביקש (19.8): "איך אני יכול לדעת על איזה שדה מופעל סינון כרגע,
   * ויזואלית? — חץ עם המשפך שמופעל על השדה, כמו באקסס או באקסל".
   */
  filteredFields?: Set<string>
  /**
   * פתיחת תפריט הסינון מכותרת העמודה — הדרך השנייה לסנן, לצד הלחיצה
   * הימנית על תא. סבא: "יש כאלה שאוהבים את זה".
   *
   * האייקון הוא **משפך** ולא חץ, בכוונה: הגרסה הקודמת השתמשה ב-▼,
   * הוא נראה זהה לחץ המיון שלידו, ואי אפשר היה לדעת מה כל אחד עושה.
   */
  onOpenFilter?: (field: string, anchor: DOMRect) => void
  /** האם המשתמש רשאי לערוך ערכים בעמודות שהוא הוסיף */
  canEditExtra?: boolean
  /** שינוי ערך בעמודה תוספתית. null מוחק את הערך. */
  onExtraChange?: (index: number, field: string, value: string | boolean | null) => void
  /** הוספת עמודה — הכפתור יושב בקצה שורת הכותרת, אחרי העמודה האחרונה */
  onAddColumn?: () => void
  /** הסתרה/הצגה של כל העמודות שהמשתמש הוסיף */
  onToggleExtra?: () => void
  /** האם כל העמודות התוספתיות מוסתרות כרגע */
  extraHidden?: boolean
  /** האם יש בכלל עמודות תוספתיות ברשות */
  hasExtraColumns?: boolean
}

// גובה קבוע לשורה ולכותרת — מקום לשתי שורות טקסט, כדי שערך ארוך
// ייגלש במקום להיחתך, ושורה קצרה תישב במרכז ולא תיראה כתיבה ריקה
const ROW_HEIGHT = 42
const HEADER_HEIGHT = 46
const DEFAULT_COL_WIDTH = 96 // צר יותר מבעבר כדי שייכנסו יותר עמודות במסך
const MIN_COL_WIDTH = 56
const INDEX_WIDTH = 52 // מספר השורה + סיכת הקיבוע
// שוליים בקצה שורת הכותרת לכפתורי העמודות התוספתיות
const GUTTER_WIDTH = 72
/** השדה שמזהה שורה לאורך מיון וסינון — לא האינדקס, שמשתנה בכל מיון */
const ROW_ID = 'MISPAR_ZEHUT'

const rowId = (row: Row | undefined) => String(row?.[ROW_ID] ?? '')

/**
 * הטבלה הראשית — שורות מווירטואלות (~50k), רוחב עמודות ניתן לשינוי בגרירה (אפיון §6.1).
 * מבנה flex אחיד לכותרת ולשורות לשמירת יישור.
 *
 * ## קיבוע
 *
 * עמודה מקובעת נדבקת לקצה הימני ליד עמודת המספור, ושורה מקובעת עולה
 * לגוש קבוע מתחת לכותרת. שתיהן פותרות את אותה בעיה: כשגוללים ימינה
 * ברוחב של 150 שדות אי אפשר לדעת של מי השורה, וכשגוללים 7,900 שורות
 * למטה אי אפשר להשוות תלמיד לתלמיד.
 *
 * שורה מקובעת מזוהה לפי תעודת זהות ולא לפי מיקומה: מיון מחדש היה
 * מקבע שורה אחרת לגמרי. היא **יוצאת** מהרשימה המווירטואלית כדי שלא
 * תופיע פעמיים, אבל שומרת על מספרה המקורי — המספור מתאר את מקומה
 * בטבלה, לא את סדר ההצגה.
 *
 * הקיבוע חי בזיכרון הרכיב בלבד ואינו נשמר בין רענונים: הוא נכון לשאלה
 * שנשאלת עכשיו, לא להעדפה קבועה.
 */
export default function StudentTable({
  rows,
  fields,
  sort,
  onSort,
  onRowClick,
  onCellClick,
  filteredFields,
  onOpenFilter,
  canEditExtra = false,
  onExtraChange,
  onAddColumn,
  onToggleExtra,
  extraHidden = false,
  hasExtraColumns = false,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  // רוחב לכל עמודה לפי מפתח השדה (נשמר גם במעבר בין תצורות/דפים)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const widthOf = (key: string) => colWidths[key] ?? DEFAULT_COL_WIDTH

  const [pinnedCols, setPinnedCols] = useState<Set<string>>(() => new Set())
  const [pinnedRows, setPinnedRows] = useState<Set<string>>(() => new Set())

  function togglePinCol(key: string) {
    setPinnedCols((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }
  function togglePinRow(id: string) {
    setPinnedRows((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  // סדר התצוגה: המקובעות ראשונות, בסדר שבו הן מופיעות בתצורה
  const pinnedFields = fields.filter((f) => pinnedCols.has(f))
  const bodyFields = fields.filter((f) => !pinnedCols.has(f))
  const orderedFields = [...pinnedFields, ...bodyFields]
  const lastPinnedField = pinnedFields[pinnedFields.length - 1]

  /** ההיסט מהקצה הימני לכל עמודה מקובעת — הן נערמות אחרי עמודת המספור */
  const pinOffset: Record<string, number> = {}
  {
    let acc = INDEX_WIDTH
    for (const f of pinnedFields) {
      pinOffset[f] = acc
      acc += widthOf(f)
    }
  }

  // חלוקת השורות: מה עולה לגוש הקבוע ומה נשאר לווירטואליזציה
  const { pinnedIndices, bodyIndices } = useMemo(() => {
    if (pinnedRows.size === 0) {
      return { pinnedIndices: [] as number[], bodyIndices: rows.map((_, i) => i) }
    }
    const pinned: number[] = []
    const body: number[] = []
    rows.forEach((row, i) => {
      if (pinnedRows.has(rowId(row))) pinned.push(i)
      else body.push(i)
    })
    return { pinnedIndices: pinned, bodyIndices: body }
  }, [rows, pinnedRows])

  const virtualizer = useVirtualizer({
    count: bodyIndices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  // גרירת ידית לשינוי רוחב עמודה
  function startResize(e: ReactMouseEvent, key: string) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthOf(key)
    function onMove(ev: MouseEvent) {
      // הידית בקצה השמאלי של העמודה (RTL): גרירה שמאלה מרחיבה
      const newW = Math.max(MIN_COL_WIDTH, startW - (ev.clientX - startX))
      setColWidths((w) => ({ ...w, [key]: newW }))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const gutter = Boolean(onAddColumn || (onToggleExtra && hasExtraColumns))
  const totalWidth =
    INDEX_WIDTH +
    fields.reduce((s, k) => s + widthOf(k), 0) +
    (gutter ? GUTTER_WIDTH : 0)

  const pinBtn = 'flex w-4 shrink-0 items-center justify-center rounded transition'

  /**
   * שורת נתונים אחת. אותה פונקציה משרתת את הגוף המווירטואל ואת הגוש
   * המקובע — `index` הוא תמיד המיקום ב-`rows`, כדי שכל הקריאות החוצה
   * (כרטיס, עריכת ערך, תפריט התא) ימשיכו להצביע על התלמיד הנכון.
   */
  function renderRow(index: number, pinnedRow: boolean, top = 0) {
    const row = rows[index]
    const id = rowId(row)
    // רקע אטום, לא שקוף: תאים מקובעים נדבקים מעל התוכן שנגלל מתחתם
    const stripe = pinnedRow ? 'bg-white' : index % 2 ? 'bg-slate-50' : 'bg-white'
    const stickyBg = stripe + ' group-hover:bg-sky-50'

    return (
      <div
        key={id || `i${index}`}
        className={
          'group flex w-full border-b border-slate-100 transition-colors hover:bg-sky-50 ' +
          (pinnedRow ? '' : 'absolute ') +
          stripe
        }
        style={
          pinnedRow
            ? { height: ROW_HEIGHT }
            : { transform: `translateY(${top}px)`, height: ROW_HEIGHT }
        }
      >
        {/* מספר השורה — קיצור ישיר לכרטיס, בלי תפריט ביניים */}
        <div
          className={
            'group/idx sticky right-0 z-[1] flex shrink-0 items-center text-xs text-slate-400 ' +
            stickyBg
          }
          style={{ width: INDEX_WIDTH }}
        >
          <span
            onClick={() => onRowClick(index)}
            title="פתיחת כרטיס התלמיד"
            className="flex-1 cursor-pointer text-center transition hover:text-sky-700"
          >
            {index + 1}
          </span>
          {/* הנעץ שומר את מקומו גם כשאינו נראה, אחרת המספר קופץ בריחוף */}
          {id ? (
            <button
              // blur מיד אחרי הלחיצה: אחרת המיקוד נשאר על הכפתור, השורה
              // עוברת לגוש המקובע, ו-React ממחזר את אותו כפתור לשורה אחרת —
              // ואז הנעץ נראה תקוע על שורה שלא נגעו בה.
              onClick={(e) => {
                e.currentTarget.blur()
                togglePinRow(id)
              }}
              title={pinnedRow ? 'ביטול קיבוע השורה' : 'קיבוע השורה — היא תישאר גלויה בגלילה'}
              className={
                pinBtn +
                (pinnedRow
                  ? ' text-sky-600'
                  : ' text-slate-300 opacity-0 hover:text-sky-600 focus-visible:opacity-100 group-hover/idx:opacity-100')
              }
            >
              <IconPin className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className={pinBtn} />
          )}
        </div>
        {/*
          לחיצה שמאלית — כרטיס התלמיד, כמו שהיה.
          לחיצה ימנית — תפריט בחירה: כרטיס או סינון לפי העמודה הזו.
          ההפרדה נדרשה כי תפריט שנפתח בכל לחיצה שמאלית הפריע לגלישה
          רגילה בטבלה.
        */}
        {orderedFields.map((fkey) => {
          const def = getField(fkey)
          const editable = Boolean(def?.extra) && canEditExtra && !!onExtraChange
          const isPinned = pinnedCols.has(fkey)
          const style: CSSProperties = { width: widthOf(fkey) }
          if (isPinned) {
            style.position = 'sticky'
            style.right = pinOffset[fkey]
            style.zIndex = 1
          }
          return (
            <div
              key={fkey}
              // בתא שניתן לעריכה הלחיצה שייכת לפקד עצמו ולא לפתיחת
              // הכרטיס — אחרת כל סימון היה פותח חלון.
              onClick={editable ? undefined : () => onRowClick(index)}
              onContextMenu={(e) => {
                if (!onCellClick) return
                e.preventDefault()
                onCellClick(index, fkey, new DOMRect(e.clientX, e.clientY, 0, 0))
              }}
              style={style}
              className={
                'flex shrink-0 items-center justify-center overflow-hidden px-1.5 text-center text-slate-700 ' +
                (fkey === lastPinnedField
                  ? 'border-l-2 border-l-sky-300 '
                  : 'border-l border-slate-100 ') +
                (editable
                  ? isPinned
                    ? 'bg-amber-50'
                    : 'bg-amber-50/40'
                  : isPinned
                    ? 'cursor-pointer ' + stickyBg
                    : 'cursor-pointer hover:bg-sky-100/60')
              }
              title={
                def?.type === 'boolean'
                  ? isChecked(row[fkey])
                    ? 'מסומן'
                    : 'אינו מסומן'
                  : String(row[fkey] ?? '')
              }
            >
              {def?.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={isChecked(row[fkey])}
                  disabled={!editable}
                  onChange={(e) => onExtraChange?.(index, fkey, e.target.checked)}
                  className="mx-auto accent-sky-600 disabled:opacity-50"
                />
              ) : editable ? (
                <input
                  defaultValue={String(row[fkey] ?? '')}
                  // שמירה ביציאה מהשדה, לא על כל הקלדה — אחרת כל תו
                  // היה מייצר בקשה למסד.
                  onBlur={(e) => {
                    const next = e.target.value
                    if (next !== String(row[fkey] ?? '')) {
                      onExtraChange?.(index, fkey, next || null)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      e.currentTarget.value = String(row[fkey] ?? '')
                      e.currentTarget.blur()
                    }
                  }}
                  className="w-full bg-transparent text-center focus:rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-400"
                />
              ) : (
                <span className="line-clamp-2 w-full break-words leading-tight">
                  {String(row[fkey] ?? '')}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div ref={parentRef} className="thin-scrollbar h-full overflow-auto">
      <div style={{ minWidth: totalWidth }}>
        {/*
          הכותרת והשורות המקובעות הן גוש דביק אחד. כך הגוש המקובע יושב
          תמיד בדיוק מתחת לכותרת בלי למדוד את גובהה בזמן ריצה.
        */}
        <div className="sticky top-0 z-20 bg-sky-50 shadow-sm">
          <div className="flex bg-sky-50" style={{ height: HEADER_HEIGHT }}>
            <div
              style={{ width: INDEX_WIDTH }}
              className="sticky right-0 z-[1] flex shrink-0 items-center justify-center border-b-2 border-sky-200 bg-sky-50 text-sky-400"
            >
              #
            </div>
            {orderedFields.map((key) => {
              const active = sort?.field === key
              const isFiltered = filteredFields?.has(key) ?? false
              const isPinned = pinnedCols.has(key)
              const permanentControls = (isPinned ? 1 : 0) + (isFiltered ? 1 : 0)
              const style: CSSProperties = { width: widthOf(key) }
              if (isPinned) {
                style.position = 'sticky'
                style.right = pinOffset[key]
                style.zIndex = 1
              }
              return (
                <div
                  key={key}
                  style={style}
                  className={
                    'group relative flex shrink-0 items-center border-b-2 font-semibold ' +
                    (key === lastPinnedField ? 'border-l-2 border-l-sky-300 ' : 'border-l border-l-sky-100 ') +
                    (isFiltered
                      ? 'border-b-sky-500 bg-sky-100 text-sky-800'
                      : 'border-b-sky-200 bg-sky-50 text-sky-700')
                  }
                >
                  <button
                    onClick={() => onSort(key)}
                    title={fieldLabel(key) + ' — לחץ למיון'}
                    className={
                      'flex min-w-0 flex-1 items-center justify-center gap-1 pr-1.5 text-center leading-tight transition hover:text-sky-900 ' +
                      // שומרים מקום רק לפקד שגלוי תמיד; המרחפים צפים מעל
                      (permanentControls === 2 ? 'pl-10' : permanentControls === 1 ? 'pl-6' : 'pl-1.5')
                    }
                  >
                    <span className="line-clamp-2 break-words">{fieldLabel(key)}</span>
                    {active && <span className="shrink-0 text-sky-500">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
                  </button>

                  {/*
                    פקדי העמודה צפים בפינה השמאלית ואינם גוזלים רוחב מהכותרת.
                    אחרת שם השדה היה נדחק לצד במקום לשבת במרכז התיבה.
                  */}
                  <div
                    className={
                      'absolute left-1.5 top-1/2 z-[1] flex -translate-y-1/2 items-center gap-0.5 rounded ' +
                      // רקע רק בזמן ריחוף — אחרת הפקדים היו יושבים על הכותרת
                      (isFiltered ? 'group-hover:bg-sky-100' : 'group-hover:bg-sky-50')
                    }
                  >
                    {/* קיבוע העמודה — מוצג תמיד כשהיא מקובעת, ובריחוף אחרת */}
                    <button
                      onClick={(e) => {
                        e.currentTarget.blur()
                        togglePinCol(key)
                      }}
                      title={
                        isPinned
                          ? `ביטול קיבוע ${fieldLabel(key)}`
                          : `קיבוע ${fieldLabel(key)} — העמודה תישאר גלויה בגלילה הצידה`
                      }
                      className={
                        'shrink-0 rounded p-0.5 transition ' +
                        (isPinned
                          ? 'bg-sky-600 text-white'
                          : 'text-sky-400 opacity-0 hover:bg-sky-100 hover:text-sky-700 focus-visible:opacity-100 group-hover:opacity-100')
                      }
                    >
                      <IconPin className="h-3.5 w-3.5" />
                    </button>

                    {/* משפך הסינון — מוצג תמיד כשהעמודה מסוננת, ובריחוף אחרת */}
                    {onOpenFilter && (
                      <button
                        onClick={(e) =>
                          onOpenFilter(key, e.currentTarget.getBoundingClientRect())
                        }
                        title={
                          isFiltered
                            ? `סינון פעיל על ${fieldLabel(key)} — לחץ לעריכה`
                            : `סינון לפי ${fieldLabel(key)}`
                        }
                        className={
                          'shrink-0 rounded p-0.5 transition ' +
                          (isFiltered
                            ? 'bg-sky-600 text-white'
                            : 'text-sky-400 opacity-0 hover:bg-sky-100 hover:text-sky-700 focus-visible:opacity-100 group-hover:opacity-100')
                        }
                      >
                        <IconFilter className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* ידית שינוי רוחב */}
                  <div
                    onMouseDown={(e) => startResize(e, key)}
                    title="גרור לשינוי רוחב"
                    className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize bg-transparent transition hover:bg-sky-400"
                  />
                </div>
              )
            })}

            {/*
              שוליים בקצה שורת הכותרת — אחרי העמודה האחרונה.
              כאן, ולא בסרגל הכלים: הוספת עמודה היא פעולה על הטבלה, והמקום
              שבו היא מתבקשת הוא בדיוק המקום שבו הטבלה נגמרת.
            */}
            {gutter && (
              <div
                style={{ width: GUTTER_WIDTH }}
                className="flex shrink-0 items-center justify-center gap-1 border-b-2 border-sky-200"
              >
                {onAddColumn && (
                  <button
                    onClick={onAddColumn}
                    title="הוספת עמודה משלך — נשמרת בעדכון החודשי ואינה נדרסת"
                    className="rounded-md px-2 text-lg leading-none text-sky-600 transition hover:bg-sky-100 hover:text-sky-800"
                  >
                    +
                  </button>
                )}
                {onToggleExtra && hasExtraColumns && (
                  <button
                    onClick={onToggleExtra}
                    title={
                      extraHidden
                        ? 'הצגת העמודות שהוספת'
                        : 'הסתרת כל העמודות שהוספת (הנתונים נשמרים)'
                    }
                    className={
                      'rounded-md px-1.5 py-0.5 text-xs transition ' +
                      (extraHidden
                        ? 'bg-sky-600 text-white hover:bg-sky-700'
                        : 'text-sky-500 hover:bg-sky-100 hover:text-sky-800')
                    }
                  >
                    {extraHidden ? '🙈' : '👁'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* השורות המקובעות — קו כפול מפריד בינן לבין שאר הטבלה */}
          {pinnedIndices.length > 0 && (
            <div className="border-b-2 border-sky-300">
              {pinnedIndices.map((i) => renderRow(i, true))}
            </div>
          )}
        </div>

        {/* גוף מווירטואל */}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vItem) =>
            renderRow(bodyIndices[vItem.index], false, vItem.start),
          )}
        </div>
      </div>

      {rows.length === 0 && (
        <div className="p-12 text-center text-slate-400">
          <div className="text-3xl">🔍</div>
          <p className="mt-2">אין תוצאות להצגה</p>
          <p className="mt-1 text-sm">נסה להסיר או לשנות את תנאי הסינון</p>
        </div>
      )}
    </div>
  )
}
