import { useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Card, Kpi } from '@/components/bagrut/ui'
import { ChartCard, Columns, HBars } from '@/components/charts/Charts'
import { money, monthlySeries, monthsLabel, pct, totals, type CardRow } from '@/lib/budgetCalc'
import type { Bucket } from '@/lib/charts'
import { useBudget } from './context'

const UNCATEGORIZED = '(לא סווג)'

/**
 * תמונת התקציב — הסיכום שבתחתית הטופס "מעקב ותכנון תקציב" באקסס, בגדול:
 * כל צד מול התקציב שלו (הכנסות = Σזכות, הוצאות = Σחובה), הקצב, הגרעון
 * בתקציב ובביצוע, והצפי — ואיפה יש חריגה. לחיצה על קטגוריה מסננת את הטבלה.
 */
export default function BudgetHome() {
  const b = useBudget()
  const navigate = useNavigate()
  const { search } = useLocation()
  const pace = b.elapsed / 12

  const t = useMemo(() => totals(b.rows), [b.rows])
  const months = useMemo(() => ({
    exp: monthlySeries(b.monthly, 'debit', b.periodFrom),
    inc: monthlySeries(b.monthly, 'credit', b.periodFrom),
  }), [b.monthly, b.periodFrom])

  // לפי קטגוריה 1: הוצאות מצטבר (Σחובה) והכנסות מצטבר (Σזכות) — כמו בטבלה הראשית
  const byCategory = (side: 'cumIncome' | 'cumExpense'): Bucket[] => {
    const m = new Map<string, number>()
    for (const r of b.rows) {
      const k = r.meta?.category1?.trim() || UNCATEGORIZED
      m.set(k, (m.get(k) ?? 0) + r[side])
    }
    return [...m].map(([key, n]) => ({ key, n: Math.round(n) })).filter((x) => x.n !== 0).sort((a, c) => c.n - a.n)
  }
  const expCats = useMemo(() => byCategory('cumExpense'), [b.rows])   // eslint-disable-line react-hooks/exhaustive-deps
  const incCats = useMemo(() => byCategory('cumIncome'), [b.rows])    // eslint-disable-line react-hooks/exhaustive-deps

  // חריגות בצד ההוצאות: מעל 100% מהתקציב, או מעל הקצב ביותר מ-10 נקודות
  const flagged: CardRow[] = useMemo(
    () => b.rows
      .filter((r) => r.pctExpense != null && (r.pctExpense > 1 || (pace > 0 && r.pctExpense > pace + 0.1)))
      .sort((a, c) => (c.pctExpense ?? 0) - (a.pctExpense ?? 0))
      .slice(0, 12),
    [b.rows, pace],
  )

  const toCards = (q: Record<string, string>) => {
    const p = new URLSearchParams(search)
    for (const [k, v] of Object.entries(q)) p.set(k, v)
    navigate(`${b.base}/cards?${p}`)
  }
  const keep = (path: string) => `${b.base}${path}${search}`

  const plannedGap = t.budgetIncome - t.budgetExpense
  const execGap = t.cumIncome - t.cumExpense
  const forecastGap = t.forecastIncome - t.forecastExpense
  const usedExp = t.budgetExpense ? t.cumExpense / t.budgetExpense : null

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-3">
        <Kpi value={money(t.budgetExpense)} label="תקציב הוצאות" sub={`הוצאות מצטבר ${money(t.cumExpense)} ₪`} />
        <Kpi value={pct(usedExp)} label="ביצוע הוצאות"
          tone={usedExp != null && usedExp > pace + 0.1 ? 'amber' : 'green'}
          sub={`הקצב: ${pct(pace)} (${monthsLabel(b.elapsed)} חודשים)`} />
        <Kpi value={money(t.budgetIncome)} label="תקציב הכנסות" tone="teal"
          sub={`הכנסות מצטבר ${money(t.cumIncome)} ₪ · ${pct(t.budgetIncome ? t.cumIncome / t.budgetIncome : null)}`} />
        <Kpi value={money(Math.abs(plannedGap))} label={plannedGap < 0 ? 'גרעון בתקציב' : 'עודף בתקציב'}
          tone={plannedGap < 0 ? 'red' : 'green'}
          sub={`בביצוע: ${execGap < 0 ? 'גרעון' : 'עודף'} ${money(Math.abs(execGap))} ₪`} />
        <Kpi value={money(Math.abs(forecastGap))} label={forecastGap < 0 ? 'גרעון צפוי לסוף השנה' : 'עודף צפוי לסוף השנה'}
          tone={forecastGap < plannedGap ? 'amber' : 'slate'}
          sub={t.noForecast
            ? `${t.noForecast} כרטיסים בלי צפי מוקלד — לפי הקצב`
            : 'לפי הצפי שהוקלד בכל הכרטיסים'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="הוצאות לפי חודש" sub="Σ חובה בכל חודש (₪)">
          <Columns items={months.exp} height={150} />
        </ChartCard>
        <ChartCard title="הכנסות לפי חודש" sub="Σ זכות בכל חודש (₪)">
          <Columns items={months.inc} height={150} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="הוצאות לפי קטגוריה" sub="הוצאות מצטבר בתקופה · לחיצה פותחת את הכרטיסים">
          {expCats.length
            ? <HBars items={expCats.slice(0, 15)} onPick={(k) => toCards({ cat: k, side: 'expense' })} />
            : <p className="text-xs text-slate-400">אין עדיין ביצוע בתקופה</p>}
          {b.rows.every((r) => !r.meta?.category1) && (
            <p className="mt-2 text-xs text-slate-500">הכרטיסים עוד לא סווגו. "קטגוריה 1" מגיעה מקובץ התוספתיים, או נקבעת בטבלה — והיא גם קובעת מה רואה כל אחראי תקציב.</p>
          )}
        </ChartCard>
        <ChartCard title="הכנסות לפי קטגוריה" sub="הכנסות מצטבר בתקופה">
          {incCats.length
            ? <HBars items={incCats.slice(0, 15)} onPick={(k) => toCards({ cat: k, side: 'income' })} />
            : <p className="text-xs text-slate-400">אין עדיין הכנסות בתקופה</p>}
        </ChartCard>
      </div>

      <Card title="כרטיסים שחורגים" action={<Link to={keep('/cards')} className="text-sm font-semibold text-emerald-700 hover:underline">למעקב ותכנון ←</Link>}>
        {flagged.length === 0 ? (
          <p className="text-sm text-emerald-700">אין כרטיס הוצאות מעל התקציב או מעל הקצב.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {flagged.map((r) => (
              <li key={r.code}>
                <Link to={keep(`/card/${r.code}`)} className="flex items-center gap-3 px-1 py-2 text-sm hover:bg-slate-50">
                  <span className="w-24 shrink-0 font-mono text-xs text-slate-400" dir="ltr">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-800">{r.name}</span>
                  <span className="tabular-nums text-slate-500">{money(r.cumExpense)} / {money(r.budgetExpense)}</span>
                  <span className={`w-14 text-left font-bold tabular-nums ${(r.pctExpense ?? 0) > 1 ? 'text-red-700' : 'text-amber-700'}`}>{pct(r.pctExpense)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400">
          אדום — מעל 100% מהתקציב. כתום — מעל הקצב ({pct(pace)} מהשנה חלפו) ביותר מ-10 נקודות.
          הוצאות מצטבר (Σ חובה) מול תקציב ההוצאות המאושר מדוח הכרטיסים.
        </p>
      </Card>
    </div>
  )
}
