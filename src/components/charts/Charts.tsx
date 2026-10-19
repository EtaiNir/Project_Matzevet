import { useState, type ReactNode } from 'react'
import { colorFor, OTHER, type Bucket } from '@/lib/charts'

/**
 * רכיבי הגרפים של מסך הגרפים — SVG ו-HTML בלי ספרייה (npm install נכשל
 * ברשת הזו, ובכל מקרה אין צורך: עמודות, פסים, טבעת ומפת חום).
 *
 * כל גרף מקבל `onPick` — לחיצה על פס או פלח מוסיפה סינון לכל המסך.
 * "אחר" (קיבוץ השאר) אינו לחיץ.
 */

const fmt = (n: number) => n.toLocaleString('he-IL')
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '')

export function ChartCard({ title, sub, children, className = '', action }: {
  title: string
  sub?: ReactNode
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          {sub && <div className="text-xs text-slate-500">{sub}</div>}
        </div>
        <span className="mr-auto" />
        {action}
      </div>
      {children}
    </section>
  )
}

export function Legend({ keys, total }: { keys: string[]; total?: Map<string, number> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
      {keys.map((k, i) => (
        <span key={k} className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFor(k, i) }} />
          {k}
          {total && <span className="tabular-nums text-slate-400">{fmt(total.get(k) ?? 0)}</span>}
        </span>
      ))}
    </div>
  )
}

