// מעקב ותכנון תקציב — החישובים של הרעיונות מ-21.10 (decisions/025). פונקציות
// טהורות, בלי גישה למסד; הנתונים — מהמעטפת (BudgetShell) ומ-lib/budgetTracking.
//
//   · צפי עונתי — "מה שנשאר השנה, כמו אותם חודשים בשנה שעברה" (רעיון 4)
//   · הזמנות פתוחות — כסף שכבר מחויב ועוד לא נרשם (רעיון 1)
//   · חריגות לטיפול — כללים קבועים, שקופים (רעיון 3)
//   · מה השתנה מאז העדכון הקודם — מול תמונת המצב (רעיון 2)
//   · סימולציית תקציב — "מה אם" על התכנית לשנה הבאה, בלי לשמור (רעיון 6)
//
// ⚠️ סימנים: כמו ב-budgetCalc — הכנסות = Σ זכות, הוצאות = Σ חובה, הכול חיובי.
import type { BudgetOrder, MonthlyRow } from './budget'
import { periodRange, type CardRow, type Period } from './budgetCalc'

// ─────────────────────────────── צפי עונתי ───────────────────────────────

export interface SeasonalSuggestion {
  income: number | null
  expense: number | null
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * הצעת צפי עונתית לכל כרטיס: מה שנרשם עד תאריך הנתונים, ועוד — לכל חודש שנשאר
 * בתקופה — מה שנרשם באותו חודש בשנה שעברה (בחודש הנוכחי — החלק שנשאר ממנו).
 * תנועה שכבר נרשמה מראש לחודש עתידי ("שכר דירה 12.2026") — נספרת במקום השנה
 * שעברה אם היא גדולה יותר, כדי לא לספור פעמיים.
 *
 * null — אין לשנה שעברה נתונים לחודשים שנשארו (הנתונים מתחילים אחריהם), ואז
 * המסך נשאר עם ההצעה לפי הקצב. כך גם כשהתקופה הסתיימה.
 */
export function seasonalSuggestions(
  current: MonthlyRow[],
  previous: MonthlyRow[],
  asOf: string | null,
  year: number,
  period: Period,
): Map<string, SeasonalSuggestion> | null {
  if (!asOf) return null
  const { from, to } = periodRange(year, period)
  const at = new Date(asOf)
  const end = new Date(to)
  if (at >= end) return null
  // יש לשנה שעברה נתונים מהחודש של תאריך הנתונים? אחרת — אין על מה להישען
  const prevStart = new Date(at.getFullYear() - 1, at.getMonth(), 1)
  const earliest = previous.reduce<string | null>((m, r) => (!m || r.month < m ? r.month : m), null)
  if (!earliest || new Date(earliest) > prevStart) return null

  const atKey = monthKey(at)
  const dayShare = 1 - (at.getDate() - 1) / new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate()
  const cur = new Map<string, Map<string, MonthlyRow>>()
  for (const r of current) {
    if (!cur.has(r.card_code)) cur.set(r.card_code, new Map())
    cur.get(r.card_code)!.set(r.month.slice(0, 7), r)
  }
  const prev = new Map<string, Map<string, MonthlyRow>>()
  for (const r of previous) {
    if (!prev.has(r.card_code)) prev.set(r.card_code, new Map())
    prev.get(r.card_code)!.set(r.month.slice(0, 7), r)
  }

  const out = new Map<string, SeasonalSuggestion>()
  for (const card of new Set([...cur.keys(), ...prev.keys()])) {
    let inc = 0
    let exp = 0
    const c = cur.get(card)
    const p = prev.get(card)
    for (let d = new Date(from); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const k = monthKey(d)
      const now = c?.get(k)
      if (k < atKey) {
        inc += now?.credit ?? 0
        exp += now?.debit ?? 0
        continue
      }
      const last = p?.get(monthKey(new Date(d.getFullYear() - 1, d.getMonth(), 1)))
      const share = k === atKey ? dayShare : 1
      // החודש הנוכחי: מה שכבר נרשם בו + החלק שנשאר ממנו לפי השנה שעברה
      if (k === atKey) {
        inc += (now?.credit ?? 0) + (last?.credit ?? 0) * share
        exp += (now?.debit ?? 0) + (last?.debit ?? 0) * share
      } else {
        inc += Math.max(now?.credit ?? 0, last?.credit ?? 0)
        exp += Math.max(now?.debit ?? 0, last?.debit ?? 0)
      }
    }
    out.set(card, { income: inc ? Math.round(inc) : null, expense: exp ? Math.round(exp) : null })
  }
  return out
}

// ─────────────────────────────── הזמנות פתוחות ───────────────────────────────

/**
 * כסף שכבר מחויב ועוד לא נרשם: "לא סופק" בדוח ההזמנות, לכל כרטיס. ⚠️ ההנחה —
 * "לא סופק" הוא החלק של ההזמנה שעוד לא הגיעה עליו חשבונית. דוח ההזמנות עוד לא
 * התקבל (023), ולכן זה ייבדק כשיגיע. הזמנה שבוטלה — לפי הסטטוס.
 */
export function openOrdersByCard(orders: BudgetOrder[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const o of orders) {
    if (!o.card_code || !o.not_supplied || o.not_supplied <= 0) continue
    if (o.status && /בוטל|מבוטל|סגור|cancel/i.test(o.status)) continue
    out.set(o.card_code, (out.get(o.card_code) ?? 0) + o.not_supplied)
  }
  return out
}

// ─────────────────────────────── חריגות ───────────────────────────────

export type ExceptionKind =
  | 'over_budget'
  | 'committed_over_budget'
  | 'forecast_over_budget'
  | 'ahead_of_pace'
  | 'income_lagging'
  | 'no_budget'
  | 'meitar_not_booked'

export const EXCEPTION_META: Record<ExceptionKind, { label: string; tone: 'red' | 'amber'; hint: string }> = {
  over_budget: { label: 'הוצאה מעל התקציב', tone: 'red', hint: 'ההוצאה המצטברת כבר עברה את תקציב ההוצאות.' },
  committed_over_budget: { label: 'מחויב מעל התקציב', tone: 'red', hint: 'מצטבר + הזמנות פתוחות עוברים את התקציב — הגרעון יגיע עם החשבוניות.' },
  forecast_over_budget: { label: 'צפי לחריגה', tone: 'amber', hint: 'הצפי לסוף השנה (מוקלד, או לפי השנה שעברה / הקצב) מעל התקציב ביותר מ-5%.' },
  ahead_of_pace: { label: 'מוציא מהר מהקצב', tone: 'amber', hint: 'כרטיס בלי נתונים בשנה שעברה: אחוז הביצוע גבוה ב-15 נקודות או יותר מהחלק של השנה שחלף.' },
  income_lagging: { label: 'הכנסה צפויה לפגר', tone: 'amber', hint: 'הצפי להכנסה בסוף השנה (מוקלד, או לפי השנה שעברה) נמוך מהתקציב ביותר מ-15%. כרטיס בלי נתונים בשנה שעברה — לפי הקצב, מהחודש השלישי.' },
  no_budget: { label: 'הוצאה בלי תקציב', tone: 'amber', hint: 'נרשמו הוצאות בכרטיס שאין לו תקציב הוצאות.' },
  meitar_not_booked: { label: 'כסף ממשרד החינוך שלא נרשם', tone: 'amber', hint: 'לפי המיתר מגיע לנושא כסף שעוד לא נרשם בהנהלת החשבונות — כשחודש החישוב ותיק משלושה חודשים (פער של חודשיים-שלושה צפוי).' },
}

/** סכומים קטנים מזה — לא חריגה (רעש של כמה שקלים) */
export const EXCEPTION_MIN = 5_000

export interface BudgetException {
  /** כרטיס, או 'topic:<קוד>' לנושא מיתר */
  key: string
  kind: ExceptionKind
  title: string
  /** הסכום שמאחורי החריגה — "בדקתי" נשמר איתו, ושינוי של יותר מ-5% פותח מחדש */
  value: number
  detail: string
  row?: CardRow
}

const ils = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 })
const m = (n: number) => `₪${ils.format(Math.round(n))}`
const p = (n: number) => `${Math.round(n * 100)}%`

