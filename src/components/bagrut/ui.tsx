/**
 * רכיבי התצוגה של מודול הבגרות — שפה חזותית אחת לכל המסכים.
 *
 * הגרפים מצוירים ב-SVG כאן ולא בספרייה: ארבע צורות פשוטות (טבעת, פס
 * מוערם, היסטוגרמה, מד תרומה) אינן מצדיקות תלות, ו-npm install נכשל
 * ברשת הזו (ראה CLAUDE.md — SheetJS הוסר מאותה סיבה).
 */
import type { ReactNode } from 'react'
import {
  ELIGIBILITY_META,
  type Completion,
  type EligibilityKind,
  type GradeTone,
  gradeTone,
  fmt,
} from '@/lib/bagrut'

// ─────────────────────────────── צבעים ───────────────────────────────

export const TONE = {
  green: { chip: 'bg-emerald-100 text-emerald-800 ring-emerald-200', fill: '#10b981', soft: 'bg-emerald-50' },
  teal: { chip: 'bg-teal-50 text-teal-800 ring-teal-200', fill: '#5eead4', soft: 'bg-teal-50' },
  amber: { chip: 'bg-amber-100 text-amber-800 ring-amber-200', fill: '#f59e0b', soft: 'bg-amber-50' },
  red: { chip: 'bg-rose-100 text-rose-800 ring-rose-200', fill: '#f43f5e', soft: 'bg-rose-50' },
  slate: { chip: 'bg-slate-100 text-slate-600 ring-slate-200', fill: '#cbd5e1', soft: 'bg-slate-50' },
} as const

export const KIND_ORDER: EligibilityKind[] = ['eligible', 'one_negative', 'not_eligible']

export function StatusBadge({ kind, long = false }: { kind: EligibilityKind; long?: boolean }) {
  const meta = ELIGIBILITY_META[kind]
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${TONE[meta.tone].chip}`}
      title={meta.label}
    >
      {long ? meta.label : meta.short}
    </span>
  )
}

const GRADE_CLASS: Record<GradeTone, string> = {
  fail: 'bg-rose-100 text-rose-800 font-bold',
  pass: 'text-slate-800',
  // ציון חסם (שלילי מוגבר): הציון עצמו מוצג, ומסגרת כתומה בולטת סביבו
  blocked: 'bg-orange-50 text-orange-800 font-bold ring-2 ring-inset ring-orange-500',
  none: 'text-slate-300',
}

/**
 * ציון עם צבע לפי הסף: מתחת ל-55 אדום; חסם 1–4 — הציון עצמו, במסגרת כתומה.
 * boxed — גם ציון עובר בריבוע (כחול), כך שכל ציון בטבלה קטנה יושב בריבוע צבע.
 */
export function Grade({ value, strong = false, boxed = false }: { value: number | null | undefined; strong?: boolean; boxed?: boolean }) {
  const tone = gradeTone(value)
  const cls = boxed && tone === 'pass' ? 'bg-sky-100 text-sky-800 font-bold' : GRADE_CLASS[tone]
  return (
    <span
      className={`inline-block min-w-[2.25rem] rounded-md px-1.5 py-0.5 text-center tabular-nums ${cls} ${strong ? 'text-base font-extrabold' : 'text-sm'}`}
      title={tone === 'blocked' ? 'ציון חסם (שלילי מוגבר) — מחייב בחינה חוזרת, ואינו נספר' : undefined}
    >
      {value == null ? '—' : fmt(value)}
    </span>
  )
}

export const COMPLETION_META: Record<Completion, { icon: string; label: string; cls: string }> = {
  done: { icon: '✔', label: 'הושלם', cls: 'text-emerald-600' },
  progress: { icon: '◐', label: 'בתהליך', cls: 'text-amber-600' },
  not_started: { icon: '○', label: 'טרם החל', cls: 'text-slate-400' },
  unknown: { icon: '·', label: '—', cls: 'text-slate-300' },
}

export function CompletionMark({ value, withLabel = false }: { value: Completion; withLabel?: boolean }) {
  const m = COMPLETION_META[value]
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${m.cls}`} title={m.label}>
      <span aria-hidden className="text-base leading-none">{m.icon}</span>
      {withLabel && <span className="text-xs font-medium">{m.label}</span>}
    </span>
  )
}

