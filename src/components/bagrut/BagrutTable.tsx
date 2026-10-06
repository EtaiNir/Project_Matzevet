import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { downloadWorkbook, type CellValue } from '@/lib/xlsx'
import ColumnFilterMenu from '@/components/ColumnFilterMenu'
import CellActionMenu from '@/components/CellActionMenu'
import { BLANK_LABEL, type ColumnValue } from '@/lib/columnValues'

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
}) {
  const [sort, setSort] = useState(initialSort ?? null)

  // ── סינון בעמודה: מפתח עמודה → הערכים שנבחרו. עמודה שאינה כאן = הכול
  const [filters, setFilters] = useState<Record<string, string[]>>({})
  const [menu, setMenu] = useState<{ key: string; anchor: DOMRect } | null>(null)
  // חלון התא — לחיצה ימנית על תא, כמו במצבת: כרטיס תלמיד, או סינון העמודה
  const [cellMenu, setCellMenu] = useState<{ index: number; key: string; anchor: DOMRect } | null>(null)
  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])

  /** עובר את כל סינוני העמודות — חוץ מאחת (לספירות בתפריט שלה, כמו באקסל) */
  const passes = (row: T, skip?: string) =>
    Object.entries(filters).every(([k, sel]) => {
      if (k === skip) return true
      const c = colByKey.get(k)
      if (!c) return true
      return valuesOf(c, row).some((v) => sel.includes(v))
    })

  const filtered = useMemo(
    () => (Object.keys(filters).length ? rows.filter((r) => passes(r)) : rows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filters, colByKey],
  )

  const menuValues = useMemo((): ColumnValue[] => {
    const c = menu && colByKey.get(menu.key)
    if (!c) return []
    const counts = new Map<string, number>()
    for (const r of rows) {
      if (!passes(r, c.key)) continue
      for (const v of new Set(valuesOf(c, r))) counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    const entries = [...counts.entries()]
    const numeric = entries.every(([v]) => v === '' || !Number.isNaN(Number(v)))
    entries.sort(([a], [b]) =>
      a === '' ? 1 : b === '' ? -1 : numeric ? Number(a) - Number(b) : a.localeCompare(b, 'he'))
    return entries.map(([value, count]) => ({ value, label: value === '' ? BLANK_LABEL : value, count }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, rows, filters, colByKey])

  const setColumnFilter = (key: string, sel: string[] | null) =>
    setFilters((f) => {
      const next = { ...f }
      if (sel === null) delete next[key]
      else next[key] = sel
      return next
    })
  const activeFilters = Object.keys(filters).length

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

  const totalWidth = columns.reduce((s, c) => s + c.width, 0)
  const hasGroups = columns.some((c) => c.group)

  // קבוצות כותרת רצופות
  const groups = useMemo(() => {
    const out: { key: string; title: ReactNode; width: number; sticky: boolean }[] = []
    for (const c of columns) {
      const last = out[out.length - 1]
      if (c.group && last && last.key === c.group) last.width += c.width
      else out.push({ key: c.group ?? `_${c.key}`, title: c.group ? (c.groupTitle ?? c.group) : '', width: c.width, sticky: Boolean(c.sticky) })
    }
    return out
  }, [columns])

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
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm">
        <span className="font-semibold tabular-nums text-slate-700">
          {sorted.length.toLocaleString('he-IL')} {countLabel}
        </span>
        {activeFilters > 0 && (
          <>
            <span className="tabular-nums text-slate-400">מתוך {rows.length.toLocaleString('he-IL')}</span>
            <button
              onClick={() => setFilters({})}
              className="rounded-md px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-50"
              title="ניקוי הסינון בכל העמודות"
            >
              ↺ ניקוי סינון עמודות ({activeFilters})
            </button>
          </>
        )}
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
                    style={{ width: c.width, ...stickyStyle(c, '#f8fafc') }}
                    className={`group/h flex shrink-0 items-stretch border-l border-slate-200 ${active ? 'bg-sky-100/70' : ''}`}
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
                        style={{ width: c.width, ...stickyStyle(c) }}
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