/**
 * החריגות של הכרטיסים. כל כרטיס — לכל היותר חריגה אחת מכל סוג; "מעל התקציב"
 * מבטל את "מחויב", "צפי" ו"קצב" (הם כבר קרו). הצפי — המוקלד, אחרת ההצעה
 * (עונתית כשיש, אחרת לפי הקצב — suggestedBy).
 */
export function cardExceptions(
  rows: CardRow[],
  elapsed: number,
  openOrders: Map<string, number>,
): BudgetException[] {
  const pace = elapsed / 12
  const out: BudgetException[] = []
  for (const r of rows) {
    const b = r.budgetExpense ?? 0
    const exp = r.cumExpense
    const open = openOrders.get(r.code) ?? 0
    if (r.isExpense && b > 0) {
      if (exp > b && exp - b >= EXCEPTION_MIN / 5) {
        out.push({ key: r.code, kind: 'over_budget', title: r.name, value: exp, row: r,
          detail: `הוצאה ${m(exp)} מתוך תקציב ${m(b)} — חריגה של ${m(exp - b)} (${p(exp / b)})` })
        continue
      }
      if (open && exp + open > b) {
        out.push({ key: r.code, kind: 'committed_over_budget', title: r.name, value: exp + open, row: r,
          detail: `מצטבר ${m(exp)} + הזמנות פתוחות ${m(open)} = ${m(exp + open)}, תקציב ${m(b)}` })
      }
      const fc = r.forecastExpense ?? r.suggestedExpense
      if (fc != null && fc > b * 1.05 && fc - b >= EXCEPTION_MIN) {
        out.push({ key: r.code, kind: 'forecast_over_budget', title: r.name, value: fc, row: r,
          detail: `צפי ${m(fc)}${r.forecastExpense == null ? ` (${r.suggestedBy === 'season' ? 'לפי השנה שעברה' : 'לפי הקצב'})` : ''} מול תקציב ${m(b)} — חריגה צפויה של ${m(fc - b)}` })
      } else if (r.suggestedBy === 'pace' && r.forecastExpense == null && elapsed >= 1 && elapsed < 11.5 && b >= EXCEPTION_MIN * 2 && exp / b > pace + 0.15) {
        // רק בלי נתוני שנה שעברה: עם צפי עונתי — "צפי לחריגה" כבר אומר את זה, בלי רעש של עונתיות
        out.push({ key: r.code, kind: 'ahead_of_pace', title: r.name, value: exp, row: r,
          detail: `${p(exp / b)} מהתקציב אחרי ${p(pace)} מהשנה` })
      }
    } else if (r.isExpense && !b && exp >= EXCEPTION_MIN) {
      out.push({ key: r.code, kind: 'no_budget', title: r.name, value: exp, row: r, detail: `הוצאות ${m(exp)} בלי תקציב הוצאות` })
    }
    const bi = r.budgetIncome ?? 0
    if (r.isIncome && bi >= EXCEPTION_MIN * 2 && elapsed < 11.5) {
      // הכנסות ממשרד החינוך מגיעות בגלים — לא מול קצב קבוע, אלא מול הצפי לסוף השנה
      const fc = r.forecastIncome ?? (r.suggestedBy === 'season' ? r.suggestedIncome : null)
      if (fc != null) {
        if (fc < bi * 0.85 && bi - fc >= EXCEPTION_MIN * 2) {
          out.push({ key: r.code, kind: 'income_lagging', title: r.name, value: fc, row: r,
            detail: `צפי הכנסה ${m(fc)}${r.forecastIncome == null ? ' (לפי השנה שעברה)' : ''} מול תקציב ${m(bi)} — חסרים ${m(bi - fc)}` })
        }
      } else if (elapsed >= 3 && r.cumIncome / bi < pace - 0.25) {
        out.push({ key: r.code, kind: 'income_lagging', title: r.name, value: r.cumIncome, row: r,
          detail: `${p(r.cumIncome / bi)} מתקציב ההכנסות (${m(r.cumIncome)} מתוך ${m(bi)}) אחרי ${p(pace)} מהשנה` })
      }
    }
  }
  return out
}

