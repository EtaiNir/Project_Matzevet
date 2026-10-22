import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { AmountCell } from '@/components/budget/InlineCells'
import { Empty } from '@/components/bagrut/ui'
import { hebrewSchoolYear, money, pct } from '@/lib/budgetCalc'
import { monthLong, saveTopicPlan } from '@/lib/meitar'
import { buildTopicRows, topicTotals, type TopicRow } from '@/lib/meitarCalc'
import { useMeitar } from './context'

/** עמודות זעירות — מה נכנס בכל חודש של שנה"ל */
export function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)))
  return (
    <span className="flex h-5 items-end gap-px" dir="ltr" title="ספט׳ ← אוג׳">
      {[...values].reverse().map((v, i) => (
        <span key={i} className={v < 0 ? 'bg-red-300' : 'bg-emerald-400'}
          style={{ width: 4, height: `${Math.max(v ? 8 : 0, (Math.abs(v) / max) * 100)}%` }} />
      ))}
    </span>
  )
}

const MATCH = {
  ok: <span className="text-emerald-600">✓</span>,
  gap: null,
  'no-detail': <span className="text-xs text-slate-400">אין פירוט</span>,
  'no-invoice': <span className="text-xs text-amber-700">לא בחשבונית</span>,
}

/**
 * נושאים — "מיתר – מצטבר חודשי למעקב ותכנון" באקסס, יחד עם טבלה 99: לכל נושא
 * המצטבר עד החודש, מה נכנס החודש, הרטרו לשנה הקודמת, ותכנון — תקציב, צפי
 * ושנה הבאה, נערכים בשורה. צפי ריק מוצג באפור לפי הקצב ואינו נשמר.
 */
