import { useEffect, useMemo, useRef, useState } from 'react'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { AmountCell } from '@/components/budget/InlineCells'
import { Card, Empty, ErrorBox, Kpi, Loading } from '@/components/bagrut/ui'
import {
  fetchMeitarInvoice,
  fetchMeitarRows,
  fetchMeitarRuns,
  fetchTopicPlans,
  fetchTopicTotals,
  saveTopicPlan,
  type MeitarInvoiceRow,
  type MeitarRow,
  type MeitarRun,
  type TopicPlan,
} from '@/lib/budget'
import { hebrewSchoolYear, money } from '@/lib/budgetCalc'
import { useBudget } from './context'

interface TopicRow {
  code: string
  name: string
  chashavut: string
  /** "הפרש לתשלום" בחשבונית — מה שמשולם עכשיו, כולל רטרואקטיבי */
  toPay: number
  /** מתוכו — עדכונים לחודשי תחולה קודמים */
  retro: number
  /** סכום מחושב מצטבר מתחילת השנה (מהפירוט) */
  computed: number | null
  computedPrev: number | null
  /** סכום "הפרש מחושב" בפירוט — להתאמה מול החשבונית */
  detailDiff: number | null
  /** מה שנרשם בכרטסת לנושא בשנת הלימודים (זכות − חובה) */
  booked: number | null
  plan: TopicPlan | null
}

/** "9/2026" או "2026-09-01" → שנת הלימודים לפי שנת הסיום (ספטמבר פותח שנה חדשה) */
function schoolYearOf(calcMonth: string): number {
  const d = new Date(calcMonth)
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear()
}

/**
 * המיתר — ההכנסות ממשרד החינוך, לפי נושא. מפת הדרכים (§8): **ההפרש הוא
 * הנתון, לא הסכום** — סכום מצטבר אומר מה קרה, ההפרש אומר מה השתנה החודש.
 * לכן "לתשלום החודש" היא העמודה הראשונה, ורטרואקטיבי מסומן בנפרד.
 */