/** נושאי מיתר: מגיע לפי המיתר, ולא נרשם — כשחודש החישוב ותיק משלושה חודשים */
export function meitarExceptions(
  topics: { code: string; name: string; computed: number | null; booked: number | null }[],
  calcMonth: string | null,
  asOf: string | null,
): BudgetException[] {
  if (!calcMonth || !asOf) return []
  const calc = new Date(calcMonth)
  const at = new Date(asOf)
  const months = (at.getFullYear() - calc.getFullYear()) * 12 + (at.getMonth() - calc.getMonth())
  if (months < 3) return []
  return topics
    .filter((t) => t.computed != null && t.computed - (t.booked ?? 0) >= Math.max(EXCEPTION_MIN, t.computed * 0.1))
    .map((t) => ({
      key: `topic:${t.code}`, kind: 'meitar_not_booked' as const, title: `${t.code} · ${t.name}`, value: t.computed!,
      detail: `מחושב במיתר ${m(t.computed!)}, נרשם ${m(t.booked ?? 0)} — טרם נרשם ${m(t.computed! - (t.booked ?? 0))}`,
    }))
}

/** "בדקתי" עדיין תקף? — אם הסכום לא השתנה ביותר מ-5% */
export function reviewStillValid(reviewed: number | null, now: number): boolean {
  if (reviewed == null) return false
  if (reviewed === 0) return now === 0
  return Math.abs(now - reviewed) / Math.abs(reviewed) <= 0.05
}