// ─────────────────────────────── כרטיסים ───────────────────────────────

export function Card({
  children,
  className = '',
  title,
  action,
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
  action?: ReactNode
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <h2 className="text-base font-bold text-slate-800">{title}</h2>}
          <span className="mr-auto" />
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Kpi({
  value,
  label,
  sub,
  tone = 'slate',
  onClick,
  children,
}: {
  value: ReactNode
  label: string
  sub?: ReactNode
  tone?: keyof typeof TONE | 'sky'
  onClick?: () => void
  children?: ReactNode
}) {
  const accent =
    tone === 'sky' ? 'text-sky-700' : tone === 'slate' ? 'text-slate-800' : TONE[tone].chip.split(' ')[1]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`group flex min-w-0 flex-1 items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 text-right shadow-sm ${
        onClick ? 'transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md' : ''
      }`}
    >
      {children}
      <div className="min-w-0">
        <div className={`text-3xl font-extrabold tabular-nums leading-none ${accent}`}>{value}</div>
        <div className="mt-1.5 text-sm font-semibold text-slate-700">{label}</div>
        {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
      </div>
      {onClick && <span className="mr-auto text-slate-300 transition group-hover:text-sky-500">←</span>}
    </Tag>
  )
}

// ─────────────────────────────── גרפים ───────────────────────────────

export interface Segment {
  key: string
  value: number
  color: string
  label: string
}

/** טבעת — חלק מהשלם. המספר במרכז. */
export function Donut({ segments, size = 88, center }: { segments: Segment[]; size?: number; center?: ReactNode }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const r = 38
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="14" />
        {segments.map((s) => {
          const len = (s.value / total) * c
          const el = (
            <circle
              key={s.key}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
          offset += len
          return el
        })}
      </svg>
      {center && <div className="absolute inset-0 flex items-center justify-center text-center">{center}</div>}
    </div>
  )
}

