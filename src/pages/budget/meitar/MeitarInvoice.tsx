import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { Card, Empty, ErrorBox, Kpi, Loading } from '@/components/bagrut/ui'
import { money } from '@/lib/budgetCalc'
import { fetchMeitarInvoice, monthLong, type MeitarInvoiceRow } from '@/lib/meitar'
import { buildTopicRows, type TopicRow } from '@/lib/meitarCalc'
import { useMeitar } from './context'

/**
 * החשבונית והתאמה — "הפרש לתשלום" בחשבונית (מה שמשולם החודש, כולל רטרו) מול
 * סכום "הפרש מחושב" בקובצי הפירוט, לכל נושא. כולל נושאים שבפירוט ואינם
 * בחשבונית (היה נאסף בקליטה ולא מוצג). רק למועצה — החשבונית היא של המוטב.
 */
export default function MeitarInvoice() {
  const m = useMeitar()
  const navigate = useNavigate()
  const run = m.runs.find((r) => r.calc_month.slice(0, 10) === m.month) ?? null
  const [invoice, setInvoice] = useState<MeitarInvoiceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!run || m.institution) return
    let alive = true
    setInvoice(null)
    fetchMeitarInvoice(run.id).then((r) => alive && setInvoice(r)).catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [run, m.institution])

  const months12 = m.months12
  const topics = useMemo(() => (m.month ? buildTopicRows({
    month: m.month, months12, period: m.period, monthTopics: m.monthTopics, invoiceMonths: m.invoiceMonths, topics: m.topics,
    plans: m.plans, booked: null, withInvoice: true,
  }) : []), [m.month, months12, m.period, m.monthTopics, m.invoiceMonths, m.topics, m.plans])

  if (!m.month) return <Empty title="אין עדיין קובצי מיתר בשנה״ל הזו">אפשר לבקש הורדה במסך ההורדות.</Empty>
  if (m.institution) {
    return <Empty title="החשבונית היא של המועצה">בתצוגת בית ספר אין חשבונית נפרדת — ההתאמה שלו היא מול הסיכום הרשמי, במסך המוסדות.</Empty>
  }

  const ok = topics.filter((t) => t.match === 'ok').length
  const gaps = topics.filter((t) => t.match === 'gap')
  const notInInvoice = topics.filter((t) => t.match === 'no-invoice')
  const noDetail = topics.filter((t) => t.match === 'no-detail')
  const toPay = (invoice ?? []).reduce((s, r) => s + (r.to_pay ?? 0), 0)
  const prior = (invoice ?? []).filter((r) => r.prior_year).reduce((s, r) => s + (r.to_pay ?? 0), 0)

  const reconColumns: Column<TopicRow>[] = [
    { key: 'code', header: 'נושא', width: 64, render: (t) => <span className="font-mono text-xs text-slate-500">{t.code}</span>, sortValue: (t) => t.code },
    { key: 'name', header: 'שם', width: 220, render: (t) => <span className="truncate">{t.name}</span>, sortValue: (t) => t.name },
    { key: 'inv', header: 'בחשבונית', width: 116, filter: false, render: (t) => <span className="tabular-nums">{money(t.toPay)}</span>, sortValue: (t) => t.toPay, exportValue: (t) => t.toPay },
    { key: 'det', header: 'בפירוט', width: 116, filter: false, render: (t) => <span className="tabular-nums">{money(t.diff + t.priorDiff)}</span>, sortValue: (t) => t.diff + t.priorDiff, exportValue: (t) => t.diff + t.priorDiff },
    {
      key: 'gap', header: 'פער', width: 110, filter: false,
      render: (t) => <span className="font-semibold tabular-nums text-amber-700">{t.match === 'gap' ? money(t.matchGap) : t.match === 'no-invoice' ? 'לא בחשבונית' : 'אין פירוט'}</span>,
      sortValue: (t) => t.matchGap, exportValue: (t) => t.matchGap,
    },
  ]
  const invColumns: Column<MeitarInvoiceRow>[] = [
    { key: 'code', header: 'נושא', width: 64, render: (r) => <span className="font-mono text-xs text-slate-500">{r.topic_code}</span>, sortValue: (r) => r.topic_code },
    { key: 'name', header: 'תאור נושא', width: 200, render: (r) => <span className="truncate">{r.topic_name}</span>, sortValue: (r) => r.topic_name },
    {
      key: 'effect', header: 'חודש תחולה', width: 120, sortValue: (r) => r.effect_date ?? r.effect_month, exportValue: (r) => r.effect_month,
      render: (r) => <span className={r.prior_year ? 'text-amber-700' : r.effect_date?.slice(0, 10) !== m.month ? 'text-sky-700' : ''}>
        {r.effect_month}{r.prior_year ? ' ◂ שנה קודמת' : r.effect_date?.slice(0, 10) !== m.month ? ' ◂ רטרו' : ''}</span>,
    },
    { key: 'hesh', header: 'חשבות', width: 76, render: (r) => <span className="text-xs text-slate-500">{r.chashavut}</span>, sortValue: (r) => r.chashavut },
    { key: 'due', header: 'סך הכל מגיע', width: 110, filter: false, render: (r) => <span className="tabular-nums">{money(r.due)}</span>, sortValue: (r) => r.due, exportValue: (r) => r.due },
    { key: 'paid', header: 'שולם', width: 104, filter: false, render: (r) => <span className="tabular-nums text-slate-500">{money(r.paid)}</span>, sortValue: (r) => r.paid, exportValue: (r) => r.paid },
    { key: 'pay', header: 'הפרש לתשלום', width: 110, filter: false, render: (r) => <span className="font-semibold tabular-nums text-emerald-800">{money(r.to_pay)}</span>, sortValue: (r) => r.to_pay, exportValue: (r) => r.to_pay },
    { key: 'debt', header: 'יתרת חוב', width: 96, filter: false, render: (r) => <span className="tabular-nums text-slate-500">{money(r.debt)}</span>, sortValue: (r) => r.debt, exportValue: (r) => r.debt },
  ]

  const problems = [...gaps, ...notInInvoice, ...noDetail]
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-3">
        <Kpi value={money(toPay)} label="לתשלום בחשבונית" tone="green" sub={monthLong(m.month)} />
        <Kpi value={money(prior)} label="מתוכו לשנה״ל קודמת" tone={prior ? 'amber' : 'slate'} />
        <Kpi value={`${ok}/${ok + gaps.length + noDetail.length}`} label="נושאים מתיישבים" tone={problems.length ? 'amber' : 'green'}
          sub="הפרש לתשלום = Σ הפרש מחושב בפירוט" />
        {notInInvoice.length > 0 && <Kpi value={notInInvoice.length} label="בפירוט ולא בחשבונית" tone="amber" />}
      </div>
      {problems.length > 0 && (
        <Card title="מה לא מתיישב">
          <div className="flex h-[14rem] flex-col">
            <BagrutTable rows={problems} columns={reconColumns} rowKey={(t) => t.code} onRowClick={(t) => navigate(m.to(`topic/${t.code}`))}
              exportName={`מיתר_התאמה_${m.month.slice(0, 7)}`} sheetName="התאמה" countLabel="נושאים" storageKey="meitar-recon" />
          </div>
        </Card>
      )}
      <Card title="שורות החשבונית" action={<span className="text-xs text-slate-400">שורה לכל נושא × חודש תחולה</span>}>
        {error ? <ErrorBox message={error} /> : invoice == null ? <Loading label="טוען את החשבונית…" /> : (
          <div className="flex h-[28rem] flex-col">
            <BagrutTable rows={invoice} columns={invColumns} rowKey={(r) => String(r.id)}
              exportName={`מיתר_חשבונית_${m.month.slice(0, 7)}`} sheetName="חשבונית" countLabel="שורות"
              initialSort={{ key: 'pay', dir: 'desc' }} storageKey="meitar-invoice" />
          </div>
        )}
      </Card>
    </div>
  )
}