export default function MeitarTopics() {
  const m = useMeitar()
  const navigate = useNavigate()
  const [saveError, setSaveError] = useState<string | null>(null)
  const months12 = m.months12
  const withInvoice = !m.institution
  const rows = useMemo(() => (m.month ? buildTopicRows({
    month: m.month, months12, period: m.period, monthTopics: m.monthTopics, invoiceMonths: m.invoiceMonths, topics: m.topics,
    plans: m.plans, booked: m.booked, withInvoice,
  }) : []), [m.month, months12, m.period, m.monthTopics, m.invoiceMonths, m.topics, m.plans, m.booked, withInvoice])

  if (!m.month || !m.entity) return <Empty title="אין עדיין קובצי מיתר בתקופה הזו">אפשר לבקש הורדה במסך ההורדות.</Empty>
  const school = m.period === 'school'
  const entity = m.entity
  const pace = (months12.indexOf(m.month) + 1) / 12
  const hasBooked = m.booked.size > 0

  const save = (r: TopicRow, field: 'budget' | 'forecast' | 'next_year') => async (v: number | null) => {
    setSaveError(null)
    try {
      m.applyPlan(await saveTopicPlan(m.code, entity.entity_code, r.code, m.schoolYear, { [field]: v }, r.plan))
    } catch (e) {
      setSaveError(`נושא ${r.code}: ${(e as Error).message}`)
      throw e
    }
  }
  const amt = (v: number | null | undefined, tone = 'text-slate-700') => <span className={`tabular-nums ${tone}`}>{money(v)}</span>

  const columns: Column<TopicRow>[] = [
    { key: 'code', header: 'נושא', width: 64, sticky: true, render: (r) => <span className="font-mono text-xs text-slate-500">{r.code}</span>, sortValue: (r) => r.code, exportValue: (r) => r.code },
    {
      key: 'name', header: 'שם הנושא', width: 210, sortValue: (r) => r.name,
      render: (r) => <span className="truncate font-medium text-slate-800">{r.name}{r.isNew && <span className="mr-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">חדש</span>}</span>,
    },
    { key: 'group', header: 'דו"ח', width: 130, render: (r) => <span className="truncate text-xs text-slate-500">{r.group ?? ''}</span>, sortValue: (r) => r.group },
    { key: 'cat', header: 'קטגוריה', width: 90, render: (r) => <span className="truncate text-xs text-slate-500">{r.category ?? ''}</span>, sortValue: (r) => r.category },
    { key: 'cum', group: 'act', groupTitle: `ביצוע עד ${monthLong(m.month)}`, header: 'מצטבר', exportHeader: school ? 'מצטבר מתחילת שנה"ל' : 'מצטבר מינואר', width: 116, filter: false, render: (r) => amt(r.cum, 'font-bold text-emerald-800'), sortValue: (r) => r.cum, exportValue: (r) => Math.round(r.cum) },
    { key: 'diff', group: 'act', header: 'החודש', exportHeader: 'נכנס החודש', width: 100, filter: false, render: (r) => amt(r.diff || null, r.diff < 0 ? 'text-red-700' : 'text-slate-700'), sortValue: (r) => r.diff, exportValue: (r) => Math.round(r.diff) },
    { key: 'prior', group: 'act', header: 'רטרו', exportHeader: 'רטרו לשנה הקודמת (מתחילת השנה)', width: 96, filter: false, render: (r) => amt(r.priorYtd || null, 'text-amber-700'), sortValue: (r) => r.priorYtd, exportValue: (r) => Math.round(r.priorYtd) },
    { key: 'spark', group: 'act', header: 'לפי חודש', width: 74, filter: false, render: (r) => <Spark values={r.series} />, sortValue: (r) => r.series.reduce((a, b) => a + b, 0) },
    ...(withInvoice ? [
      { key: 'pay', header: 'לתשלום', exportHeader: 'הפרש לתשלום בחשבונית', width: 104, filter: false, render: (r: TopicRow) => amt(r.toPay), sortValue: (r: TopicRow) => r.toPay, exportValue: (r: TopicRow) => r.toPay } as Column<TopicRow>,
      {
        key: 'match', header: 'התאמה', width: 82, filter: false,
        render: (r: TopicRow) => (r.match === 'gap'
          ? <span className="text-xs font-semibold text-amber-700" title={`הפירוט פחות החשבונית: ${money(r.matchGap)}`}>פער {money(r.matchGap)}</span>
          : r.match ? MATCH[r.match] : ''),
        sortValue: (r: TopicRow) => (r.match === 'gap' ? 3 : r.match === 'no-invoice' ? 2 : r.match === 'no-detail' ? 1 : 0),
        exportValue: (r: TopicRow) => (r.match === 'gap' ? Math.round(r.matchGap ?? 0) : r.match ?? ''),
      } as Column<TopicRow>,
    ] : []),
    ...(!school ? [] : [
    { key: 'budget', group: 'plan', groupTitle: `תכנון שנה"ל ${hebrewSchoolYear(m.schoolYear)}`, header: 'תקציב', width: 112, filter: false, render: (r) => <AmountCell value={r.plan?.budget ?? null} disabled={!m.canManage} onSave={save(r, 'budget')} />, sortValue: (r) => r.plan?.budget, exportValue: (r) => r.plan?.budget ?? null },
    {
      key: 'usage', group: 'plan', header: 'ביצוע', width: 64, filter: false,
      render: (r) => <span className={`tabular-nums ${r.usage == null ? 'text-slate-300' : r.usage < pace - 0.1 ? 'font-semibold text-amber-700' : 'text-slate-700'}`}>{pct(r.usage)}</span>,
      sortValue: (r) => r.usage, exportValue: (r) => (r.usage == null ? null : Math.round(r.usage * 100)),
    },
    { key: 'forecast', group: 'plan', header: 'צפי לסוף השנה', width: 120, filter: false, render: (r) => <AmountCell value={r.plan?.forecast ?? null} placeholder={r.suggested} disabled={!m.canManage} onSave={save(r, 'forecast')} />, sortValue: (r) => r.plan?.forecast ?? r.suggested, exportValue: (r) => r.plan?.forecast ?? null },
    { key: 'next', group: 'plan', header: 'שנה הבאה', width: 112, filter: false, render: (r) => <AmountCell value={r.plan?.next_year ?? null} disabled={!m.canManage} onSave={save(r, 'next_year')} />, sortValue: (r) => r.plan?.next_year, exportValue: (r) => r.plan?.next_year ?? null },
    ] as Column<TopicRow>[]),
    ...(hasBooked ? [
      { key: 'booked', header: 'נרשם בהנהח"ש', width: 110, filter: false, render: (r: TopicRow) => amt(r.booked, 'text-teal-700'), sortValue: (r: TopicRow) => r.booked, exportValue: (r: TopicRow) => r.booked } as Column<TopicRow>,
      {
        key: 'gap', header: 'טרם נרשם', width: 100, filter: false,
        render: (r: TopicRow) => (r.booked == null ? '' : amt(r.cum - r.booked, 'text-amber-700')),
        sortValue: (r: TopicRow) => (r.booked == null ? null : r.cum - r.booked),
        exportValue: (r: TopicRow) => (r.booked == null ? null : Math.round(r.cum - r.booked)),
      } as Column<TopicRow>,
    ] : []),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      {saveError && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{saveError}</p>}
      <BagrutTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.code}
        onRowClick={(r) => navigate(m.to(`topic/${r.code}`))}
        exportName={`מיתר_${entity.name}_${m.month.slice(0, 7)}`}
        sheetName={`מיתר ${m.month.slice(0, 7)}`}
        countLabel="נושאים"
        rowTitle={(r) => `${r.code} · ${r.name}`}
        initialSort={{ key: 'cum', dir: 'desc' }}
        storageKey="meitar-topics"
        empty="אין נושאים בחודש הזה"
        summary={(shown) => <Summary rows={shown} withInvoice={withInvoice} withPlan={school} />}
      />
      <p className="text-xs text-slate-500">
        {school
          ? <>מצטבר = סכום מחושב של חודשי התחולה בשנה"ל (כמו טבלה 99 באקסס). רטרו = עדכונים לחודשי תחולה של השנה הקודמת — בנפרד, לא במצטבר.
            {m.canManage ? ' תקציב, צפי ושנה הבאה — לחיצה על התא ועריכה.' : ''} צפי ריק מוצג באפור לפי הקצב ({pct(pace)} מהשנה).</>
          : <>ינואר–דצמבר: מצטבר = מה שנכנס בכל חודש מינואר, כולל רטרו. התקציב, הצפי והשנה הבאה לנושא — בתצוגת שנה"ל (בבורר למעלה).</>}
      </p>
    </div>
  )
}

function Summary({ rows, withInvoice, withPlan }: { rows: TopicRow[]; withInvoice: boolean; withPlan: boolean }) {
  const t = topicTotals(rows)
  const cell = (label: string, value: string, tone = 'text-slate-800') => (
    <div className="min-w-[7rem] rounded-lg bg-white px-3 py-1.5 ring-1 ring-slate-200">
      <div className={`text-sm font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-bold text-slate-600">סה"כ · {rows.length} נושאים</span>
      {cell('מצטבר', money(t.cum), 'text-emerald-800')}
      {cell('החודש', money(t.diff))}
      {cell('רטרו לשנה הקודמת', money(t.priorYtd), 'text-amber-700')}
      {withInvoice && cell('לתשלום בחשבונית', money(t.toPay))}
      {withPlan && cell('תקציב', money(t.budget))}
      {withPlan && cell('צפי', money(t.forecast))}
      {withPlan && cell('שנה הבאה', money(t.next))}
    </div>
  )
}