// ─────────────────────────────── מה השתנה ───────────────────────────────

export interface CardChange {
  code: string
  name: string
  /** כמה השתנה מאז התמונה הקודמת — הכנסות (Σ זכות) והוצאות (Σ חובה) */
  dIncome: number
  dExpense: number
}

/**
 * מה השתנה בכל כרטיס בין התמונה הקודמת להיום — רק בחודשים שבטווח התמונה
 * (מה שנדרס בקליטה), כדי שתנועה ותיקה שמחוץ לטווח לא תיראה "חדשה".
 */
export function cardChanges(
  current: MonthlyRow[],
  snapshot: { card_code: string; month: string; debit: number; credit: number }[],
  range: { from: string; to: string },
  names: Map<string, string>,
): CardChange[] {
  const inRange = (month: string) => month.slice(0, 7) >= range.from.slice(0, 7) && month.slice(0, 7) <= range.to.slice(0, 7)
  const by = new Map<string, CardChange>()
  const get = (code: string) => {
    if (!by.has(code)) by.set(code, { code, name: names.get(code) ?? '', dIncome: 0, dExpense: 0 })
    return by.get(code)!
  }
  for (const r of current) {
    if (!inRange(r.month)) continue
    const c = get(r.card_code)
    c.dIncome += r.credit
    c.dExpense += r.debit
  }
  for (const r of snapshot) {
    if (!inRange(r.month)) continue
    const c = get(r.card_code)
    c.dIncome -= Number(r.credit)
    c.dExpense -= Number(r.debit)
  }
  return [...by.values()]
    .filter((c) => Math.abs(c.dIncome) >= 1 || Math.abs(c.dExpense) >= 1)
    .sort((a, b) => Math.abs(b.dIncome) + Math.abs(b.dExpense) - (Math.abs(a.dIncome) + Math.abs(a.dExpense)))
}

