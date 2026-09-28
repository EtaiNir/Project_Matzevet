import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { downloadWorkbook, type CellValue } from '@/lib/xlsx'

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
}

const ROW = 42

export default function BagrutTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  exportName,
  empty = 'אין תלמידים שעונים על הסינון',
  initialSort,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T, index: number, sorted: T[]) => void
  exportName?: string
  empty?: string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
}) {
  const [sort, setSort] = useState(initialSort ?? null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      // ריק תמיד בסוף, בשני הכיוונים — אחרת מיון יורד פותח ב-200 שורות ריקות
      if (va == null || va === '') return vb == null || vb === '' ? 0 : 1
      if (vb == null || vb === '') return -1
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'he')) * dir
    })
  }, [rows, columns, sort])

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
      {exportName && (
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm">
          <span className="font-semibold tabular-nums text-slate-600">{sorted.length.toLocaleString('he-IL')} שורות</span>
          <span className="mr-auto" />
          <button onClick={doExport} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-sm hover:bg-emerald-700">
            ⬇ ייצוא לאקסל
          </button>
        </div>
      )}
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
              {columns.map((c) => (
                <button
                  key={c.key}
                  onClick={() => onHeader(c)}
                  style={{ width: c.width, ...stickyStyle(c, '#f8fafc') }}
                  className={`flex shrink-0 items-center gap-1 border-l border-slate-200 px-2 py-2 text-xs font-bold text-slate-600 ${
                    c.align === 'center' ? 'justify-center text-center' : 'text-right'
                  } ${c.sortValue ? 'hover:bg-sky-50 hover:text-sky-800' : 'cursor-default'}`}
                >
                  <span className="line-clamp-2">{c.header}</span>
                  {sort?.key === c.key && <span className="text-sky-600">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </button>
              ))}
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
    </div>
  )
}
