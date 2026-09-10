import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { fieldLabel, getField } from '@/config/fields'
import { isChecked } from '@/lib/filters'
import { IconFilter } from '@/components/brand/Icons'
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

const ROW_HEIGHT = 36
const DEFAULT_COL_WIDTH = 96 // צר יותר מבעבר כדי שייכנסו יותר עמודות במסך
const MIN_COL_WIDTH = 56
const INDEX_WIDTH = 44
// שוליים בקצה שורת הכותרת לכפתורי העמודות התוספתיות
const GUTTER_WIDTH = 72

/**
 * הטבלה הראשית — שורות מווירטואלות (~50k), רוחב עמודות ניתן לשינוי בגרירה (אפיון §6.1).
 * מבנה flex אחיד לכותרת ולשורות לשמירת יישור.
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

  const virtualizer = useVirtualizer({
    count: rows.length,
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

  return (
    <div ref={parentRef} className="thin-scrollbar h-full overflow-auto">
      <div style={{ minWidth: totalWidth }}>
        {/* כותרת דביקה */}
        <div className="sticky top-0 z-10 flex bg-sky-50 shadow-sm">
          <div
            style={{ width: INDEX_WIDTH }}
            className="flex shrink-0 items-center justify-center border-b-2 border-sky-200 py-2 text-sky-400"
          >
            #
          </div>
          {fields.map((key) => {
            const active = sort?.field === key
            const isFiltered = filteredFields?.has(key) ?? false
            return (
              <div
                key={key}
                style={{ width: widthOf(key) }}
                className={
                  'group relative flex shrink-0 items-center justify-between gap-1 whitespace-nowrap border-b-2 border-l py-2 pr-2 pl-1 font-semibold ' +
                  (isFiltered
                    ? 'border-b-sky-500 border-l-sky-100 bg-sky-100 text-sky-800'
                    : 'border-sky-200 border-l-sky-100 text-sky-700')
                }
              >
                <button
                  onClick={() => onSort(key)}
                  title={fieldLabel(key) + ' — לחץ למיון'}
                  className="flex min-w-0 flex-1 items-center gap-1 text-right transition hover:text-sky-900"
                >
                  <span className="truncate">{fieldLabel(key)}</span>
                  {active && <span className="shrink-0 text-sky-500">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
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
                        : 'text-sky-400 opacity-0 hover:bg-sky-100 hover:text-sky-700 focus:opacity-100 group-hover:opacity-100')
                    }
                  >
                    <IconFilter className="h-3.5 w-3.5" />
                  </button>
                )}

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
              className="flex shrink-0 items-center justify-center gap-1 border-b-2 border-sky-200 py-2"
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

        {/* גוף מווירטואל */}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const row = rows[vItem.index]
            return (
              <div
                key={vItem.key}
                className={
                  "absolute flex w-full border-b border-slate-100 transition-colors hover:bg-sky-50 " +
                  (vItem.index % 2 ? "bg-slate-50/60" : "bg-white")
                }
                style={{ transform: `translateY(${vItem.start}px)`, height: ROW_HEIGHT }}
              >
                {/* מספר השורה — קיצור ישיר לכרטיס, בלי תפריט ביניים */}
                <div
                  onClick={() => onRowClick(vItem.index)}
                  title="פתיחת כרטיס התלמיד"
                  className="flex shrink-0 cursor-pointer items-center justify-center text-xs text-slate-400 transition hover:bg-sky-100 hover:text-sky-700"
                  style={{ width: INDEX_WIDTH }}
                >
                  {vItem.index + 1}
                </div>
                {/*
                  לחיצה שמאלית — כרטיס התלמיד, כמו שהיה.
                  לחיצה ימנית — תפריט בחירה: כרטיס או סינון לפי העמודה הזו.
                  ההפרדה נדרשה כי תפריט שנפתח בכל לחיצה שמאלית הפריע לגלישה
                  רגילה בטבלה.
                */}
                {fields.map((key) => {
                  const def = getField(key)
                  const editable = Boolean(def?.extra) && canEditExtra && !!onExtraChange
                  return (
                    <div
                      key={key}
                      // בתא שניתן לעריכה הלחיצה שייכת לפקד עצמו ולא לפתיחת
                      // הכרטיס — אחרת כל סימון היה פותח חלון.
                      onClick={editable ? undefined : () => onRowClick(vItem.index)}
                      onContextMenu={(e) => {
                        if (!onCellClick) return
                        e.preventDefault()
                        onCellClick(
                          vItem.index,
                          key,
                          new DOMRect(e.clientX, e.clientY, 0, 0),
                        )
                      }}
                      style={{ width: widthOf(key) }}
                      className={
                        'flex shrink-0 items-center overflow-hidden whitespace-nowrap border-l border-slate-100 px-2 text-slate-700 ' +
                        (editable ? 'bg-amber-50/40' : 'cursor-pointer hover:bg-sky-100/60')
                      }
                      title={
                        def?.type === 'boolean'
                          ? isChecked(row[key])
                            ? 'מסומן'
                            : 'אינו מסומן'
                          : String(row[key] ?? '')
                      }
                    >
                      {def?.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={isChecked(row[key])}
                          disabled={!editable}
                          onChange={(e) => onExtraChange?.(vItem.index, key, e.target.checked)}
                          className="mx-auto accent-sky-600 disabled:opacity-50"
                        />
                      ) : editable ? (
                        <input
                          defaultValue={String(row[key] ?? '')}
                          // שמירה ביציאה מהשדה, לא על כל הקלדה — אחרת כל תו
                          // היה מייצר בקשה למסד.
                          onBlur={(e) => {
                            const next = e.target.value
                            if (next !== String(row[key] ?? '')) {
                              onExtraChange?.(vItem.index, key, next || null)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') {
                              e.currentTarget.value = String(row[key] ?? '')
                              e.currentTarget.blur()
                            }
                          }}
                          className="w-full bg-transparent focus:rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-400"
                        />
                      ) : (
                        <span className="truncate">{String(row[key] ?? '')}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
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