/** פסים אופקיים — לרשימות ארוכות (מוסדות, יישובים). עם פיצול: פס מוערם */
export function HBars({ items, splitKeys, onPick }: {
  items: Bucket[]
  splitKeys?: string[]
  onPick?: (key: string) => void
}) {
  const max = Math.max(1, ...items.map((b) => b.n))
  const total = items.reduce((s, b) => s + b.n, 0)
  return (
    <div className="flex flex-col gap-1">
      {items.map((b) => {
        const clickable = onPick && b.key !== OTHER
        return (
          <button
            key={b.key}
            disabled={!clickable}
            onClick={() => clickable && onPick!(b.key)}
            title={`${b.key}: ${fmt(b.n)} (${pct(b.n, total)})`}
            className={`group grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-2 rounded-md px-1 py-0.5 text-right text-xs ${clickable ? 'hover:bg-sky-50' : 'cursor-default'}`}
          >
            <span className="truncate text-slate-700">{b.key}</span>
            <span className="flex h-3.5 overflow-hidden rounded-sm bg-slate-100" style={{ width: `${(b.n / max) * 100}%`, minWidth: 2 }}>
              {splitKeys && b.split ? (
                splitKeys.map((k, i) => {
                  const v = b.split!.get(k) ?? 0
                  return v ? <span key={k} style={{ width: `${(v / b.n) * 100}%`, background: colorFor(k, i) }} title={`${k}: ${fmt(v)}`} /> : null
                })
              ) : (
                <span className="w-full bg-sky-500 group-hover:bg-sky-600" />
              )}
            </span>
            <span className="text-left tabular-nums text-slate-500">{fmt(b.n)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** עמודות אנכיות — לשכבות ולהתפלגויות. עם פיצול: עמודה מוערמת */
export function Columns({ items, splitKeys, onPick, height = 170 }: {
  items: Bucket[]
  splitKeys?: string[]
  onPick?: (key: string) => void
  height?: number
}) {
  const max = Math.max(1, ...items.map((b) => b.n))
  return (
    <div className="flex items-end gap-1" style={{ height: height + 34 }} dir="rtl">
      {items.map((b) => {
        const clickable = onPick && b.key !== OTHER
        const h = (b.n / max) * height
        return (
          <button
            key={b.key}
            disabled={!clickable}
            onClick={() => clickable && onPick!(b.key)}
            title={`${b.key}: ${fmt(b.n)}${b.split && splitKeys ? ' · ' + splitKeys.map((k) => `${k} ${fmt(b.split!.get(k) ?? 0)}`).join(' · ') : ''}`}
            className={`group flex min-w-0 flex-1 flex-col items-center justify-end gap-1 ${clickable ? '' : 'cursor-default'}`}
          >
            <span className="text-[10px] tabular-nums text-slate-500">{fmt(b.n)}</span>
            <span className={`flex w-full max-w-[2.75rem] flex-col-reverse overflow-hidden rounded-t-md ${clickable ? 'group-hover:opacity-80' : ''}`} style={{ height: Math.max(h, 2) }}>
              {splitKeys && b.split ? (
                splitKeys.map((k, i) => {
                  const v = b.split!.get(k) ?? 0
                  return v ? <span key={k} style={{ height: `${(v / b.n) * 100}%`, background: colorFor(k, i) }} /> : null
                })
              ) : (
                <span className="h-full bg-sky-500" />
              )}
            </span>
            <span className="w-full truncate text-center text-[11px] font-medium text-slate-600">{b.key}</span>
          </button>
        )
      })}
    </div>
  )
}

/** טבעת — חלק מהשלם. מעט ערכים בלבד (עד ~6; השאר כדאי לקבץ ל"אחר") */
export function Donut({ items, onPick, size = 140 }: { items: Bucket[]; onPick?: (key: string) => void; size?: number }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = items.reduce((s, b) => s + b.n, 0)
  const r = size / 2 - 10
  const c = 2 * Math.PI * r
  let offset = 0
  const shown = hover ? items.find((b) => b.key === hover) : null
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={18} />
        {items.map((b, i) => {
          const len = total ? (b.n / total) * c : 0
          const el = (
            <circle
              key={b.key}
              cx={size / 2} cy={size / 2} r={r} fill="none" transform={`rotate(-90 ${size / 2} ${size / 2})`}
              stroke={colorFor(b.key, i)} strokeWidth={hover === b.key ? 22 : 18}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              onMouseEnter={() => setHover(b.key)} onMouseLeave={() => setHover(null)}
              onClick={() => onPick && b.key !== OTHER && onPick(b.key)}
              className={onPick && b.key !== OTHER ? 'cursor-pointer' : ''}
            >
              <title>{`${b.key}: ${fmt(b.n)} (${pct(b.n, total)})`}</title>
            </circle>
          )
          offset += len
          return el
        })}
        <text x="50%" y="49%" textAnchor="middle" className="fill-slate-800 text-lg font-extrabold">{shown ? pct(shown.n, total) : fmt(total)}</text>
        <text x="50%" y="63%" textAnchor="middle" className="fill-slate-400 text-[10px]">{shown ? shown.key.slice(0, 16) : 'סה״כ'}</text>
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
        {items.map((b, i) => (
          <button
            key={b.key}
            disabled={!onPick || b.key === OTHER}
            onClick={() => onPick?.(b.key)}
            onMouseEnter={() => setHover(b.key)} onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-1.5 rounded px-1 text-right ${onPick && b.key !== OTHER ? 'hover:bg-sky-50' : 'cursor-default'}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorFor(b.key, i) }} />
            <span className="truncate text-slate-700">{b.key}</span>
            <span className="mr-auto tabular-nums text-slate-500">{fmt(b.n)}</span>
            <span className="w-9 text-left tabular-nums text-slate-400">{pct(b.n, total)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** מפת חום — הצלבה של שני שדות (כמו פיבוט), עוצמת הצבע לפי הספירה */
export function Heatmap({ rows, cols, value, onPick, rowLabel }: {
  rows: string[]
  cols: string[]
  value: (r: string, c: string) => number
  onPick?: (r: string, c: string) => void
  rowLabel: string
}) {
  let max = 1
  for (const r of rows) for (const c of cols) max = Math.max(max, value(r, c))
  return (
    <div className="thin-scrollbar overflow-auto">
      <table className="border-separate border-spacing-0.5 text-[11px]">
        <thead>
          <tr>
            <th className="sticky right-0 bg-white px-1 text-right font-semibold text-slate-400">{rowLabel}</th>
            {cols.map((c) => <th key={c} className="px-1 font-semibold text-slate-500">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th className="sticky right-0 max-w-[9rem] truncate bg-white px-1 text-right font-medium text-slate-700">{r}</th>
              {cols.map((c) => {
                const v = value(r, c)
                const a = v ? 0.12 + 0.88 * (v / max) : 0
                return (
                  <td
                    key={c}
                    onClick={() => v && onPick?.(r, c)}
                    title={`${r} · ${c}: ${fmt(v)}`}
                    className={`h-6 min-w-[2rem] rounded text-center tabular-nums ${v && onPick ? 'cursor-pointer hover:ring-2 hover:ring-sky-400' : ''}`}
                    style={{ background: v ? `rgba(2,132,199,${a})` : '#f8fafc', color: a > 0.55 ? 'white' : '#334155' }}
                  >
                    {v || ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Stat({ value, label, sub, tone = 'text-slate-800' }: { value: ReactNode; label: string; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-[9rem] flex-1 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
      <div className={`text-2xl font-extrabold tabular-nums leading-none ${tone}`}>{value}</div>
      <div className="mt-1 text-xs font-semibold text-slate-600">{label}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}
