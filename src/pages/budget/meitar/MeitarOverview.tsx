import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card, Empty, Kpi } from '@/components/bagrut/ui'
import { ChartCard, Columns, HBars } from '@/components/charts/Charts'
import type { Bucket } from '@/lib/charts'
import { money, pct } from '@/lib/budgetCalc'
import { monthLong, monthShort } from '@/lib/meitar'
import { buildTopicRows, monthSeries, topicTotals } from '@/lib/meitarCalc'
import { useMeitar } from './context'

const CUR = 'שנה"ל הנוכחית'
const PRIOR = 'רטרו לשנה הקודמת'

/**
 * סקירה — המצב בחודש שנבחר: מצטבר מספטמבר, מה נכנס החודש, רטרו לשנה הקודמת,
 * ביצוע מול התקציב והקצב; ההכנסות לפי חודש ולפי נושא.
 */
export default function MeitarOverview() {
  const m = useMeitar()
  const navigate = useNavigate()
  const months12 = m.months12
  const rows = useMemo(() => (m.month ? buildTopicRows({
    month: m.month, months12, period: m.period, monthTopics: m.monthTopics, invoiceMonths: m.invoiceMonths, topics: m.topics,
    plans: m.plans, booked: m.booked, withInvoice: !m.institution,
  }) : []), [m.month, months12, m.period, m.monthTopics, m.invoiceMonths, m.topics, m.plans, m.booked, m.institution])
  const series = useMemo(() => monthSeries(m.monthTopics, months12, m.period), [m.monthTopics, months12, m.period])

  if (!m.month) {
    return (
      <Empty title={`אין עדיין קובצי מיתר ל${m.entity?.name ?? 'מקור'} בתקופה הזו`}>
        הסוכן מוריד כל חודש מאתר המשרד בעצמו. אפשר גם לבקש הורדה עכשיו —{' '}
        <Link to={m.to('downloads')} className="font-semibold text-emerald-700 hover:underline">במסך ההורדות</Link>.
      </Empty>
    )
  }

  const t = topicTotals(rows)
  const mi = months12.indexOf(m.month) + 1
  const pace = mi / 12
  const usage = t.budget ? t.cum / t.budget : null
  const official = m.institution
    ? m.instTotals.find((x) => x.institution_code === m.institution && x.calc_month.slice(0, 10) === m.month)
    : null

  // בגרפים — באלפי ₪: מספרים של 8 ספרות עלו זה על זה מעל העמודות (אייל, 22.10)
  const k = (v: number) => Math.round(Math.max(0, v) / 1000)
  const byMonth: Bucket[] = series.map((p, i) => ({
    key: monthShort(months12[i]),
    n: p ? k(p.current) + k(p.prior) : 0,
    split: p ? new Map([[CUR, k(p.current)], [PRIOR, k(p.prior)]]) : undefined,
  }))
  const cumByMonth: Bucket[] = series.map((p, i) => ({ key: monthShort(months12[i]), n: p ? k(p.cum) : 0 }))
  const top: Bucket[] = [...rows].filter((r) => r.cum > 0).sort((a, b) => b.cum - a.cum).slice(0, 12)
    .map((r) => ({ key: `${r.code} · ${r.name}`, n: k(r.cum) }))
  const groups = new Map<string, number>()
  for (const r of rows) if (r.cum > 0) groups.set(r.group ?? 'אחר', (groups.get(r.group ?? 'אחר') ?? 0) + r.cum)
  const byGroup: Bucket[] = [...groups].map(([key, n]) => ({ key, n: k(n) })).sort((a, b) => b.n - a.n)
  const school = m.period === 'school'
  const since = school ? 'מתחילת שנה״ל' : 'מינואר'

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-3">
        <Kpi value={money(t.cum)} label={`מצטבר ${since}`} tone="green"
          sub={`עד ${monthLong(m.month)} · חודש ${mi} מתוך 12${school ? '' : ' · מה שנכנס בפועל'}`} />
        <Kpi value={money(t.diff + t.priorDiff)} label="נכנס החודש"
          sub={t.priorDiff ? `מתוכו ${money(t.priorDiff)} רטרו לשנה הקודמת` : 'הפרש מחושב — מה שהשתנה'} />
        <Kpi value={money(t.priorYtd)} label="רטרו לשנה הקודמת" tone={t.priorYtd ? 'amber' : 'slate'}
          sub={`${since} — עדכונים לחודשי תחולה של שנה״ל שנסגרה`} />
        {school ? (
          <>
            <Kpi value={usage == null ? '—' : pct(usage)} label="ביצוע מול התקציב"
              tone={usage == null ? 'slate' : usage < pace - 0.1 ? 'amber' : 'green'}
              sub={t.budget ? `תקציב ${money(t.budget)} · הקצב ${pct(pace)}` : 'עוד לא הוזן תקציב לנושאים'} />
            <Kpi value={money(t.forecast)} label="צפי לסוף השנה"
              tone={t.budget && t.forecast < t.budget ? 'red' : 'slate'}
              sub={t.budget ? `${t.forecast >= t.budget ? 'עודף' : 'חסר'} ${money(Math.abs(t.forecast - t.budget))} מול התקציב` : 'מוקלד, ולנושא בלי צפי — לפי הקצב'} />
          </>
        ) : (
          <Kpi value={money(t.forecast)} label="צפי לדצמבר לפי הקצב" tone="slate"
            sub="התקציב והצפי לנושא — בתצוגת שנה״ל" />
        )}
        {official && (
          <Kpi value={Math.abs((official.computed ?? 0) - t.cum) < 1 ? '✓' : money((official.computed ?? 0) - t.cum)}
            label="מול הסיכום הרשמי של המוסד" tone={Math.abs((official.computed ?? 0) - t.cum) < 1 ? 'green' : 'amber'}
            sub={`RICUZMOSDOT: ${money(official.computed)}`} />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="נכנס בכל חודש" sub={`באלפי ₪ · הפרש מחושב — ${CUR} ו${PRIOR}`}>
          <Columns items={byMonth} splitKeys={[CUR, PRIOR]} height={150} />
        </ChartCard>
        <ChartCard title={`מצטבר ${since}`} sub={school ? 'באלפי ₪ · סכום מחושב בקובץ של כל חודש' : 'באלפי ₪ · Σ מה שנכנס מינואר'}>
          <Columns items={cumByMonth} height={150} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="הנושאים הגדולים" sub="מצטבר, באלפי ₪ · לחיצה פותחת את הנושא">
          {top.length ? <HBars items={top} onPick={(k) => navigate(m.to(`topic/${k.split(' · ')[0]}`))} />
            : <p className="text-xs text-slate-400">אין עדיין סכומים בתקופה</p>}
        </ChartCard>
        <ChartCard title="לפי סוג הדו״ח" sub="באלפי ₪ · קבוצת הנושא באינדקס המשרד">
          {byGroup.length ? <HBars items={byGroup} /> : <p className="text-xs text-slate-400">—</p>}
        </ChartCard>
      </div>

      {rows.some((r) => r.isNew) && (
        <Card title="נושאים חדשים מהמשרד">
          <p className="text-sm text-slate-600">
            נושאים שלא היו באינדקס והגיעו בקבצים: {rows.filter((r) => r.isNew).map((r) => `${r.code} ${r.name}`).join(' · ')}.
            כדאי לבדוק שיש להם תקציב ושיוך.
          </p>
        </Card>
      )}
    </div>
  )
}