// ─────────────────────────────── סימולציית תקציב ───────────────────────────────

export type BaseSource = 'plan' | 'forecast' | 'season' | 'pace' | 'budget' | 'none'
export const BASE_SOURCE_LABELS: Record<BaseSource, string> = {
  plan: 'תכנית', forecast: 'צפי', season: 'צפי לפי השנה שעברה', pace: 'צפי לפי הקצב', budget: 'תקציב', none: '—',
}

export interface ScenarioCard {
  code: string
  name: string
  isIncome: boolean
  isExpense: boolean
  /** הבסיס לכל צד, ומאיפה הוא נלקח */
  income: number
  expense: number
  incomeFrom: BaseSource
  expenseFrom: BaseSource
  /** לא מסומן "הכנסה" ולא "הוצאה" בתוספתיים — הצד נקבע לפי הנתונים */
  unflagged: boolean
  /** קיים רק בתוספתיים, בלי שורה בדוח הכרטיסים (לעתים — מספר סעיף שגוי) */
  onlyExtras: boolean
}

export interface ScenarioBase {
  key: string
  label: string
  income: number
  expense: number
  /** כמה כרטיסים בקטגוריה */
  cards: number
  items: ScenarioCard[]
}

/** הבסיס לצד אחד של כרטיס: תכנית ← צפי ← הצעת צפי ← תקציב */
function sideBase(next: number | null, forecast: number | null, suggested: number | null, by: 'season' | 'pace', budget: number | null): [number, BaseSource] {
  // || 0 — בלי "‎-0" (תקציב הוצאות 0 אחרי היפוך הסימן)
  if (next != null) return [next || 0, 'plan']
  if (forecast != null) return [forecast || 0, 'forecast']
  if (suggested != null) return [suggested || 0, by]
  if (budget != null) return [budget || 0, 'budget']
  return [0, 'none']
}

/**
 * הבסיס לסימולציה לכל קטגוריה 1 ולכל כרטיס בה: התכנית לשנה הבאה כשהוזנה, אחרת
 * הצפי (המוקלד, או ההצעה), אחרת התקציב של השנה. צד שהכרטיס אינו מסומן בו — 0.
 */
export function scenarioBase(rows: CardRow[]): { groups: ScenarioBase[]; fromPlan: number; fromForecast: number } {
  const by = new Map<string, ScenarioBase>()
  let fromPlan = 0
  let fromForecast = 0
  for (const r of rows) {
    const key = r.meta?.category1?.trim() || '(לא סווג)'
    const g = by.get(key) ?? { key, label: key, income: 0, expense: 0, cards: 0, items: [] }
    g.cards++
    // כרטיס שאינו מסומן באף צד (שני הדגלים כבויים בתוספתיים) — הצד לפי הנתונים, כדי
    // שלא ייעלם מהסימולציה: במנשה, שני כרטיסי "חינוך קדם יסודי" עם תקציב הוצאות ותכנית 90,000
    const unflagged = !r.isIncome && !r.isExpense
    const has = (...v: (number | null)[]) => v.some((x) => x != null && x !== 0)
    const incSide = r.isIncome || (unflagged && has(r.nextIncome, r.forecastIncome, r.budgetIncome, r.cumIncome))
    const expSide = r.isExpense || (unflagged && has(r.nextExpense, r.forecastExpense, r.budgetExpense, r.cumExpense))
    const [inc, incomeFrom] = incSide ? sideBase(r.nextIncome, r.forecastIncome, r.suggestedIncome, r.suggestedBy, r.budgetIncome) : [0, 'none' as const]
    const [exp, expenseFrom] = expSide ? sideBase(r.nextExpense, r.forecastExpense, r.suggestedExpense, r.suggestedBy, r.budgetExpense) : [0, 'none' as const]
    if (r.nextIncome != null || r.nextExpense != null) fromPlan++
    else fromForecast++
    g.income += inc
    g.expense += exp
    g.items.push({ code: r.code, name: r.name, isIncome: incSide, isExpense: expSide, income: inc, expense: exp, incomeFrom, expenseFrom,
      unflagged, onlyExtras: r.card == null })
    by.set(key, g)
  }
  for (const g of by.values()) g.items.sort((a, b) => b.income + b.expense - (a.income + a.expense))
  return { groups: [...by.values()].sort((a, b) => b.expense + b.income - (a.expense + a.income)), fromPlan, fromForecast }
}