export default function BudgetMeitar() {
  const b = useBudget()
  const [runs, setRuns] = useState<MeitarRun[] | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<MeitarInvoiceRow[] | null>(null)
  const [rows, setRows] = useState<MeitarRow[] | null>(null)
  const [plans, setPlans] = useState<Map<string, TopicPlan>>(new Map())
  const [booked, setBooked] = useState<Map<string, { booked: number; count: number }>>(new Map())
  const [topic, setTopic] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // שגיאת שמירה — מוצגת מעל הטבלה, לא במקום המסך כולו
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setRuns(null)
    fetchMeitarRuns(b.code)
      .then((r) => {
        setRuns(r)
        setRunId(r[0]?.id ?? null)
      })
      .catch((e: Error) => setError(e.message))
  }, [b.code])

  const run = runs?.find((r) => r.id === runId) ?? null
  const schoolYear = run ? schoolYearOf(run.calc_month) : null
  const seq = useRef(0)
  useEffect(() => {
    if (!run || schoolYear == null) return
    const mine = ++seq.current
    setInvoice(null)
    setRows(null)
    setTopic(null)
    // שנת הלימודים של חודש החישוב: ספטמבר עד אוגוסט
    const from = `${schoolYear - 1}-09-01`
    const to = `${schoolYear}-09-01`
    Promise.all([fetchMeitarInvoice(run.id), fetchMeitarRows(run.id), fetchTopicPlans(b.code, schoolYear), fetchTopicTotals(b.code, from, to)])
      .then(([inv, det, pl, tot]) => {
        if (mine !== seq.current) return
        setInvoice(inv)
        setRows(det)
        setPlans(new Map(pl.map((p) => [p.topic_code, p])))
        setBooked(tot)
      })
      .catch((e: Error) => mine === seq.current && setError(e.message))
  }, [run, schoolYear, b.code])

  const calcIso = run?.calc_month.slice(0, 7) ?? ''
  const topics: TopicRow[] = useMemo(() => {
    if (!invoice || !rows) return []
    const by = new Map<string, TopicRow>()
    const isCurrent = (effect: string | null) => {
      // "09/2026" או "2026/09" או "202609" — משווים לחודש החישוב
      const s = (effect ?? '').replace(/\D/g, '')
      const iso = s.length === 6 ? (s.startsWith('20') ? `${s.slice(0, 4)}-${s.slice(4)}` : `${s.slice(2)}-${s.slice(0, 2)}`) : ''
      return !iso || iso === calcIso
    }
    for (const r of invoice) {
      const t = by.get(r.topic_code) ?? {
        code: r.topic_code, name: r.topic_name ?? '', chashavut: r.chashavut ?? '', toPay: 0, retro: 0,
        computed: null, computedPrev: null, detailDiff: null,
        booked: booked.get(r.topic_code)?.booked ?? null, plan: plans.get(r.topic_code) ?? null,
      }
      t.toPay += r.to_pay ?? 0
      if (!isCurrent(r.effect_month)) t.retro += r.to_pay ?? 0
      by.set(r.topic_code, t)
    }
    for (const r of rows) {
      if (!r.topic_code || !by.has(r.topic_code)) continue
      const t = by.get(r.topic_code)!
      t.computed = (t.computed ?? 0) + (r.computed ?? 0)
      t.computedPrev = (t.computedPrev ?? 0) + (r.computed_prev ?? 0)
      t.detailDiff = (t.detailDiff ?? 0) + (r.diff ?? 0)
    }
    return [...by.values()].sort((a, c) => Math.abs(c.toPay) - Math.abs(a.toPay))
  }, [invoice, rows, plans, booked, calcIso])

  if (error) return <ErrorBox message={error} />
  if (runs == null) return <Loading label="טוען את המיתר…" />
  if (runs.length === 0) {
    return <Empty title="עוד לא נקלטו קובצי מיתר">את ה-ZIP החודשי מורידים מאתר המיתר של משרד החינוך ומעלים במסך הקליטה.</Empty>
  }

  const total = topics.reduce((s, t) => s + t.toPay, 0)
  const retro = topics.reduce((s, t) => s + t.retro, 0)
  const cumulative = topics.reduce((s, t) => s + (t.computed ?? 0), 0)
  const unmatched = topics.filter((t) => t.detailDiff != null && Math.abs(t.detailDiff - t.toPay) >= 1)

  const savePlanField = (t: TopicRow, field: 'budget' | 'forecast' | 'next_year') => async (v: number | null) => {
    setSaveError(null)
    try {
      const saved = await saveTopicPlan(b.code, t.code, schoolYear!, { [field]: v }, t.plan)
      setPlans((m) => new Map(m).set(saved.topic_code, saved))
    } catch (e) {
      setSaveError(`נושא ${t.code}: ${(e as Error).message}`)
      throw e
    }
  }

  const columns: Column<TopicRow>[] = [
    { key: 'code', header: 'נושא', width: 60, sticky: true, render: (t) => <span className="font-mono text-xs text-slate-500">{t.code}</span>, sortValue: (t) => t.code, exportValue: (t) => t.code },
    { key: 'name', header: 'שם הנושא', width: 200, render: (t) => <span className="truncate font-medium text-slate-800">{t.name}</span>, sortValue: (t) => t.name },
    { key: 'pay', header: 'לתשלום החודש', width: 120, render: (t) => <span className={`font-bold tabular-nums ${t.toPay < 0 ? 'text-red-700' : 'text-emerald-800'}`}>{money(t.toPay)}</span>, sortValue: (t) => t.toPay, exportValue: (t) => Math.round(t.toPay), filter: false },
    { key: 'retro', header: 'מתוכו רטרואקטיבי', width: 120, render: (t) => (t.retro ? <span className="tabular-nums text-amber-700">{money(t.retro)}</span> : ''), sortValue: (t) => t.retro, exportValue: (t) => Math.round(t.retro), filter: false },
    { key: 'cum', header: 'מצטבר מתחילת השנה', width: 130, render: (t) => <span className="tabular-nums text-slate-600">{money(t.computed)}</span>, sortValue: (t) => t.computed, exportValue: (t) => t.computed, filter: false },
    {
      key: 'booked', header: 'נרשם בהנהח"ש', width: 116, filter: false,
      render: (t) => <span className="tabular-nums text-teal-700" title="תקבולים בכרטסת שהנושא שלהם נגזר מ'פרטים' — בשנת הלימודים">{money(t.booked)}</span>,
      sortValue: (t) => t.booked, exportValue: (t) => t.booked,
    },
    {
      key: 'gap', header: 'טרם נרשם', width: 104, filter: false,
      render: (t) => t.computed == null || t.booked == null ? '' : <span className="tabular-nums text-amber-700">{money(t.computed - t.booked)}</span>,
      sortValue: (t) => (t.computed == null || t.booked == null ? null : t.computed - t.booked),
      exportValue: (t) => (t.computed == null || t.booked == null ? null : Math.round(t.computed - t.booked)),
    },
    { key: 'prev', header: 'מצטבר קודם', width: 110, render: (t) => <span className="tabular-nums text-slate-400">{money(t.computedPrev)}</span>, sortValue: (t) => t.computedPrev, exportValue: (t) => t.computedPrev, filter: false },
    {
      key: 'match', header: 'התאמה', width: 70, filter: false,
      render: (t) => t.detailDiff == null ? <span className="text-xs text-slate-300">אין פירוט</span>
        : Math.abs(t.detailDiff - t.toPay) < 1 ? <span className="text-emerald-600">✓</span>
          : <span className="text-xs font-semibold text-amber-700" title={`בפירוט: ${money(t.detailDiff)}`}>פער</span>,
      sortValue: (t) => (t.detailDiff == null ? 1 : Math.abs(t.detailDiff - t.toPay) < 1 ? 0 : 2),
    },
    { key: 'budget', header: 'תקציב לשנה', width: 116, filter: false, render: (t) => <AmountCell value={t.plan?.budget ?? null} disabled={!b.canManage} onSave={savePlanField(t, 'budget')} />, sortValue: (t) => t.plan?.budget, exportValue: (t) => t.plan?.budget ?? null },
    { key: 'forecast', header: 'צפי לסוף השנה', width: 116, filter: false, render: (t) => <AmountCell value={t.plan?.forecast ?? null} disabled={!b.canManage} onSave={savePlanField(t, 'forecast')} />, sortValue: (t) => t.plan?.forecast, exportValue: (t) => t.plan?.forecast ?? null },
    { key: 'next', header: 'שנה הבאה', width: 116, filter: false, render: (t) => <AmountCell value={t.plan?.next_year ?? null} disabled={!b.canManage} onSave={savePlanField(t, 'next_year')} />, sortValue: (t) => t.plan?.next_year, exportValue: (t) => t.plan?.next_year ?? null },
    { key: 'hesh', header: 'חשבות', width: 80, render: (t) => <span className="text-xs text-slate-500">{t.chashavut}</span>, sortValue: (t) => t.chashavut },
  ]

  const detail = topic ? (rows ?? []).filter((r) => r.topic_code === topic) : []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-slate-800">מיתר — הכנסות ממשרד החינוך</h1>
        <select value={runId ?? ''} onChange={(e) => setRunId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
          {runs.map((r) => <option key={r.id} value={r.id}>חודש חישוב {new Date(r.calc_month).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</option>)}
        </select>
        {schoolYear && <span className="text-sm text-slate-500">שנה"ל {hebrewSchoolYear(schoolYear)}</span>}
      </div>

      {invoice == null || rows == null ? <Loading label="טוען את החודש…" /> : (
        <>
          <div className="flex flex-wrap gap-3">
            <Kpi value={money(total)} label="לתשלום החודש" tone="green" sub="סכום 'הפרש לתשלום' בחשבונית — מה שהשתנה" />
            <Kpi value={money(retro)} label="מתוכו רטרואקטיבי" tone={retro ? 'amber' : 'slate'} sub="עדכונים לחודשי תחולה קודמים" />
            <Kpi value={money(cumulative)} label="מצטבר מתחילת השנה" sub="סכום מחושב בקובצי הפירוט" />
            <Kpi value={`${topics.length - unmatched.length}/${topics.length}`} label="נושאים מתיישבים" tone={unmatched.length ? 'amber' : 'green'}
              sub={unmatched.length ? `פער ב: ${unmatched.map((t) => t.code).join(', ')}` : 'החשבונית = סכום הפירוט'} />
          </div>
          {saveError && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{saveError}</p>}
          <BagrutTable rows={topics} columns={columns} rowKey={(t) => t.code} onRowClick={(t) => setTopic(t.code === topic ? null : t.code)}
            exportName={`מיתר_${b.authorityName || b.code}_${calcIso}`} sheetName={`מיתר ${calcIso}`} countLabel="נושאים"
            initialSort={{ key: 'pay', dir: 'desc' }} storageKey="budget-meitar" empty="אין נושאים בחשבונית" />
          {topic && (
            <Card title={`פירוט נושא ${topic} — ${topics.find((t) => t.code === topic)?.name ?? ''}`}
              action={<button onClick={() => setTopic(null)} className="text-sm text-slate-500 hover:text-slate-800">✕ סגירה</button>}>
              <TopicDetail rows={detail} calcIso={calcIso} />
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function TopicDetail({ rows, calcIso }: { rows: MeitarRow[]; calcIso: string }) {
  const columns: Column<MeitarRow>[] = [
    { key: 'file', header: 'קובץ', width: 90, render: (r) => <span className="font-mono text-xs text-slate-400">{r.source_file}</span>, sortValue: (r) => r.source_file },
    { key: 'inst', header: 'מוסד / יישוב', width: 200, render: (r) => <span className="truncate">{r.institution_name || r.settlement_name || ''}</span>, sortValue: (r) => r.institution_name || r.settlement_name },
    { key: 'effect', header: 'חודש תחולה', width: 90, render: (r) => <span className="tabular-nums">{r.effect_month}</span>, sortValue: (r) => r.effect_month },
    { key: 'units', header: 'יחידות', width: 80, render: (r) => <span className="tabular-nums">{r.units ?? ''}</span>, sortValue: (r) => r.units, exportValue: (r) => r.units, filter: false },
    { key: 'computed', header: 'סכום מחושב', width: 110, render: (r) => <span className="tabular-nums">{money(r.computed)}</span>, sortValue: (r) => r.computed, exportValue: (r) => r.computed, filter: false },
    { key: 'prev', header: 'מחושב קודם', width: 110, render: (r) => <span className="tabular-nums text-slate-500">{money(r.computed_prev)}</span>, sortValue: (r) => r.computed_prev, exportValue: (r) => r.computed_prev, filter: false },
    {
      key: 'diff', header: 'הפרש', width: 100, filter: false,
      render: (r) => <span className={`font-semibold tabular-nums ${r.diff ? (r.diff < 0 ? 'text-red-700' : 'text-emerald-700') : 'text-slate-300'}`}>{money(r.diff)}</span>,
      sortValue: (r) => r.diff, exportValue: (r) => r.diff,
    },
  ]
  const moved = rows.filter((r) => r.diff)
  return (
    <div className="flex h-[24rem] flex-col">
      <p className="mb-2 text-xs text-slate-500">
        {moved.length} שורות עם הפרש החודש. שורה שחודש התחולה שלה לפני {calcIso} והפרש שלה אינו אפס — עדכון רטרואקטיבי.
      </p>
      <BagrutTable rows={rows} columns={columns} rowKey={(r) => String(r.id)} exportName="פירוט_מיתר" sheetName="פירוט"
        countLabel="שורות" initialSort={{ key: 'diff', dir: 'desc' }} storageKey="budget-meitar-detail" />
    </div>
  )
}