/** פס מוערם אופקי. לחיצה על מקטע → onSegment. */
export function StackedBar({
  segments,
  onSegment,
  height = 'h-6',
}: {
  segments: Segment[]
  onSegment?: (key: string) => void
  height?: string
}) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  if (!total) return <div className={`${height} rounded-full bg-slate-100`} />
  return (
    <div className={`flex ${height} w-full overflow-hidden rounded-full bg-slate-100`}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <button
            key={s.key}
            onClick={onSegment ? () => onSegment(s.key) : undefined}
            className={`flex items-center justify-center text-[11px] font-bold text-white/95 transition ${
              onSegment ? 'hover:brightness-110' : 'cursor-default'
            }`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value}`}
          >
            {s.value / total > 0.08 ? s.value : ''}
          </button>
        ))}
    </div>
  )
}

/**
 * התפלגות ציונים — 10 עמודות של 10 נקודות, עם קווי סף ב-45 וב-55.
 * לחיצה על עמודה מחזירה את הטווח שלה.
 */
export function Histogram({
  values,
  onBin,
  activeBin,
}: {
  values: number[]
  onBin?: (bin: [number, number] | null) => void
  activeBin?: [number, number] | null
}) {
  const bins = Array.from({ length: 10 }, (_, i) => values.filter((v) => (i === 9 ? v >= 90 : v >= i * 10 && v < i * 10 + 10)).length)
  const max = Math.max(1, ...bins)
  const W = 300
  const H = 90
  const bw = W / 10
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" style={{ direction: 'ltr' }}>
      {bins.map((n, i) => {
        const h = (n / max) * H
        const lo = i * 10
        const hi = i === 9 ? 100 : lo + 9
        const active = activeBin && activeBin[0] === lo
        const color = lo < 55 ? '#fb7185' : '#38bdf8'
        return (
          <g
            key={i}
            onClick={onBin ? () => onBin(active ? null : [lo, hi]) : undefined}
            className={onBin ? 'cursor-pointer' : ''}
          >
            <rect x={i * bw + 2} y={0} width={bw - 4} height={H} fill="transparent" />
            <rect
              x={i * bw + 3}
              y={H - h}
              width={bw - 6}
              height={Math.max(h, n ? 2 : 0)}
              rx={3}
              fill={color}
              opacity={activeBin && !active ? 0.3 : 1}
            >
              <title>{`${lo}–${hi}: ${n} תלמידים`}</title>
            </rect>
            {n > 0 && (
              <text x={i * bw + bw / 2} y={H - h - 3} textAnchor="middle" fontSize="9" fill="#475569">
                {n}
              </text>
            )}
            <text x={i * bw + bw / 2} y={H + 12} textAnchor="middle" fontSize="8.5" fill="#94a3b8">
              {lo}
            </text>
          </g>
        )
      })}
      {[45, 55].map((t) => (
        <line key={t} x1={(t / 100) * W} x2={(t / 100) * W} y1={0} y2={H} stroke={t === 45 ? '#e11d48' : '#0f766e'} strokeDasharray="3 3" strokeWidth={1.2}>
          <title>{t === 45 ? 'סף שלילי מותר (45)' : 'ציון עובר (55)'}</title>
        </line>
      ))}
    </svg>
  )
}

/**
 * "מד תרומה": כמה נקודות הביא כל שאלון לציון הסופי, עם קו סף ב-55.
 * כך סבא הסביר את החישוב — "100 הביא לו 25 נקודות, 31 הביא 10".
 */
export function ContributionBar({
  parts,
}: {
  parts: { code: number; weighted: number | null; weight: number | null; grade: number | null }[]
}) {
  const palette = ['#0ea5e9', '#6366f1', '#14b8a6', '#8b5cf6', '#0284c7', '#4f46e5', '#0d9488']
  const counted = parts.filter((p) => (p.weight ?? 0) > 0)
  const max = Math.max(100, counted.reduce((s, p) => s + (p.weight ?? 0) * 100, 0))
  return (
    <div className="relative" style={{ direction: 'ltr' }}>
      <div className="relative flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100">
        {counted.map((p, i) => {
          const got = p.weighted ?? 0
          const possible = (p.weight ?? 0) * 100
          return (
            <div
              key={p.code}
              className="relative h-full border-l border-white/70"
              style={{ width: `${(possible / max) * 100}%` }}
              title={`${p.code}: ${fmt(p.grade)} × ${Math.round((p.weight ?? 0) * 100)}% = ${fmt(got, 1)}`}
            >
              <div
                className="h-full"
                style={{ width: `${possible ? (got / possible) * 100 : 0}%`, background: palette[i % palette.length] }}
              />
            </div>
          )
        })}
      </div>
      <div className="absolute -top-1 bottom-[-4px] w-px bg-rose-500" style={{ left: `${(55 / max) * 100}%` }} title="55 — ציון עובר" />
    </div>
  )
}

/**
 * פס משקלים של מקצוע במצפן — חייב להתמלא בדיוק ל-100%. קבוצת שאלונים
 * שקולים מגיעה כקטע אחד, והתווית שלה "14331 / 14383".
 */
export function WeightBar({ weights }: { weights: { code: number | string; weight: number | null }[] }) {
  const palette = ['#0ea5e9', '#6366f1', '#14b8a6', '#8b5cf6', '#0284c7', '#4f46e5', '#0d9488']
  const counted = weights.filter((w) => (w.weight ?? 0) > 0)
  const total = counted.reduce((s, w) => s + (w.weight ?? 0), 0)
  const scale = Math.max(1, total)
  return (
    <div className="flex h-9 w-full overflow-hidden rounded-xl bg-slate-100 ring-1 ring-inset ring-slate-200" style={{ direction: 'ltr' }}>
      {counted.map((w, i) => (
        <div
          key={w.code}
          className="flex flex-col items-center justify-center border-l-2 border-white text-[11px] font-bold leading-tight text-white"
          style={{ width: `${((w.weight ?? 0) / scale) * 100}%`, background: palette[i % palette.length] }}
          title={`${w.code} · ${Math.round((w.weight ?? 0) * 100)}%`}
        >
          <span className="tabular-nums">{w.code}</span>
          <span className="tabular-nums opacity-90">{Math.round((w.weight ?? 0) * 100)}%</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────── מצבים ───────────────────────────────

export function Loading({ label = 'טוען את נתוני הבגרות…' }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-3 p-16 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
      {label}
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="m-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <strong className="font-bold">שגיאה: </strong>
      {message}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="m-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <div className="text-lg font-bold text-slate-700">{title}</div>
      {children && <div className="max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  )
}