// ── השינויים בסימולציה

/**
 * מה שהוקלד לכרטיס בצד אחד: "+20%" / "-5%" / "20%" — אחוז, נוסף על הקטגוריה;
 * "150000" / "150,000" — סכום שמחליף את הבסיס (ואת האחוזים). ריק — אין שינוי.
 */
export type CardInput = { pct: number } | { amount: number } | { invalid: true } | null

export function parseCardInput(text: string | undefined): CardInput {
  const t = (text ?? '').replace(/[,₪\s]/g, '')
  if (!t) return null
  const pct = t.match(/^([+-]?\d+(?:\.\d+)?)%$/)
  if (pct) return { pct: Number(pct[1]) }
  const n = Number(t)
  if (Number.isFinite(n) && n >= 0) return { amount: n }
  return { invalid: true }
}

export interface ScenarioInputs {
  /** אחוז לקטגוריה (ו-'*' לכולן), לכל צד */
  categories: Record<string, { inc: number; exp: number }>
  /** מה שהוקלד לכל כרטיס — טקסט, לכל צד */
  cards: Record<string, { inc?: string; exp?: string }>
}

export interface ScenarioResult {
  /** לכל קטגוריה: הסכומים בסימולציה, וכמה כרטיסים שונו בה */
  groups: Map<string, { income: number; expense: number; changedCards: number }>
  /** לכל כרטיס: הסכום בסימולציה לכל צד */
  cards: Map<string, { income: number; expense: number }>
  income: number
  expense: number
}

/**
 * הסימולציה: לכל כרטיס, בשני הצדדים — סכום שהוקלד גובר על הכול; אחרת בסיס × (1 + אחוז הכרטיס)
 * × (1 + אחוז הקטגוריה) × (1 + אחוז הכלל). הקטגוריה והסה"כ — סכום הכרטיסים.
 */
export function applyScenario(groups: ScenarioBase[], inputs: ScenarioInputs): ScenarioResult {
  const all = inputs.categories['*'] ?? { inc: 0, exp: 0 }
  const out: ScenarioResult = { groups: new Map(), cards: new Map(), income: 0, expense: 0 }
  for (const g of groups) {
    const cat = inputs.categories[g.key] ?? { inc: 0, exp: 0 }
    const sum = { income: 0, expense: 0, changedCards: 0 }
    for (const c of g.items) {
      const side = (base: number, raw: string | undefined, catPct: number, allPct: number): [number, boolean] => {
        const x = parseCardInput(raw)
        if (x && 'amount' in x) return [x.amount, true]
        const own = x && 'pct' in x ? x.pct : 0
        return [base * (1 + own / 100) * (1 + catPct / 100) * (1 + allPct / 100), Boolean(x && 'pct' in x && x.pct)]
      }
      // שני הצדדים לכל כרטיס (22.10): בצד שאין בו בסיס — 0, ואחוז לא משנה אותו; סכום
      // חדש כן (למשל הוצאה חדשה בכרטיס שאין לו הוצאות)
      const [inc, ci] = side(c.income, inputs.cards[c.code]?.inc, cat.inc, all.inc)
      const [exp, ce] = side(c.expense, inputs.cards[c.code]?.exp, cat.exp, all.exp)
      out.cards.set(c.code, { income: inc, expense: exp })
      sum.income += inc
      sum.expense += exp
      if (ci || ce) sum.changedCards++
    }
    out.groups.set(g.key, sum)
    out.income += sum.income
    out.expense += sum.expense
  }
  return out
}
