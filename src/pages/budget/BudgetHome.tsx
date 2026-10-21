import { useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Card, Kpi } from '@/components/bagrut/ui'
import { ChartCard, Columns, HBars } from '@/components/charts/Charts'
import { money, monthlySeries, monthsLabel, pct, totals, type CardRow, type Direction } from '@/lib/budgetCalc'
import type { Bucket } from '@/lib/charts'
import { useBudget } from './context'

const UNCATEGORIZED = '(לא סווג)'

/**
 * תמונת התקציב — מה שסבא מחפש באקסס בטופס "מעקב, בקרה ותכנון מצטבר":
 * תכנון מול ביצוע, אחוז ניצול מול הקצב, צפי לסוף השנה והגרעון המתוכנן —
 * ואיפה יש חריגה. לחיצה על קטגוריה או כרטיס מובילה לכרטסת.
 */
export default function BudgetHome() {
  const b = useBudget()
  const navigate = useNavigate()
  const { search } = useLocation()
  const pace = b.elapsed / 12

  const t = useMemo(() => ({ exp: totals(b.rows, 'expense'), inc: totals(b.rows, 'income') }), [b.rows])
  const dirOf = useMemo(() => {
    const m = new Map(b.rows.map((r) => [r.code, r.dir]))
    return (c: string) => m.get(c)
  }, [b.rows])
  const months = useMemo(() => ({
    exp: monthlySeries(b.monthly, dirOf, 'expense', b.periodFrom),
    inc: monthlySeries(b.monthly, dirOf, 'income', b.periodFrom),
  }), [b.monthly, dirOf, b.periodFrom])

  const byCategory = (dir: Direction): Bucket[] => {
    const m = new Map<string, number>()
    for (const r of b.rows) if (r.dir === dir) {
      const k = r.meta?.category1?.trim() || UNCATEGORIZED
      m.set(k, (m.get(k) ?? 0) + (r.executed ?? 0))
    }
    return [...m].map(([key, n]) => ({ key, n: Math.round(n) })).filter((x) => x.n !== 0).sort((a, c) => c.n - a.n)
  }

  // חריגות: מעל 100% מהתקציב, או מעל הקצב ביותר מ-10 נקודות
  const flagged: CardRow[] = useMemo(
    () => b.rows
      .filter((r) => r.dir === 'expense' && r.usage != null && (r.usage > 1 || (pace > 0 && r.usage > pace + 0.1)))
      .sort((a, c) => (c.usage ?? 0) - (a.usage ?? 0))
      .slice(0, 12),
    [b.rows, pace],
  )

  const toCards = (q: Record<string, string>) => {
    const p = new URLSearchParams(search)
    for (const [k, v] of Object.entries(q)) p.set(k, v)
    navigate(`${b.base}/cards?${p}`)
  }
  const keep = (path: string) => `${b.base}${path}${search}`

  const plannedGap = t.inc.budget - t.exp.budget
  const forecastGap = t.inc.forecast - t.exp.forecast

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-3">
        <Kpi value={money(t.exp.budget)} label="תקציב הוצאות" sub={`${b.rows.filter((r) => r.dir === 'expense').length} כרטיסים`} />
        <Kpi value={pct(t.exp.budget ? t.exp.executed / t.exp.budget : null)} label="ניצול הוצאות"
          tone={t.exp.budget && t.exp.executed / t.exp.budget > pace + 0.1 ? 'amber' : 'green'}
          sub={`${money(t.exp.executed)} ₪ · הקצב: ${pct(pace)} (${monthsLabel(b.elapsed)} חודשים)`} />
        <Kpi value={money(t.inc.budget)} label="תקציב הכנסות" sub={`בוצע ${money(t.inc.executed)} ₪ · ${pct(t.inc.budget ? t.inc.executed / t.inc.budget : null)}`} tone="teal" />
        <Kpi value={money(Math.abs(plannedGap))} label={plannedGap < 0 ? 'גרעון מתוכנן' : 'עודף מתוכנן'}
          tone={plannedGap < 0 ? 'red' : 'green'}
          sub="הכנסות פחות הוצאות בתקציב המאושר — מה שהמועצה מתחייבת לכסות" />
        <Kpi value={money(Math.abs(forecastGap))} label={forecastGap < 0 ? 'גרעון צפוי לסוף השנה' : 'עודף צפוי לסוף השנה'}
          tone={forecastGap < plannedGap ? 'amber' : 'slate'}
          sub={t.exp.noForecast + t.inc.noForecast
            ? `${t.exp.noForecast + t.inc.noForecast} כרטיסים בלי צפי מוקלד — לפי הקצב`
            : 'לפי הצפי שהוקלד בכל הכרטיסים'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="ביצוע הוצאות לפי חודש" sub="סכום התנועות בכל חודש (₪)">
          <Columns items={months.exp} height={150} />
        </ChartCard>
        <ChartCard title="הכנסות לפי חודש" sub="תקבולים שנרשמו בכל חודש (₪)">
          <Columns items={months.inc} height={150} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="הוצאות לפי קטגוריה" sub="ביצוע בתקופה · לחיצה פותחת את הכרטיסים">
          {byCategory('expense').length
            ? <HBars items={byCategory('expense').slice(0, 15)} onPick={(k) => toCards({ cat: k })} />
            : <p className="text-xs text-slate-400">אין עדיין ביצוע בתקופה</p>}
          {b.rows.every((r) => !r.meta?.category1) && (
            <p className="mt-2 text-xs text-slate-500">הכרטיסים עוד לא סווגו. את "קטגוריה 1" קובעים בכרטסת — והיא גם קובעת מה רואה כל אחראי תקציב.</p>
          )}
        </ChartCard>
        <ChartCard title="הכנסות לפי קטגוריה" sub="ביצוע בתקופה">
          {byCategory('income').length
            ? <HBars items={byCategory('income').slice(0, 15)} onPick={(k) => toCards({ cat: k })} />
            : <p className="text-xs text-slate-400">אין עדיין הכנסות בתקופה</p>}
        </ChartCard>
      </div>

      <Card title="כרטיסים שחורגים" action={<Link to={keep('/cards')} className="text-sm font-semibold text-emerald-700 hover:underline">לכל הכרטסת ←</Link>}>
        {flagged.length === 0 ? (
          <p className="text-sm text-emerald-700">אין כרטיס הוצאות מעל התקציב או מעל הקצב.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {flagged.map((r) => (
              <li key={r.code}>
                <Link to={keep(`/card/${r.code}`)} className="flex items-center gap-3 px-1 py-2 text-sm hover:bg-slate-50">
                  <span className="w-24 shrink-0 font-mono text-xs text-slate-400" dir="ltr">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-800">{r.name}</span>
                  <span className="tabular-nums text-slate-500">{money(r.executed)} / {money(r.budget)}</span>
                  <span className={`w-14 text-left font-bold tabular-nums ${(r.usage ?? 0) > 1 ? 'text-red-700' : 'text-amber-700'}`}>{pct(r.usage)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400">
          אדום — מעל 100% מהתקציב. כתום — מעל הקצב ({pct(pace)} מהשנה חלפו) ביותר מ-10 נקודות.
          התקציב הוא התקציב המאושר מדוח הכרטיסים.
        </p>
      </Card>
    </div>
  )
}
