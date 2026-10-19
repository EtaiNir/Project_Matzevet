// ספירות למסך הגרפים — אותו רעיון כמו מנוע הפיבוטים (lib/pivot.ts), על
// הנתונים שכבר בזיכרון. כאן ספירה לפי שדה אחד, עם פיצול אופציונלי לפי שני.

import { BLANK } from './pivot'

type Row = Record<string, unknown>

export interface Bucket {
  key: string
  n: number
  /** פיצול לפי השדה השני: ערך → ספירה */
  split?: Map<string, number>
}

export function keyOf(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim()
  return s === '' ? BLANK : s
}

/** מיון "טבעי": שכבות (א…יב), כיתות (ז-2 לפני ז-10), "(ריק)" אחרון */
export function naturalCompare(a: string, b: string): number {
  if (a === BLANK) return 1
  if (b === BLANK) return -1
  return a.localeCompare(b, 'he', { numeric: true })
}

/**
 * ספירה לפי שדה. `order: 'count'` — מהגדול לקטן; `'natural'` — לפי הערך
 * (לשכבות ולגדלים). `blank: false` — בלי "(ריק)" (לשדות שרוב הערכים בהם ריקים).
 */
export function countBy(
  rows: Row[],
  field: string,
  opts: { splitBy?: string; order?: 'count' | 'natural'; blank?: boolean } = {},
): Bucket[] {
  const map = new Map<string, Bucket>()
  for (const r of rows) {
    const k = keyOf(r[field])
    if (k === BLANK && opts.blank === false) continue
    let b = map.get(k)
    if (!b) map.set(k, (b = { key: k, n: 0, split: opts.splitBy ? new Map() : undefined }))
    b.n++
    if (opts.splitBy) {
      const s = keyOf(r[opts.splitBy])
      b.split!.set(s, (b.split!.get(s) ?? 0) + 1)
    }
  }
  const out = [...map.values()]
  return opts.order === 'natural'
    ? out.sort((a, b) => naturalCompare(a.key, b.key))
    : out.sort((a, b) => b.n - a.n || naturalCompare(a.key, b.key))
}

/** הערכים של שדה הפיצול, מהשכיח לנדיר — לסדר הצבעים והמקרא */
export function splitKeys(buckets: Bucket[]): string[] {
  const total = new Map<string, number>()
  for (const b of buckets) for (const [k, n] of b.split ?? []) total.set(k, (total.get(k) ?? 0) + n)
  return [...total.entries()].sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0])).map(([k]) => k)
}

/**
 * N הראשונים, והשאר מקובצים ל"אחר" — כדי ש-130 מוסדות לא יהפכו לגרף של
 * 130 פסים. "אחר" אינו לחיץ (אין לו ערך אחד לסנן לפיו).
 */
export const OTHER = 'אחר'
export function topN(buckets: Bucket[], n: number): Bucket[] {
  if (buckets.length <= n + 1) return buckets
  const rest = buckets.slice(n)
  const split = new Map<string, number>()
  for (const b of rest) for (const [k, v] of b.split ?? []) split.set(k, (split.get(k) ?? 0) + v)
  return [...buckets.slice(0, n), { key: OTHER, n: rest.reduce((s, b) => s + b.n, 0), split: rest[0].split ? split : undefined }]
}

/**
 * גודלי כיתות: כמה תלמידים בכל כיתה (מוסד + כיתה משולבת). כיתה בלי שם
 * אינה נספרת — אין לה גודל.
 */
export interface ClassSize {
  school: string
  className: string
  n: number
}
export function classSizes(rows: Row[]): ClassSize[] {
  const map = new Map<string, ClassSize>()
  for (const r of rows) {
    const cls = keyOf(r['KITA_MESHULEVET'])
    if (cls === BLANK) continue
    const school = keyOf(r['SHEM_MOSAD'])
    const id = `${r['SEMEL_MOSAD'] ?? school}|${cls}`
    const c = map.get(id) ?? { school, className: cls, n: 0 }
    c.n++
    map.set(id, c)
  }
  return [...map.values()]
}

/** טווחי גודל כיתה — לגרף ההתפלגות */
export const CLASS_SIZE_BINS: { label: string; min: number; max: number }[] = [
  { label: 'עד 10', min: 1, max: 10 },
  { label: '11–20', min: 11, max: 20 },
  { label: '21–25', min: 21, max: 25 },
  { label: '26–30', min: 26, max: 30 },
  { label: '31–34', min: 31, max: 34 },
  { label: '35+', min: 35, max: Infinity },
]

// ─── צבעים — אותו ערך באותו צבע בכל גרף ───

export const PALETTE = ['#0284c7', '#f59e0b', '#10b981', '#8b5cf6', '#f43f5e', '#14b8a6', '#64748b', '#eab308', '#ec4899', '#84cc16']
/** צבעים קבועים לערכים שחוזרים — אותו ערך באותו צבע בכל גרף */
const FIXED: Record<string, string> = {
  זכר: '#0284c7',
  נקבה: '#f472b6',
  [BLANK]: '#cbd5e1',
  [OTHER]: '#94a3b8',
}
export function colorFor(key: string, i: number): string {
  return FIXED[key] ?? PALETTE[i % PALETTE.length]
}
