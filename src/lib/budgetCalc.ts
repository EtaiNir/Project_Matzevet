// חישובי התקציב בצד הלקוח — פונקציות טהורות, בלי גישה למסד.
//
// המודל הוא של האקסס של סבא (טפסי "מעקב ותכנון תקציב", החלטה 023 §8):
// לכל כרטיס **שני צדדים זה לצד זה**, כל אחד מול התכנית שלו —
//   הכנסות מצטבר = Σ זכות בתקופה   מול  תקציב הכנסות
//   הוצאות מצטבר = Σ חובה בתקופה   מול  תקציב הוצאות
// לא ביצוע נטו בכיוון אחד. נבדק מול המסכים (21.10): כרטיס 1311000921, שנה"ל
// תשפ"ו — 807,925 / 76,026, בדיוק כמו באקסס; סה"כ הכנסות 83,273,562 — זהה.
//
// ⚠️ סימנים: בדוח הכרטיסים של EPR תקציב ההוצאות **שלילי**. כאן הוא מוצג
// בערך טבעי — **בהיפוך סימן** ב-buildRows, לא Math.abs. ראה מלכודת 41 ב-CLAUDE.md.
import type { BudgetCard, CardMeta, CardPlan, MonthlyRow } from './budget'

export type Direction = 'income' | 'expense'

/** מבנה הכרטיס באקסס של סבא: 3 + 4 + 3 ספרות (181 · 1000 · 110) */
export function splitCard(code: string): [string, string, string] {
  return [code.slice(0, 3), code.slice(3, 7), code.slice(7)]
}

/** הספרה השנייה: 13… הכנסות, 18… הוצאות (במבנה האחיד של משרד הפנים 1–5 = הכנסות) */
function incomeByCode(code: string): boolean {
  return Number(code[1] ?? '9') <= 5
}

export interface CardRow {
  code: string
  name: string
  parts: [string, string, string]
  /** הדגלים "הכנסה" / "הוצאה" — מהתוספתיים, אחרת לפי התקציב ומבנה הכרטיס */
  isIncome: boolean
  isExpense: boolean
  /** הצד העיקרי — לגרפים ולמיון */
  dir: Direction
  /** תקציב הכנסות / הוצאות (חיובי) — מ-EPR, ולכרטיס שאין לו שורה שם — מהתוספתיים */
  budgetIncome: number | null
  budgetExpense: number | null
  /** Σ זכות / Σ חובה בתקופה שנבחרה */
  cumIncome: number
  cumExpense: number
  /** אחוז ביצוע לכל צד — מצטבר / תקציב; null כשאין תקציב */
  pctIncome: number | null
  pctExpense: number | null
  /** צפי לסוף השנה — מה שהוקלד; ריק = אין */
  forecastIncome: number | null
  forecastExpense: number | null
  /** הצעה לצפי — עונתית כשיש לשנה שעברה נתונים, אחרת לפי הקצב (מצטבר × 12 / חודשים שחלפו). לא נשמרת */
  suggestedIncome: number | null
  suggestedExpense: number | null
  /** מאיפה ההצעה: 'season' — לפי אותם חודשים בשנה שעברה (024); 'pace' — לפי הקצב */
  suggestedBy: 'season' | 'pace'
  /** הזמנות פתוחות ("לא סופק" בדוח ההזמנות) — כסף שמחויב ועוד לא נרשם (024) */
  openOrders: number
  nextIncome: number | null
  nextExpense: number | null
  meta: CardMeta | null
  plan: CardPlan | null
  /** השורה מדוח הכרטיסים; null לכרטיס שקיים רק בתוספתיים */
  card: BudgetCard | null
}

export type Period = 'calendar' | 'school'

/**
 * חודשים שחלפו בתקופה עד **תאריך הנתונים** — לקצב ולהצעת הצפי. בדיוק של
 * ימים (19.10 = 9.6 חודשים בשנה קלנדרית); תקופה שהסתיימה — 12.
 *
 * ⚠️ לא לפי התנועה האחרונה: הנהלת החשבונות רושמת מראש תנועות עם תאריך
 * עתידי ("שרת 12.2026"), ולפיהן כל שנה נראית גמורה (מנשה, 20.10). תאריך
 * הנתונים נלקח משם דוח ה-EPR (budget_cards.as_of).
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

/** Σ זכות ו-Σ חובה לכל כרטיס בתקופה */
export function sidesFromMonthly(rows: MonthlyRow[]): Map<string, { credit: number; debit: number }> {
  const out = new Map<string, { credit: number; debit: number }>()
  for (const r of rows) {
    const t = out.get(r.card_code) ?? { credit: 0, debit: 0 }
    t.credit += r.credit
    t.debit += r.debit
    out.set(r.card_code, t)
  }
  return out
}

/**
 * שורות הטבלה הראשית: כל כרטיס שבדוח הכרטיסים **או** בתוספתיים (כמו הטבלה
 * הראשית באקסס, שנבנית מהתוספתיים).
 */
