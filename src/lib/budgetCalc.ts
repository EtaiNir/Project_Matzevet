// חישובי התקציב בצד הלקוח — פונקציות טהורות, בלי גישה למסד.
//
// ⚠️ סימנים: בקובצי EPR ההוצאות **שליליות** (תקציב הוצאות −1,135,000, ביצוע
// −745,393). האחסון נשאר כמו בקובץ; כאן הכול מוחזר בערך "טבעי" לתצוגה —
// תקציב והוצאה חיוביים, ניצול באחוזים. ראה מלכודת 41 ב-CLAUDE.md.
import type { BudgetCard, CardMeta, CardPlan, MonthlyRow } from './budget'

export type Direction = 'income' | 'expense'

/** מבנה הכרטיס באקסס של סבא: 3 + 4 + 3 ספרות (181 · 1000 · 110) */
export function splitCard(code: string): [string, string, string] {
  return [code.slice(0, 3), code.slice(3, 7), code.slice(7)]
}

/**
 * הכנסה או הוצאה. קודם לפי התקציב שבקובץ; לכרטיס בלי תקציב — לפי
 * הספרה השנייה (13… הכנסות, 18… הוצאות במנשה; במבנה האחיד של משרד הפנים
 * ספרה 1–5 היא צד ההכנסות). השערה מתועדת — לא נבדקה ברשות אחרת.
 */
export function directionOf(card: Pick<BudgetCard, 'card_code' | 'budget_income' | 'budget_expense'>): Direction {
  if (card.budget_income) return 'income'
  if (card.budget_expense) return 'expense'
  return Number(card.card_code[1] ?? '9') <= 5 ? 'income' : 'expense'
}

/** הערך לתצוגה: הכנסה כמו שהיא, הוצאה בהיפוך סימן */
export function natural(value: number | null | undefined, dir: Direction): number | null {
  if (value == null) return null
  return dir === 'income' ? value : -value
}

export interface CardRow {
  code: string
  name: string
  dir: Direction
  parts: [string, string, string]
  /** התקציב המאושר (022 §4 — אומת מול האקסס), בערך טבעי */
  budget: number | null
  /** הביצוע לתקופה שנבחרה, בערך טבעי */
  executed: number | null
  reserved: number | null
  /** ניצול = ביצוע / תקציב; null כשאין תקציב */
  usage: number | null
  /** מה שנשאר: תקציב − ביצוע − שריון */
  remaining: number | null
  forecast: number | null
  /** הצעה לצפי לפי הקצב — לא נשמרת */
  suggested: number | null
  nextYear: number | null
  meta: CardMeta | null
  plan: CardPlan | null
  card: BudgetCard
}

export type Period = 'calendar' | 'school'

/**
 * חודשים שחלפו בתקופה עד **תאריך הנתונים** — לקצב ולהצעת הצפי. בדיוק של
 * ימים (19.10 = 9.6 חודשים בשנה קלנדרית); תקופה שהסתיימה — 12.
 *
 * ⚠️ לא לפי התנועה האחרונה: הנהלת החשבונות רושמת מראש תנועות עם תאריך
 * עתידי ("שרת 12.2026"), ולפיהן כל שנה נראית גמורה — קצב 100%, והצפי יצא
 * שווה לביצוע עד היום (מנשה, 20.10). תאריך הנתונים = מתי נקלט דוח הכרטיסים.
 */
export function elapsedMonths(asOf: string | null, year: number, period: Period): number {
  if (!asOf) return 0
  const start = period === 'calendar' ? new Date(year, 0, 1) : new Date(year - 1, 8, 1)
  const end = new Date(start.getFullYear() + 1, start.getMonth(), 1)
  const at = Math.min(new Date(asOf).getTime(), end.getTime())
  const share = (at - start.getTime()) / (end.getTime() - start.getTime())
  return Math.max(0, Math.min(12, Math.round(share * 120) / 10))
}

/** גבולות התקופה: קלנדרית ינואר–דצמבר, שנת לימודים ספטמבר (של השנה הקודמת)–אוגוסט */
export function periodRange(year: number, period: Period): { from: string; to: string } {
  return period === 'calendar'
    ? { from: `${year}-01-01`, to: `${year + 1}-01-01` }
    : { from: `${year - 1}-09-01`, to: `${year}-09-01` }
}

/** ביצוע מהתנועות: Σ(זכות − חובה) לכל כרטיס (חתום כמו בקובץ) */
export function executedFromMonthly(rows: MonthlyRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) out.set(r.card_code, (out.get(r.card_code) ?? 0) + r.credit - r.debit)
  return out
}

