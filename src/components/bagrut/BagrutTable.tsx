import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { downloadWorkbook, type CellValue } from '@/lib/xlsx'
import ColumnFilterMenu from '@/components/ColumnFilterMenu'
import CellActionMenu from '@/components/CellActionMenu'
import BagrutFilterBar, { type FilterField } from '@/components/bagrut/BagrutFilterBar'
import { BLANK_LABEL, type ColumnValue } from '@/lib/columnValues'
import { isConditionReady, type FilterCondition } from '@/lib/filters'

/**
 * הטבלה של מודול הבגרות.
 *
 * למה לא StudentTable של המצבת: היא בנויה על רישום השדות הגלובלי
 * (config/fields.ts) — כל עמודה היא מפתח שם. רישום 150 עמודות שאלון שם
 * היה מזליג אותן לבורר השדות של המצבת. כאן כל עמודה מגדירה בעצמה איך
 * היא נראית, איך ממיינים אותה ומה נכתב באקסל. השפה החזותית זהה: שורה
 * 42px, כותרת דביקה, וירטואליזציה, לחיצה על שורה = כרטיס.
 */
export interface Column<T> {
  key: string
  header: ReactNode
  /** טקסט הכותרת באקסל (ברירת מחדל: header אם הוא מחרוזת) */
  exportHeader?: string
  /** כותרת-על — עמודות רצופות עם אותו group מקובצות תחתיה */
  group?: string
  groupTitle?: ReactNode
  width: number
  align?: 'start' | 'center'
  render: (row: T) => ReactNode
  sortValue?: (row: T) => string | number | null | undefined
  exportValue?: (row: T) => CellValue
  /** עמודה קפואה בצד ימין בגלילה אופקית */
  sticky?: boolean
  /**
   * הערכים שהעמודה מציגה בתפריט הסינון — כמו במצבת: לחיצה על ▾ בכותרת
   * פותחת את כל הערכים עם ספירה, ובוחרים כמה. מערך = לשורה כמה ערכים
   * (חסמים: "חסרות יח"ל" וגם "אין מוגבר"). ברירת מחדל: exportValue, אחרת sortValue.
   */
  filterValues?: (row: T) => string | string[] | null | undefined
  /** false — אין סינון בעמודה */
  filter?: boolean
}

const ROW = 42
const MIN_WIDTH = 44
const WIDTHS_KEY = 'bagrut:widths:'

function headerText<T>(c: Column<T>): string {
  return c.exportHeader ?? (typeof c.header === 'string' ? c.header : c.key)
}

/**
 * תנאי של "+ הוסף סינון" מול ערכי השורה בעמודה. לעמודה יכולים להיות כמה
 * ערכים לשורה (חסמים): תנאי חיובי — מספיק שאחד מתאים; שלילי — שאף אחד לא.
 */
function matchesCondition(vals: string[], cond: FilterCondition, numeric: boolean): boolean {
  const needle = cond.value ?? ''
  const filled = vals.filter((v) => v !== '')
  const cmp = (v: string, n: string) => (numeric ? Number(v) - Number(n) : v.localeCompare(n, 'he'))
  const eq = (v: string) => (numeric && v !== '' ? Number(v) === Number(needle) : v === needle)
  switch (cond.operator) {
    case 'equals': return vals.some(eq)
    case 'not_equals': return !vals.some(eq)
    case 'contains': return vals.some((v) => v.includes(needle))
    case 'not_contains': return !vals.some((v) => v.includes(needle))
    case 'starts_with': return vals.some((v) => v.startsWith(needle))
    case 'ends_with': return vals.some((v) => v.endsWith(needle))
    case 'gt': return filled.some((v) => cmp(v, needle) > 0)
    case 'lt': return filled.some((v) => cmp(v, needle) < 0)
    case 'between': return filled.some((v) => cmp(v, needle) >= 0 && cmp(v, cond.value2 ?? '') <= 0)
    case 'empty': return filled.length === 0
    case 'not_empty': return filled.length > 0
    case 'one_of': return vals.some((v) => (cond.values ?? []).includes(v))
    default: return true
  }
}

