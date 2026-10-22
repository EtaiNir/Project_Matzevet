import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { Card, ErrorBox, Kpi, Loading } from '@/components/bagrut/ui'
import { ChartCard, Columns } from '@/components/charts/Charts'
import type { Bucket } from '@/lib/charts'
import { money, pct } from '@/lib/budgetCalc'
import {
  fetchMeitarInvoice,
  fetchMeitarRows,
  monthLong,
  monthShort,
  type MeitarInvoiceRow,
  type MeitarRow,
} from '@/lib/meitar'
import { buildTopicRows } from '@/lib/meitarCalc'
import { useMeitar } from './context'

/**
 * נושא אחד — "מיתר – הכנסות ברמת הסעיף" באקסס: איך הנושא נבנה לאורך השנה,
 * ומה בתוכו בחודש שנבחר — לפי מוסד / יישוב, עם כל העמודות שבקובץ המשרד,
 * ושורות החשבונית לפי חודש תחולה.
 */
export default function MeitarTopic() {
  const m = useMeitar()
  const { topic = '' } = useParams()
  const run = m.runs.find((r) => r.calc_month.slice(0, 10) === m.month) ?? null
  const [rows, setRows] = useState<MeitarRow[] | null>(null)
  const [invoice, setInvoice] = useState<MeitarInvoiceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!run) return
    let alive = true
    setRows(null)
    setInvoice(null)
    Promise.all([
      fetchMeitarRows(run.id, { topic, institution: m.institution }),
      m.institution ? Promise.resolve([]) : fetchMeitarInvoice(run.id),
    ])
      .then(([r, inv]) => {
        if (!alive) return
        setRows(r)
        setInvoice(inv.filter((x) => x.topic_code === topic))
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [run, topic, m.institution])

  const months12 = m.months12
  const row = useMemo(() => (m.month ? buildTopicRows({
    month: m.month, months12, period: m.period, monthTopics: m.monthTopics.filter((x) => x.topic_code === topic),
    invoiceMonths: m.invoiceMonths.filter((x) => x.topic_code === topic), topics: m.topics, plans: m.plans,
    booked: m.booked, withInvoice: !m.institution,
  })[0] ?? null : null), [m.month, months12, m.period, m.monthTopics, m.invoiceMonths, m.topics, m.plans, m.booked, m.institution, topic])

  const meta = m.topics.get(topic)
  const name = meta?.name ?? row?.name ?? `נושא ${topic}`
  const trend: Bucket[] = months12.map((mo, i) => {
    const v = row?.series[i] ?? 0
    return { key: monthShort(mo), n: Math.round(Math.max(0, v) / 1000) }
  })

  const extraKeys = useMemo(() => {
    const keys = new Map<string, number>()
    for (const r of rows ?? []) for (const k of Object.keys(r.extra ?? {})) keys.set(k, (keys.get(k) ?? 0) + 1)
    return [...keys].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k)
  }, [rows])

  const detailColumns: Column<MeitarRow>[] = [
    { key: 'file', header: 'קובץ', width: 90, render: (r) => <span className="font-mono text-xs text-slate-400">{r.source_file}</span>, sortValue: (r) => r.source_file },
    { key: 'inst', header: 'מוסד', width: 170, render: (r) => <span className="truncate">{r.institution_name ?? ''}</span>, sortValue: (r) => r.institution_name },
    { key: 'instCode', header: 'סמל מוסד', width: 80, render: (r) => <span className="font-mono text-xs text-slate-500">{r.institution_code ?? ''}</span>, sortValue: (r) => r.institution_code },
    { key: 'settl', header: 'יישוב', width: 120, render: (r) => <span className="truncate text-slate-600">{r.settlement_name ?? ''}</span>, sortValue: (r) => r.settlement_name },
    {
      key: 'effect', header: 'חודש תחולה', width: 96, sortValue: (r) => r.effect_date ?? r.effect_month,
      render: (r) => <span className={`tabular-nums ${r.prior_year ? 'text-amber-700' : ''}`} title={r.prior_year ? 'שנה"ל קודמת' : undefined}>{r.effect_month}{r.prior_year ? ' ◂' : ''}</span>,
      exportValue: (r) => r.effect_month,
    },
    { key: 'prior', header: 'שנה קודמת', width: 70, align: 'center', render: (r) => (r.prior_year ? <span className="text-amber-700">✓</span> : ''), sortValue: (r) => (r.prior_year ? 1 : 0), exportValue: (r) => (r.prior_year ? 'כן' : '') },
    { key: 'units', header: 'יחידות', width: 74, render: (r) => <span className="tabular-nums">{r.units ?? ''}</span>, sortValue: (r) => r.units, exportValue: (r) => r.units, filter: false },
    { key: 'cost', header: 'עלות', width: 90, render: (r) => <span className="tabular-nums text-slate-600">{money(r.cost)}</span>, sortValue: (r) => r.cost, exportValue: (r) => r.cost, filter: false },
    { key: 'computed', header: 'סכום מחושב', width: 110, render: (r) => <span className="tabular-nums">{money(r.computed)}</span>, sortValue: (r) => r.computed, exportValue: (r) => r.computed, filter: false },
    { key: 'prev', header: 'מחושב קודם', width: 104, render: (r) => <span className="tabular-nums text-slate-500">{money(r.computed_prev)}</span>, sortValue: (r) => r.computed_prev, exportValue: (r) => r.computed_prev, filter: false },
    {
      key: 'diff', header: 'הפרש', width: 100, filter: false, sortValue: (r) => r.diff, exportValue: (r) => r.diff,
      render: (r) => <span className={`font-semibold tabular-nums ${r.diff ? (r.diff < 0 ? 'text-red-700' : 'text-emerald-700') : 'text-slate-300'}`}>{money(r.diff)}</span>,
    },
    ...extraKeys.map((k): Column<MeitarRow> => ({
      key: `x:${k}`, header: k, width: 110, render: (r) => <span className="truncate text-xs text-slate-600">{r.extra?.[k] ?? ''}</span>,
      sortValue: (r) => r.extra?.[k] ?? null, exportValue: (r) => r.extra?.[k] ?? '',
    })),
  ]

  const invoiceColumns: Column<MeitarInvoiceRow>[] = [
    { key: 'effect', header: 'חודש תחולה', width: 100, render: (r) => <span className={r.prior_year ? 'text-amber-700' : ''}>{r.effect_month}{r.prior_year ? ' ◂ שנה קודמת' : ''}</span>, sortValue: (r) => r.effect_date ?? r.effect_month },
    { key: 'hesh', header: 'חשבות', width: 80, render: (r) => <span className="text-xs text-slate-500">{r.chashavut}</span>, sortValue: (r) => r.chashavut },
    { key: 'due', header: 'סך הכל מגיע', width: 110, render: (r) => <span className="tabular-nums">{money(r.due)}</span>, sortValue: (r) => r.due, exportValue: (r) => r.due, filter: false },
    { key: 'paid', header: 'שולם', width: 110, render: (r) => <span className="tabular-nums text-slate-500">{money(r.paid)}</span>, sortValue: (r) => r.paid, exportValue: (r) => r.paid, filter: false },
    { key: 'pay', header: 'הפרש לתשלום', width: 110, render: (r) => <span className="font-semibold tabular-nums text-emerald-800">{money(r.to_pay)}</span>, sortValue: (r) => r.to_pay, exportValue: (r) => r.to_pay, filter: false },
    { key: 'debt', header: 'יתרת חוב', width: 96, render: (r) => <span className="tabular-nums text-slate-500">{money(r.debt)}</span>, sortValue: (r) => r.debt, exportValue: (r) => r.debt, filter: false },
  ]

  const mi = m.month ? months12.indexOf(m.month) + 1 : 1

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={m.to('topics')} className="text-sm text-slate-500 hover:text-emerald-700">→ כל הנושאים</Link>
        <h2 className="text-lg font-bold text-slate-800">{topic} · {name}</h2>
        {meta?.report_group && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{meta.report_group}</span>}
        {meta?.category && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{meta.category}</span>}
        {meta?.is_new && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">נושא חדש באינדקס</span>}
      </div>

      {row && (
        <div className="flex flex-wrap gap-3">
          <Kpi value={money(row.cum)} label={m.period === 'school' ? 'מצטבר מתחילת שנה״ל' : 'מצטבר מינואר'} tone="green" sub={m.month ? `עד ${monthLong(m.month)}` : ''} />
          <Kpi value={money(row.diff + row.priorDiff)} label="נכנס החודש" sub={row.priorDiff ? `מתוכו ${money(row.priorDiff)} רטרו` : ''} />
          <Kpi value={money(row.priorYtd)} label="רטרו לשנה הקודמת" tone={row.priorYtd ? 'amber' : 'slate'} sub="מתחילת שנה״ל" />
          <Kpi value={row.usage == null ? '—' : pct(row.usage)} label="ביצוע מול התקציב"
            tone={row.usage == null ? 'slate' : row.usage < mi / 12 - 0.1 ? 'amber' : 'green'}
            sub={row.plan?.budget ? `תקציב ${money(row.plan.budget)} · הקצב ${pct(mi / 12)}` : 'אין תקציב לנושא'} />
          <Kpi value={money(row.plan?.forecast ?? row.suggested)} label="צפי לסוף השנה" sub={row.plan?.forecast == null ? 'לפי הקצב' : 'הוקלד'} />
          {row.booked != null && <Kpi value={money(row.booked)} label="נרשם בהנהח״ש" tone="teal" sub={`טרם נרשם: ${money(row.cum - row.booked)}`} />}
        </div>
      )}

      <ChartCard title="נכנס בכל חודש" sub="באלפי ₪ · הפרש מחושב — שנה״ל ורטרו">
        <Columns items={trend} height={120} />
      </ChartCard>

      {error ? <ErrorBox message={error} /> : !run ? null : (
        <>
          <Card title={`פירוט ${m.month ? monthLong(m.month) : ''}`} action={rows && <span className="text-xs text-slate-400">{rows.length} שורות · ◂ = תחולה בשנה"ל קודמת</span>}>
            {rows == null ? <Loading label="טוען את הפירוט…" /> : (
              <div className="flex h-[26rem] flex-col">
                <BagrutTable rows={rows} columns={detailColumns} rowKey={(r) => String(r.id)}
                  exportName={`מיתר_נושא_${topic}_${m.month?.slice(0, 7)}`} sheetName={`נושא ${topic}`}
                  countLabel="שורות" initialSort={{ key: 'computed', dir: 'desc' }} storageKey="meitar-topic-detail" empty="אין שורות פירוט לנושא בחודש הזה" />
              </div>
            )}
          </Card>
          {!m.institution && (
            <Card title="בחשבונית" action={invoice && <span className="text-xs text-slate-400">שורה לכל חודש תחולה</span>}>
              {invoice == null ? <Loading label="טוען…" /> : invoice.length === 0 ? <p className="text-sm text-slate-400">הנושא אינו בחשבונית החודש.</p> : (
                <div className="flex h-[16rem] flex-col">
                  <BagrutTable rows={invoice} columns={invoiceColumns} rowKey={(r) => String(r.id)}
                    exportName={`מיתר_חשבונית_${topic}`} sheetName="חשבונית" countLabel="שורות"
                    initialSort={{ key: 'effect', dir: 'desc' }} storageKey="meitar-topic-invoice" />
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
