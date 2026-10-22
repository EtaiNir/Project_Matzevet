import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Outlet, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { Empty, ErrorBox, Loading } from '@/components/bagrut/ui'
import {
  fetchInstitutionTotals,
  fetchInvoiceMonths,
  fetchMeitarEntities,
  fetchMeitarRuns,
  fetchMeitarTopics,
  fetchMonthTopics,
  fetchTopicPlans,
  fetchTopicTotals,
  monthLong,
  periodMonths,
  periodSchoolYears,
  type InstitutionTotal,
  type InvoiceMonth,
  type MeitarEntity,
  type MeitarRun,
  type MeitarTopic,
  type MonthTopic,
  type TopicPlan,
} from '@/lib/meitar'
import { periodRange } from '@/lib/budgetCalc'
import { MeitarContext, type BudgetBase, type MeitarContextValue } from './context'

interface YearData {
  monthTopics: MonthTopic[]
  invoiceMonths: InvoiceMonth[]
  plans: Map<string, TopicPlan>
  booked: Map<string, { booked: number; count: number }>
  instTotals: InstitutionTotal[]
}

/**
 * המיתר — ההכנסות ממשרד החינוך (החלטה 024). המקבילה של הטפסים באקסס של סבא:
 * "מיתר – מצטבר חודשי למעקב ותכנון" (נושאים), "מיתר – הכנסות ברמת הסעיף" (נושא),
 * "ריכוז מוסדות חודשי" (מוסדות), "ריכוז הורדות מיתר" (הורדות).
 *
 * השנה והתקופה — מהבורר בכותרת המודול, כמו בשאר מסכי התקציב (אייל, 22.10).
 * בכתובת כאן: entity (מקור) ו-m (חודש חישוב). לא תלוי בכרטסת.
 */