/** הערכים של שורה בעמודה, כמחרוזות. ריק = '' (מוצג כ"(ריק)"). */
function valuesOf<T>(c: Column<T>, row: T): string[] {
  if (c.filterValues) {
    const v = c.filterValues(row)
    const arr = v == null ? [] : Array.isArray(v) ? v : [v]
    return arr.length ? arr.map(String) : ['']
  }
  const v = c.exportValue ? c.exportValue(row) : c.sortValue?.(row)
  return [v == null ? '' : String(v)]
}

function isFilterable<T>(c: Column<T>): boolean {
  return c.filter !== false && Boolean(c.filterValues || c.exportValue || c.sortValue)
}

export default function BagrutTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  exportName,
  empty = 'אין תלמידים שעונים על הסינון',
  initialSort,
  countLabel = 'שורות',
  rowTitle,
  storageKey,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T, index: number, sorted: T[]) => void
  exportName?: string
  empty?: string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  /** מה נספר בשורת המונה ("תלמידים", "שאלונים") */
  countLabel?: string
  /** כותרת חלון התא (לחיצה ימנית) — שם התלמיד שבשורה */
  rowTitle?: (row: T) => string
  /** שם הטבלה לשמירת רוחב העמודות בדפדפן. בלעדיו הרוחב נשמר עד שעוזבים את המסך */
  storageKey?: string
}) {
  const [sort, setSort] = useState(initialSort ?? null)

  // ── רוחב עמודות: גרירת הקצה השמאלי של הכותרת. נשמרים שמות עמודות ורוחב בלבד
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (!storageKey) return {}
    try {
      return JSON.parse(localStorage.getItem(WIDTHS_KEY + storageKey) ?? '{}') as Record<string, number>
    } catch {
      return {}
    }
  })
  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(WIDTHS_KEY + storageKey, JSON.stringify(widths))
    } catch {
      /* מצב פרטי — הרוחב נשאר לסשן הזה */
    }
  }, [widths, storageKey])
  const widthOf = (c: Column<T>) => widths[c.key] ?? c.width
  const resizing = useRef<{ key: string; x: number; width: number; scale: number } | null>(null)
  const onResizeDown = (c: Column<T>, e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    // הדף עשוי להיות מוגדל (zoom במעטפת) — תזוזת העכבר נמדדת בפיקסלי מסך
    const cell = e.currentTarget.parentElement
    const scale = cell && cell.offsetWidth ? cell.getBoundingClientRect().width / cell.offsetWidth : 1
    resizing.current = { key: c.key, x: e.clientX, width: widthOf(c), scale: scale || 1 }
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const r = resizing.current
    if (!r) return
    // RTL: הקצה הנגרר הוא השמאלי, ולכן תזוזה שמאלה מרחיבה
    const next = Math.max(MIN_WIDTH, Math.round(r.width + (r.x - e.clientX) / r.scale))
    setWidths((w) => (w[r.key] === next ? w : { ...w, [r.key]: next }))
  }
  const resetWidth = (key: string) =>
    setWidths((w) => {
      const next = { ...w }
      delete next[key]
      return next
    })

  // ── סינון בעמודה: מפתח עמודה → הערכים שנבחרו. עמודה שאינה כאן = הכול
  const [filters, setFilters] = useState<Record<string, string[]>>({})
  const [menu, setMenu] = useState<{ key: string; anchor: DOMRect } | null>(null)
  // חלון התא — לחיצה ימנית על תא, כמו במצבת: כרטיס תלמיד, או סינון העמודה
  const [cellMenu, setCellMenu] = useState<{ index: number; key: string; anchor: DOMRect } | null>(null)
  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])

  // ── "+ הוסף סינון": תנאים עם אופרטור (מכיל, גדול מ, בין…), כמו במצבת
  const [conds, setConds] = useState<FilterCondition[]>([])
  // עמודה מספרית = הערך הגולמי שלה מספר (ת"ז היא מחרוזת, ולכן נשארת טקסט עם "מכיל")
  const filterFields = useMemo((): FilterField[] => {
    return columns.filter(isFilterable).map((c) => {
      let numeric = false
      if (!c.filterValues) {
        for (const r of rows) {
          const v = c.exportValue ? c.exportValue(r) : c.sortValue?.(r)
          if (v == null || v === '') continue
          numeric = typeof v === 'number'
          break
        }
      }
      return { key: c.key, label: headerText(c), type: numeric ? 'number' : 'text' }
    })
  }, [columns, rows])
  const numericKeys = useMemo(() => new Set(filterFields.filter((f) => f.type === 'number').map((f) => f.key)), [filterFields])
  // תנאי על עמודה שאינה מוצגת כרגע (עמודות הזכאות בשכבה שאינה מסיימת) אינו פעיל ואינו מוצג
  const shownConds = useMemo(() => conds.filter((c) => colByKey.has(c.field)), [conds, colByKey])
  const readyConds = useMemo(() => shownConds.filter(isConditionReady), [shownConds])

  /** עובר את כל הסינונים — חוץ מעמודה או מתנאי אחד (לספירות בתפריט שלו, כמו באקסל) */
  const passes = (row: T, skip?: { col?: string; cond?: string }) =>
    Object.entries(filters).every(([k, sel]) => {
      if (k === skip?.col) return true
      const c = colByKey.get(k)
      if (!c) return true
      return valuesOf(c, row).some((v) => sel.includes(v))
    }) &&
    readyConds.every((cd) => cd.id === skip?.cond || matchesCondition(valuesOf(colByKey.get(cd.field)!, row), cd, numericKeys.has(cd.field)))

  const filtered = useMemo(
    () => (Object.keys(filters).length || readyConds.length ? rows.filter((r) => passes(r)) : rows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filters, readyConds, numericKeys, colByKey],
  )

  const listValues = (c: Column<T>, skip: { col?: string; cond?: string }): ColumnValue[] => {
    const counts = new Map<string, number>()
    for (const r of rows) {
      if (!passes(r, skip)) continue
      for (const v of new Set(valuesOf(c, r))) counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    const entries = [...counts.entries()]
    const numeric = entries.every(([v]) => v === '' || !Number.isNaN(Number(v)))
    entries.sort(([a], [b]) =>
      a === '' ? 1 : b === '' ? -1 : numeric ? Number(a) - Number(b) : a.localeCompare(b, 'he'))
    return entries.map(([value, count]) => ({ value, label: value === '' ? BLANK_LABEL : value, count }))
  }

  const menuValues = useMemo((): ColumnValue[] => {
    const c = menu && colByKey.get(menu.key)
    return c ? listValues(c, { col: c.key }) : []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, rows, filters, readyConds, numericKeys, colByKey])

  const setColumnFilter = (key: string, sel: string[] | null) =>
    setFilters((f) => {
      const next = { ...f }
      if (sel === null) delete next[key]
      else next[key] = sel
      return next
    })
  const activeFilters = Object.keys(filters).length + readyConds.length

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      // ריק תמיד בסוף, בשני הכיוונים — אחרת מיון יורד פותח ב-200 שורות ריקות
      if (va == null || va === '') return vb == null || vb === '' ? 0 : 1
      if (vb == null || vb === '') return -1
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'he')) * dir
    })
  }, [filtered, columns, sort])

  const parentRef = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 12,
  })

  const totalWidth = columns.reduce((s, c) => s + widthOf(c), 0)
  const hasGroups = columns.some((c) => c.group)

  // קבוצות כותרת רצופות
  const groups = useMemo(() => {
    const out: { key: string; title: ReactNode; width: number; sticky: boolean }[] = []
    for (const c of columns) {
      const w = widths[c.key] ?? c.width
      const last = out[out.length - 1]
      if (c.group && last && last.key === c.group) last.width += w
      else out.push({ key: c.group ?? `_${c.key}`, title: c.group ? (c.groupTitle ?? c.group) : '', width: w, sticky: Boolean(c.sticky) })
    }
    return out
  }, [columns, widths])

  const stickyStyle = (c: { sticky?: boolean }, bg = 'white') =>
    c.sticky ? ({ position: 'sticky', right: 0, zIndex: 2, background: bg } as const) : undefined

  const onHeader = (c: Column<T>) => {
    if (!c.sortValue) return
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))
  }

  const doExport = () => {
    if (!exportName) return
    const headers = columns.map((c) => c.exportHeader ?? (typeof c.header === 'string' ? c.header : c.key))
    const data = sorted.map((r) =>
      columns.map((c) => (c.exportValue ? c.exportValue(r) : ((c.sortValue?.(r) ?? '') as CellValue))),
    )
    const numeric = new Set<number>()
    columns.forEach((_, i) => {
      if (data.length && data.every((row) => row[i] == null || row[i] === '' || typeof row[i] === 'number')) numeric.add(i)
    })
    const stamp = new Date().toISOString().slice(0, 10)
    downloadWorkbook({ sheetName: 'בגרות', headers, rows: data, numericColumns: numeric }, `${exportName}_${stamp}.xlsx`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* ── מונה: תמיד גלוי, כדי שבכל רשימה מסוננת יראו כמה יש בה ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm">
        <span className="font-semibold tabular-nums text-slate-700">
          {sorted.length.toLocaleString('he-IL')} {countLabel}
        </span>
        {activeFilters > 0 && (
          <>
            <span className="tabular-nums text-slate-400">מתוך {rows.length.toLocaleString('he-IL')}</span>
            <button
              onClick={() => {
                setFilters({})
                setConds([])
              }}
              className="rounded-md px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-50"
              title="ניקוי כל הסינונים שבטבלה — בעמודות ובתנאים"
            >
              ↺ ניקוי סינון ({activeFilters})
            </button>
          </>
        )}
        <BagrutFilterBar
          fields={filterFields}
          conditions={shownConds}
          onChange={setConds}
          valuesFor={(cond) => {
            const c = colByKey.get(cond.field)
            return c ? listValues(c, { cond: cond.id }) : []
          }}
        />
        <span className="mr-auto" />
        {exportName && (
          <button onClick={doExport} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-sm hover:bg-emerald-700">
            ⬇ ייצוא לאקסל
          </button>
        )}
      </div>
      <div ref={parentRef} className="thin-scrollbar relative min-h-0 flex-1 overflow-auto">
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          {/* ── כותרות ── */}
          <div className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_#e2e8f0]">
            {hasGroups && (
              <div className="flex">
                {groups.map((g) => (
                  <div
                    key={g.key}
                    style={{ width: g.width, ...stickyStyle(g, '#f8fafc') }}
                    className={`shrink-0 border-l border-slate-200 px-2 py-1.5 text-center text-xs ${g.title ? 'bg-sky-50/70 font-bold text-sky-900' : ''}`}
                  >
                    {g.title}
                  </div>
                ))}
              </div>
            )}
            <div className="flex">
              {columns.map((c) => {
                const active = Boolean(filters[c.key])
                return (
                  <div
                    key={c.key}
                    style={{ width: widthOf(c), ...stickyStyle(c, '#f8fafc') }}
                    className={`group/h flex shrink-0 items-stretch border-l border-slate-200 ${c.sticky ? '' : 'relative'} ${active ? 'bg-sky-100/70' : ''}`}
                  >
                    <button
                      onClick={() => onHeader(c)}
                      className={`flex min-w-0 flex-1 items-center gap-1 px-2 py-2 text-xs font-bold text-slate-600 ${
                        c.align === 'center' ? 'justify-center text-center' : 'text-right'
                      } ${c.sortValue ? 'hover:bg-sky-50 hover:text-sky-800' : 'cursor-default'}`}
                    >
                      <span className="line-clamp-2">{c.header}</span>
                      {sort?.key === c.key && <span className="text-sky-600">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                    {isFilterable(c) && (
                      <button
                        onClick={(e) => setMenu({ key: c.key, anchor: e.currentTarget.getBoundingClientRect() })}
                        title={active ? 'מסונן — לחיצה לשינוי' : 'סינון לפי ערכים'}
                        className={`shrink-0 px-1 text-[10px] transition ${
                          active ? 'text-sky-700' : 'text-slate-400 opacity-60 hover:text-sky-700 group-hover/h:opacity-100'
                        }`}
                      >
                        {active ? '▼' : '▾'}
                      </button>
                    )}
                    <span
                      onPointerDown={(e) => onResizeDown(c, e)}
                      onPointerMove={onResizeMove}
                      onPointerUp={() => (resizing.current = null)}
                      onPointerCancel={() => (resizing.current = null)}
                      onDoubleClick={() => resetWidth(c.key)}
                      title="גרירה לשינוי רוחב העמודה · לחיצה כפולה לחזרה לרוחב המקורי"
                      className="absolute inset-y-0 left-0 z-[3] w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70 active:bg-sky-500"
                    />
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── שורות ── */}
          {sorted.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">{empty}</div>
          ) : (
            <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
              {virt.getVirtualItems().map((v) => {
                const row = sorted[v.index]
                return (
                  <div
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row, v.index, sorted) : undefined}
                    className={`group absolute inset-x-0 flex border-b border-slate-100 ${
                      onRowClick ? 'cursor-pointer hover:bg-sky-50/60' : ''
                    } ${v.index % 2 ? 'bg-slate-50/40' : 'bg-white'}`}
                    style={{ height: ROW, transform: `translateY(${v.start}px)` }}
                  >
                    {columns.map((c) => (
                      <div
                        key={c.key}
                        onContextMenu={(e) => {
                          if (!isFilterable(c)) return
                          e.preventDefault()
                          setCellMenu({ index: v.index, key: c.key, anchor: new DOMRect(e.clientX, e.clientY, 0, 0) })
                        }}
                        style={{ width: widthOf(c), ...stickyStyle(c) }}
                        className={`flex shrink-0 items-center overflow-hidden border-l border-slate-100 px-2 text-sm ${
                          c.align === 'center' ? 'justify-center' : ''
                        } ${c.sticky ? 'group-hover:!bg-sky-50' : ''}`}
                      >
                        {c.render(row)}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {cellMenu && sorted[cellMenu.index] && colByKey.get(cellMenu.key) && (() => {
        const row = sorted[cellMenu.index]
        const c = colByKey.get(cellMenu.key)!
        return (
          <CellActionMenu
            studentName={rowTitle?.(row) ?? ''}
            columnLabel={c.exportHeader ?? (typeof c.header === 'string' ? c.header : c.key)}
            cellValue={valuesOf(c, row).filter(Boolean).join(', ')}
            anchor={cellMenu.anchor}
            onOpenCard={onRowClick ? () => {
              setCellMenu(null)
              onRowClick(row, cellMenu.index, sorted)
            } : undefined}
            onOpenFilter={() => {
              setMenu({ key: cellMenu.key, anchor: cellMenu.anchor })
              setCellMenu(null)
            }}
            onClose={() => setCellMenu(null)}
          />
        )
      })()}

      {menu && colByKey.get(menu.key) && (
        <ColumnFilterMenu
          title={(() => {
            const c = colByKey.get(menu.key)!
            return c.exportHeader ?? (typeof c.header === 'string' ? c.header : c.key)
          })()}
          values={menuValues}
          selected={filters[menu.key] ?? null}
          onChange={(sel) => setColumnFilter(menu.key, sel)}
          onSort={colByKey.get(menu.key)!.sortValue ? (dir) => setSort({ key: menu.key, dir }) : undefined}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