export function buildRows(
  cards: BudgetCard[],
  meta: Map<string, CardMeta>,
  plans: Map<string, CardPlan>,
  opts: { period: Period; schoolExecuted?: Map<string, number>; elapsed: number },
): CardRow[] {
  return cards.map((card) => {
    const dir = directionOf(card)
    const budget = natural(dir === 'income' ? card.budget_income : card.budget_expense, dir)
    const rawExec = opts.period === 'school' ? (opts.schoolExecuted?.get(card.card_code) ?? null) : card.executed
    const executed = natural(rawExec, dir)
    const reserved = natural(card.reserved, dir)
    const plan = plans.get(card.card_code) ?? null
    const usage = budget && executed != null ? executed / budget : null
    const remaining = budget != null ? budget - (executed ?? 0) - (reserved ?? 0) : null
    const suggested = executed != null && opts.elapsed > 0 && opts.elapsed < 12 ? (executed * 12) / opts.elapsed : executed
    return {
      code: card.card_code,
      name: card.card_name ?? '',
      dir,
      parts: splitCard(card.card_code),
      budget,
      executed,
      reserved,
      usage,
      remaining,
      forecast: dir === 'income' ? (plan?.forecast_income ?? null) : (plan?.forecast_expense ?? null),
      suggested: suggested == null ? null : Math.round(suggested),
      nextYear: dir === 'income' ? (plan?.next_income ?? null) : (plan?.next_expense ?? null),
      meta: meta.get(card.card_code) ?? null,
      plan,
      card,
    }
  })
}

export interface Totals {
  budget: number
  executed: number
  reserved: number
  forecast: number
  nextYear: number
  /** כמה כרטיסים בלי צפי מוקלד — הצפי הכולל מניח עבורם את ההצעה */
  noForecast: number
}

export function totals(rows: CardRow[], dir: Direction): Totals {
  const t: Totals = { budget: 0, executed: 0, reserved: 0, forecast: 0, nextYear: 0, noForecast: 0 }
  for (const r of rows) {
    if (r.dir !== dir) continue
    t.budget += r.budget ?? 0
    t.executed += r.executed ?? 0
    t.reserved += r.reserved ?? 0
    if (r.forecast != null) t.forecast += r.forecast
    else {
      t.noForecast += 1
      t.forecast += r.suggested ?? 0
    }
    t.nextYear += r.nextYear ?? 0
  }
  return t
}

/** ביצוע לפי חודש (ערך טבעי) — לגרף העמודות */
export function monthlySeries(rows: MonthlyRow[], dirOf: (card: string) => Direction | undefined, dir: Direction, from: string): { key: string; n: number }[] {
  const start = new Date(from)
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    return { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, n: 0 }
  })
  for (const r of rows) {
    if (dirOf(r.card_code) !== dir) continue
    const b = buckets.find((x) => r.month.startsWith(x.iso))
    if (b) b.n += dir === 'income' ? r.credit - r.debit : r.debit - r.credit
  }
  return buckets.map((b) => ({ key: HEB_MONTHS[Number(b.iso.slice(5)) - 1], n: Math.round(b.n) }))
}

export const HEB_MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳']

// ── תצוגה ──

const ils = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 })
/** "9.6" — חודשים שחלפו, לתצוגה */
export function monthsLabel(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(1)
}

export function money(n: number | null | undefined): string {
  return n == null ? '' : ils.format(Math.round(n))
}
export function pct(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '' : `${Math.round(n * 100)}%`
}
/** צבע הניצול: מעל 100% אדום, מעל הקצב צהוב */
export function usageTone(usage: number | null, pace: number): string {
  if (usage == null) return 'text-slate-400'
  if (usage > 1) return 'text-red-700 font-bold'
  if (pace > 0 && usage > pace + 0.1) return 'text-amber-700 font-semibold'
  return 'text-slate-700'
}

/** שנת לימודים לפי שנת הסיום: 2027 → תשפ"ז */
export function hebrewSchoolYear(endYear: number): string {
  const n = endYear - 2027 + 787   // 2027 = תשפ"ז
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט']
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ']
  const rest = n % 100
  const low = rest === 15 ? 'טו' : rest === 16 ? 'טז' : tens[Math.floor(rest / 10)] + ones[rest % 10]
  const s = 'תש' + low.slice(0, -1) + '"' + low.slice(-1)
  return n >= 700 && n < 800 ? s : String(endYear)
}