export default function MeitarShell() {
  const { code = '' } = useParams()
  const base = useOutletContext<BudgetBase>()
  const [params, setParams] = useSearchParams()
  const [entities, setEntities] = useState<MeitarEntity[] | null>(null)
  const [runs, setRuns] = useState<MeitarRun[] | null>(null)
  const [topics, setTopics] = useState<Map<string, MeitarTopic>>(new Map())
  const [data, setData] = useState<YearData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const year = base?.year ?? new Date().getFullYear()
  const period = base?.period ?? 'calendar'

  useEffect(() => {
    setEntities(null)
    setRuns(null)
    setError(null)
    Promise.all([fetchMeitarEntities(code), fetchMeitarRuns(code), fetchMeitarTopics()])
      .then(([e, r, t]) => {
        setEntities(e)
        setRuns(r)
        setTopics(t)
      })
      .catch((e: Error) => setError(e.message))
  }, [code])

  // עדכון אחד לכמה פרמטרים — שתי קריאות רצופות היו דורסות זו את זו
  const patch = useCallback((values: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(values)) {
        if (v == null) next.delete(k)
        else next.set(k, v)
      }
      return next
    }, { replace: true }), [setParams])
  const setParam = useCallback((k: string, v: string | null) => patch({ [k]: v }), [patch])

  // המקור, ומאיפה הנתונים שלו
  const active = useMemo(() => (entities ?? []).filter((e) => e.active), [entities])
  const entity = active.find((e) => e.entity_code === params.get('entity'))
    ?? active.find((e) => e.kind === 'moteb') ?? active[0] ?? null
  const moteb = active.find((e) => e.kind === 'moteb') ?? null
  const institution = entity?.kind === 'mosad' && moteb ? entity.entity_code : null
  const dataEntity = institution ? moteb!.entity_code : (entity?.entity_code ?? '')

  const months12 = useMemo(() => periodMonths(year, period), [year, period])
  const entityRuns = useMemo(() => (runs ?? []).filter((r) => r.entity_code === dataEntity), [runs, dataEntity])
  const months = useMemo(() => entityRuns.map((r) => r.calc_month.slice(0, 10))
    .filter((m) => months12.includes(m)).sort(), [entityRuns, months12])
  const month = months.includes(params.get('m') ?? '') ? params.get('m') : (months[months.length - 1] ?? null)

  // נתוני התקופה — קלנדרית נוגעת בשתי שנות לימודים. מונה בקשות: תשובה ישנה לא דורסת חדשה (מלכודת 26)
  const seq = useRef(0)
  useEffect(() => {
    if (!entity || !dataEntity) return
    const mine = ++seq.current
    setData(null)
    const years = periodSchoolYears(year, period)
    const range = periodRange(year, period)
    const withInvoice = !institution
    Promise.all([
      Promise.all(years.map((y) => fetchMonthTopics(code, dataEntity, y, institution))).then((a) => a.flat()),
      withInvoice ? Promise.all(years.map((y) => fetchInvoiceMonths(code, dataEntity, y))).then((a) => a.flat()) : Promise.resolve([]),
      // התכנון הוא לשנה"ל — בתצוגה הקלנדרית אין מה להשוות מולו
      period === 'school' ? fetchTopicPlans(code, entity.entity_code, year) : Promise.resolve([]),
      entity.kind === 'moteb' ? fetchTopicTotals(code, range.from, range.to).catch(() => new Map()) : Promise.resolve(new Map()),
      Promise.all(years.map((y) => fetchInstitutionTotals(code, y))).then((a) => a.flat()),
    ])
      .then(([monthTopics, invoiceMonths, plans, booked, instTotals]) => {
        if (mine !== seq.current) return
        setData({ monthTopics, invoiceMonths, plans: new Map(plans.map((p) => [p.topic_code, p])), booked, instTotals })
      })
      .catch((e: Error) => mine === seq.current && setError(e.message))
  }, [code, entity, dataEntity, institution, year, period])

  const applyPlan = useCallback((p: TopicPlan) => {
    setData((d) => (d ? { ...d, plans: new Map(d.plans).set(p.topic_code, p) } : d))
  }, [])

  const ctx = useMemo<MeitarContextValue | null>(() => {
    if (!entities || !runs || !data) return null
    const keep = (extra?: Record<string, string>) => {
      const q = new URLSearchParams()
      for (const k of ['year', 'period', 'entity', 'm']) {
        const v = params.get(k)
        if (v) q.set(k, v)
      }
      for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v)
      const s = q.toString()
      return s ? `?${s}` : ''
    }
    return {
      code,
      authorityName: base?.authorityName ?? '',
      canManage: Boolean(base?.canManage),
      base: `/budget/${code}/meitar`,
      entities: active,
      entity,
      institution,
      dataEntity,
      runs: entityRuns,
      year,
      period,
      schoolYear: year,
      months12,
      months,
      month,
      topics,
      ...data,
      applyPlan,
      setParam,
      to: (path, extra) => `/budget/${code}/meitar${path ? `/${path}` : ''}${keep(extra)}`,
    }
  }, [entities, runs, data, code, base, active, entity, institution, dataEntity, entityRuns, year, period,
    months12, months, month, topics, applyPlan, setParam, params])

  if (base?.isOwner) return <Navigate to={`/budget/${code}`} replace />

  const select = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="text-lg font-bold text-slate-800">מיתר</h1>
        {active.length > 0 && (
          <select value={entity?.entity_code ?? ''} onChange={(e) => patch({ entity: e.target.value, m: null })}
            className={`${select} font-semibold`} title="המקור: המועצה או בית ספר">
            {active.filter((e) => e.kind === 'moteb').map((e) => <option key={e.entity_code} value={e.entity_code}>{e.name}</option>)}
            {active.some((e) => e.kind === 'mosad') && (
              <optgroup label="בתי ספר">
                {active.filter((e) => e.kind === 'mosad').map((e) => <option key={e.entity_code} value={e.entity_code}>{e.name}</option>)}
              </optgroup>
            )}
          </select>
        )}
        {months.length > 0 && (
          <select value={month ?? ''} onChange={(e) => setParam('m', e.target.value)} className={select} title="חודש החישוב">
            {[...months].reverse().map((m) => <option key={m} value={m}>עד {monthLong(m)}</option>)}
          </select>
        )}
        <span className="text-xs text-slate-500">
          {period === 'school' ? 'שנה"ל — המצטבר מקובץ המשרד' : 'ינואר–דצמבר — המצטבר = מה שנכנס מינואר'}
          {institution && ` · מתוך הקובץ של ${moteb?.name}`}
        </span>
      </div>
      {error ? <div className="p-4"><ErrorBox message={error} /></div>
        : entities && active.length === 0 ? (
          <Empty title="אין מקורות מיתר לרשות">
            מנהל־על מוסיף את המועצה (סמל מוטב) ואת בתי הספר (סמל מוסד) בניהול ← נתונים ← תקציב.
          </Empty>
        ) : ctx ? (
          <MeitarContext.Provider value={ctx}>
            <Outlet />
          </MeitarContext.Provider>
        ) : <Loading label="טוען את המיתר…" />}
    </div>
  )
}
