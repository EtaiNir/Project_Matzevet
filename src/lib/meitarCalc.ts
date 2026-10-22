// חישובי המיתר בצד הלקוח — פונקציות טהורות, בלי גישה למסד.
//
// שלוש שכבות בכל רגע (פגישת 10.9 עם סבא): **מצטבר מספטמבר · החודש · הפרש**.
// כאן:
//   מצטבר   = Σ סכום מחושב של חודשי התחולה בשנה"ל, ב-run של החודש שנבחר
//   החודש    = Σ הפרש מחושב בשנה"ל — מה שנוסף בחודש הזה
//   רטרו     = Σ הפרש של חודשי תחולה מהשנה הקודמת (נשמרים ומסומנים — אייל, 22.10)
// הקצב: החודש בתקופה מתוך 12 (בשנה"ל — ספט׳=1, כמו "חודש בשנהל" באקסס).
//
// שתי תקופות, כמו בכל מודול התקציב (הבורר בכותרת):
//   שנה"ל     — המצטבר מקובץ המשרד: Σ סכום מחושב בשנה"ל (זהה לטבלה 99 באקסס)
//   קלנדרית   — המצטבר = Σ מה שנכנס בכל חודש מינואר (הפרש + רטרו): מה שהמועצה קיבלה
//               בשנת התקציב שלה. קובץ המשרד מתאפס בספטמבר, ולכן אין "מצטבר" אחר
import type { InvoiceMonth, MeitarTopic, MonthTopic, TopicPlan } from './meitar'

export type MeitarPeriod = 'calendar' | 'school'

export interface TopicRow {
  code: string
  name: string
  group: string | null
  category: string | null
  isNew: boolean
  /** מצטבר מתחילת שנה"ל עד החודש */
  cum: number
  /** המצטבר בחודש הקודם (סכום מחושב קודם) */
  prevCum: number
  /** מה שנוסף החודש, בשנה"ל */
  diff: number
  /** רטרו לשנה"ל הקודמת — החודש */
  priorDiff: number
  /** רטרו לשנה"ל הקודמת — מתחילת השנה עד החודש */
  priorYtd: number
  /** החשבונית: הפרש לתשלום, מתוכו תחולה שאינה החודש, מתוכו שנה קודמת */
  toPay: number | null
  retro: number | null
  invoicePrior: number | null
  plan: TopicPlan | null
  /** מצטבר / תקציב */
  usage: number | null
  /** צפי לפי הקצב: מצטבר × 12 / החודש בשנה"ל — הצעה בלבד */
  suggested: number | null
  booked: number | null
  /** התאמה: החשבונית מול הפירוט (החודש + רטרו) */
  match: 'ok' | 'gap' | 'no-detail' | 'no-invoice' | null
  matchGap: number | null
  /** מה נכנס בכל חודש של שנה"ל (החודש + רטרו), ספט׳…אוג׳ */
  series: number[]
}