export function buildRows(
  cards: BudgetCard[],
  meta: Map<string, CardMeta>,
  plans: Map<string, CardPlan>,
  monthly: MonthlyRow[],
  elapsed: number,
  // 024 — אופציונלי: בלעדיהם ההצעה לפי הקצב, כמו שהיה
  seasonal?: Map<string, { income: number | null; expense: number | null }> | null,
  openOrders?: Map<string, number>,
): CardRow[] {
  const byCode = new Map(cards.map((c) => [c.card_code, c]))
  const codes = [...new Set([...byCode.keys(), ...meta.keys()])].sort()
  const sides = sidesFromMonthly(monthly)
  const pace = (v: number) => (elapsed > 0 && elapsed < 12 ? Math.round((v * 12) / elapsed) : Math.round(v))

  return codes.map((code) => {
    const card = byCode.get(code) ?? null
    const m = meta.get(code) ?? null
    const plan = plans.get(code) ?? null
    // היפוך סימן, לא ערך מוחלט: תקציב הוצאות חיובי ב-EPR הוא הוצאה שלילית
    // (1817320001 במנשה — ‎−10,000 גם בתוספתיים ובאקסס). Math.abs הפך אותו לחיובי.
    const budgetIncome = card ? (card.budget_income ?? null) : (plan?.plan_income ?? null)
    const budgetExpense = card ? (card.budget_expense == null ? null : -card.budget_expense) : (plan?.plan_expense ?? null)
    const s = sides.get(code) ?? { credit: 0, debit: 0 }
    const isIncome = m?.is_income ?? (Boolean(budgetIncome) || (!budgetExpense && incomeByCode(code)))
    const isExpense = m?.is_expense ?? (Boolean(budgetExpense) || (!budgetIncome && !incomeByCode(code)))
    return {
      code,
      name: card?.card_name ?? m?.card_name ?? '',
      parts: splitCard(code),
      isIncome,
      isExpense,
      dir: isIncome && !isExpense ? 'income' : 'expense',
      budgetIncome,
      budgetExpense,
      cumIncome: s.credit,
      cumExpense: s.debit,
      pctIncome: budgetIncome ? s.credit / budgetIncome : null,
      pctExpense: budgetExpense ? s.debit / budgetExpense : null,
      forecastIncome: plan?.forecast_income ?? null,
      forecastExpense: plan?.forecast_expense ?? null,
      suggestedIncome: seasonal ? (seasonal.get(code)?.income ?? (s.credit ? pace(s.credit) : null)) : s.credit ? pace(s.credit) : null,
      suggestedExpense: seasonal ? (seasonal.get(code)?.expense ?? (s.debit ? pace(s.debit) : null)) : s.debit ? pace(s.debit) : null,
      suggestedBy: seasonal?.has(code) ? 'season' : 'pace',
      openOrders: openOrders?.get(code) ?? 0,
      nextIncome: plan?.next_income ?? null,
      nextExpense: plan?.next_expense ?? null,
      meta: m,
      plan,
      card,
    }
  })
}

export interface Totals {
  budgetIncome: number
  budgetExpense: number
  cumIncome: number
  cumExpense: number
  /** צפי: מה שהוקלד, ולכרטיס בלי צפי — לפי הקצב */
  forecastIncome: number
  forecastExpense: number
  nextIncome: number
  nextExpense: number
  /** כמה כרטיסים חסר בהם צפי מוקלד (בצד שיש בו תנועה) */
  noForecast: number
  count: number
}

export function totals(rows: CardRow[]): Totals {
  const t: Totals = { budgetIncome: 0, budgetExpense: 0, cumIncome: 0, cumExpense: 0, forecastIncome: 0,
    forecastExpense: 0, nextIncome: 0, nextExpense: 0, noForecast: 0, count: rows.length }
  for (const r of rows) {
    t.budgetIncome += r.budgetIncome ?? 0
    t.budgetExpense += r.budgetExpense ?? 0
    t.cumIncome += r.cumIncome
    t.cumExpense += r.cumExpense
    t.forecastIncome += r.forecastIncome ?? r.suggestedIncome ?? 0
    t.forecastExpense += r.forecastExpense ?? r.suggestedExpense ?? 0
    if ((r.cumIncome && r.forecastIncome == null) || (r.cumExpense && r.forecastExpense == null)) t.noForecast += 1
    t.nextIncome += r.nextIncome ?? 0
    t.nextExpense += r.nextExpense ?? 0
  }
  return t
}

/** הכנסות (Σזכות) והוצאות (Σחובה) לפי חודש — לגרף העמודות */
export function monthlySeries(rows: MonthlyRow[], side: 'credit' | 'debit', from: string, only?: (card: string) => boolean): { key: string; n: number }[] {
  const start = new Date(from)
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    return { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, n: 0 }
  })
  for (const r of rows) {
    if (only && !only(r.card_code)) continue
    const b = buckets.find((x) => r.month.startsWith(x.iso))
    if (b) b.n += r[side]
  }
  return buckets.map((b) => ({ key: HEB_MONTHS[Number(b.iso.slice(5)) - 1], n: Math.round(b.n) }))
}

export const HEB_MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳']
export const HEB_MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

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
/** צבע אחוז הביצוע: מעל 100% אדום, מעל הקצב צהוב */
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