export function buildTopicRows(opts: {
  month: string
  /** 12 החודשים של התקופה (periodMonths) */
  months12: string[]
  period: MeitarPeriod
  monthTopics: MonthTopic[]
  invoiceMonths: InvoiceMonth[]
  topics: Map<string, MeitarTopic>
  plans: Map<string, TopicPlan>
  booked: Map<string, { booked: number }> | null
  withInvoice: boolean
}): TopicRow[] {
  const { month, months12, period, monthTopics, invoiceMonths, topics, plans, booked, withInvoice } = opts
  const mi = Math.max(1, months12.indexOf(month) + 1)
  const codes = new Set<string>()
  for (const r of monthTopics) if (r.computed || r.diff || r.prior_diff) codes.add(r.topic_code)
  for (const r of invoiceMonths) if (r.calc_month === month && r.to_pay) codes.add(r.topic_code)
  for (const c of plans.keys()) codes.add(c)

  const at = new Map<string, MonthTopic>()
  const series = new Map<string, number[]>()
  const priorYtd = new Map<string, number>()
  const incomeYtd = new Map<string, number>()   // קלנדרית: Σ מה שנכנס מתחילת התקופה
  for (const r of monthTopics) {
    const i = months12.indexOf(r.calc_month)
    if (i < 0) continue                           // מחוץ לתקופה (שנה"ל השנייה בטעינה הקלנדרית)
    if (r.calc_month === month) at.set(r.topic_code, r)
    const s = series.get(r.topic_code) ?? new Array(12).fill(0)
    s[i] += r.diff + r.prior_diff
    series.set(r.topic_code, s)
    if (r.calc_month <= month) {
      priorYtd.set(r.topic_code, (priorYtd.get(r.topic_code) ?? 0) + r.prior_diff)
      incomeYtd.set(r.topic_code, (incomeYtd.get(r.topic_code) ?? 0) + r.diff + r.prior_diff)
    }
  }
  const inv = new Map<string, InvoiceMonth>()
  for (const r of invoiceMonths) if (r.calc_month === month) inv.set(r.topic_code, r)

  return [...codes].map((code) => {
    const m = at.get(code)
    const i = inv.get(code)
    const t = topics.get(code)
    const plan = plans.get(code) ?? null
    const income = m ? m.diff + m.prior_diff : 0
    const cum = period === 'school' ? (m?.computed ?? 0) : (incomeYtd.get(code) ?? 0)
    const detail = m ? m.diff + m.prior_diff : null
    let match: TopicRow['match'] = null
    let matchGap: number | null = null
    if (withInvoice) {
      if (i && detail == null) match = 'no-detail'
      else if (!i && detail) match = 'no-invoice'
      else if (i && detail != null) {
        matchGap = detail - i.to_pay
        match = Math.abs(matchGap) < 1 ? 'ok' : 'gap'
      }
    }
    return {
      code,
      name: t?.name ?? `נושא ${code}`,
      group: t?.report_group ?? null,
      category: plan?.category ?? t?.category ?? null,
      isNew: Boolean(t?.is_new),
      cum,
      prevCum: period === 'school' ? (m?.computed_prev ?? 0) : cum - income,
      diff: m?.diff ?? 0,
      priorDiff: m?.prior_diff ?? 0,
      priorYtd: priorYtd.get(code) ?? 0,
      toPay: i?.to_pay ?? null,
      retro: i?.retro ?? null,
      invoicePrior: i?.prior ?? null,
      plan,
      usage: plan?.budget ? cum / plan.budget : null,
      suggested: cum && mi < 12 ? Math.round((cum * 12) / mi) : cum || null,
      booked: booked ? (booked.get(code)?.booked ?? null) : null,
      match,
      matchGap,
      series: series.get(code) ?? new Array(12).fill(0),
    }
  })
}

export interface MonthPoint {
  month: string
  /** Σ הפרש בשנה"ל */
  current: number
  /** Σ רטרו לשנה הקודמת */
  prior: number
  /** Σ מצטבר בסוף החודש */
  cum: number
}

/** הכנסות לפי חודש בתקופה — לגרף. חודש שלא נקלט: null */
export function monthSeries(monthTopics: MonthTopic[], months12: string[], period: MeitarPeriod): (MonthPoint | null)[] {
  const by = new Map<string, MonthPoint>()
  for (const r of monthTopics) {
    if (!months12.includes(r.calc_month)) continue
    const p = by.get(r.calc_month) ?? { month: r.calc_month, current: 0, prior: 0, cum: 0 }
    p.current += r.diff
    p.prior += r.prior_diff
    p.cum += r.computed
    by.set(r.calc_month, p)
  }
  const out = months12.map((m) => by.get(m) ?? null)
  if (period === 'calendar') {
    let run = 0
    for (const p of out) {
      if (!p) continue
      run += p.current + p.prior
      p.cum = run
    }
  }
  return out
}

export interface Totals {
  cum: number
  diff: number
  priorDiff: number
  priorYtd: number
  toPay: number
  budget: number
  forecast: number
  next: number
  booked: number
}

export function topicTotals(rows: TopicRow[]): Totals {
  const t: Totals = { cum: 0, diff: 0, priorDiff: 0, priorYtd: 0, toPay: 0, budget: 0, forecast: 0, next: 0, booked: 0 }
  for (const r of rows) {
    t.cum += r.cum
    t.diff += r.diff
    t.priorDiff += r.priorDiff
    t.priorYtd += r.priorYtd
    t.toPay += r.toPay ?? 0
    t.budget += r.plan?.budget ?? 0
    t.forecast += r.plan?.forecast ?? r.suggested ?? 0
    t.next += r.plan?.next_year ?? 0
    t.booked += r.booked ?? 0
  }
  return t
}
