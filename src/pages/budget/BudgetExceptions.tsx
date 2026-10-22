import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorBox, Loading } from '@/components/bagrut/ui'
import { fetchMeitarEntities, fetchMeitarRuns, fetchMeitarTopics, fetchMonthTopics, fetchTopicTotals, schoolYearOf } from '@/lib/meitar'
import { hebrewSchoolYear } from '@/lib/budgetCalc'
import {
  cardExceptions,
  EXCEPTION_META,
  meitarExceptions,
  reviewStillValid,
  type BudgetException,
  type ExceptionKind,
} from '@/lib/budgetInsights'
import { deleteExceptionReview, fetchExceptionReviews, reviewKey, saveExceptionReview, type ExceptionReview } from '@/lib/budgetTracking'
import { fmtDate } from '@/lib/bagrutCycle'
import { useBudget, type CardNavState } from './context'

type Show = 'open' | 'reviewed' | 'all'
const SHOW_LABELS: Record<Show, string> = { open: 'לטיפול', reviewed: 'נבדקו', all: 'הכול' }

/**
 * חריגות לטיפול (025, רעיון 3): כללים קבועים ושקופים על כל כרטיס — הוצאה מעל
 * התקציב, מחויב מעל התקציב (עם הזמנות פתוחות), צפי לחריגה, הוצאה מהירה מהקצב,
 * הכנסה מפגרת, הוצאה בלי תקציב — ולמנהל גם כסף ממשרד החינוך שלא נרשם. הכללים
 * והספים — ב-lib/budgetInsights. אחראי רואה רק את הכרטיסים שלו (ה-RLS).
 *
 * "בדקתי" + הערה נשמרים במסד (049), עם הסכום שנבדק: אם הסכום זז ביותר מ-5%,
 * החריגה חוזרת לטיפול.
 */
export default function BudgetExceptions() {
  const b = useBudget()
  const navigate = useNavigate()
  const { search } = useLocation()
  const [params, setParams] = useSearchParams()
  const show = (['open', 'reviewed', 'all'] as string[]).includes(params.get('show') ?? '') ? (params.get('show') as Show) : 'open'
  const kind = params.get('kind') as ExceptionKind | null
  const [reviews, setReviews] = useState<Map<string, ExceptionReview> | null>(null)
  const [meitar, setMeitar] = useState<BudgetException[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setReviews(null)
    fetchExceptionReviews(b.code, b.year, b.period).then(setReviews).catch((e: Error) => setError(e.message))
  }, [b.code, b.year, b.period])

  // נושאי מיתר — למי שרואה את המיתר (לא לאחראי)
  useEffect(() => {
    if (b.isOwner) return
    let alive = true
    // ה-run האחרון של המועצה (המוטב), והמצטבר שלו בשנה"ל — כמו מסכי המיתר (024):
    // בלי שורות של שנה"ל קודמת ובלי קבצי המשרות, שהיו מנפחים את "טרם נרשם"
    Promise.all([fetchMeitarEntities(b.code), fetchMeitarRuns(b.code)]).then(async ([entities, runs]) => {
      const council = entities.find((e) => e.active && e.kind === 'moteb')
      const run = council ? runs.find((r) => r.entity_code === council.entity_code) : undefined
      if (!council || !run) return
      const month = run.calc_month.slice(0, 10)
      const sy = schoolYearOf(month)
      const [months, booked, index] = await Promise.all([
        fetchMonthTopics(b.code, council.entity_code, sy, null),
        fetchTopicTotals(b.code, `${sy - 1}-09-01`, `${sy}-09-01`),
        fetchMeitarTopics(),
      ])
      const topics = months.filter((r) => r.calc_month === month && r.computed).map((r) => ({
        code: r.topic_code, name: index.get(r.topic_code)?.name ?? '', computed: r.computed,
        booked: booked.get(r.topic_code)?.booked ?? null,
      }))
      if (alive) setMeitar(meitarExceptions(topics, run.calc_month, b.asOf))
    }).catch(() => alive && setMeitar([]))
    return () => {
      alive = false
    }
  }, [b.code, b.isOwner, b.asOf])

  const all = useMemo(() => {
    const orders = new Map(b.rows.map((r) => [r.code, r.openOrders]))
    return [...cardExceptions(b.rows, b.elapsed, orders), ...meitar]
  }, [b.rows, b.elapsed, meitar])

  const isReviewed = (x: BudgetException) => {
    const r = reviews?.get(reviewKey(x.key, x.kind))
    return Boolean(r && reviewStillValid(r.value_at_review, x.value))
  }
  const counts = useMemo(() => {
    const byKind = new Map<ExceptionKind, number>()
    let open = 0
    for (const x of all) {
      if (isReviewed(x)) continue
      open++
      byKind.set(x.kind, (byKind.get(x.kind) ?? 0) + 1)
    }
    return { open, reviewed: all.length - open, byKind }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, reviews])
  const shown = all.filter((x) => (!kind || x.kind === kind) && (show === 'all' || (show === 'reviewed') === isReviewed(x)))
    .sort((a, c) => (EXCEPTION_META[a.kind].tone === 'red' ? 0 : 1) - (EXCEPTION_META[c.kind].tone === 'red' ? 0 : 1) || c.value - a.value)

  const set = (k: string, v: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (v) next.set(k, v)
      else next.delete(k)
      return next
    }, { replace: true })

  if (error) return <ErrorBox message={error} />
  if (!reviews) return <Loading label="בודק חריגות…" />

  const periodLabel = b.period === 'calendar' ? `ינואר–דצמבר ${b.year}` : `שנה"ל ${hebrewSchoolYear(b.year)}`
  const tab = (active: boolean) => `rounded-md px-2.5 py-0.5 font-semibold ${active ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'}`
  const openCard = (code: string) => {
    const nav: CardNavState = { codes: shown.filter((x) => !x.key.startsWith('topic:')).map((x) => x.key), fromLabel: 'חריגות לטיפול', backTo: `${b.base}/exceptions${search}` }
    navigate(`${b.base}/card/${code}${search}`, { state: nav })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h1 className="text-lg font-bold text-slate-800">חריגות לטיפול</h1>
        <span className="rounded-lg bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">{periodLabel}</span>
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {(Object.keys(SHOW_LABELS) as Show[]).map((k) => (
            <button key={k} onClick={() => set('show', k === 'open' ? null : k)} className={tab(show === k)}>
              {SHOW_LABELS[k]} <span className="text-xs font-normal opacity-70">({k === 'open' ? counts.open : k === 'reviewed' ? counts.reviewed : all.length})</span>
            </button>
          ))}
        </div>
        <select value={kind ?? ''} onChange={(e) => set('kind', e.target.value || null)} className="rounded-lg border border-slate-300 px-2 py-1">
          <option value="">כל הסוגים</option>
          {(Object.keys(EXCEPTION_META) as ExceptionKind[]).map((k) => (
            <option key={k} value={k}>{EXCEPTION_META[k].label}{counts.byKind.get(k) ? ` (${counts.byKind.get(k)})` : ''}</option>
          ))}
        </select>
      </div>
      <p className="text-xs text-slate-500">
        כללים קבועים על כל כרטיס, לפי הנתונים עד {b.asOf ? new Date(b.asOf).toLocaleDateString('he-IL') : '—'}. "בדקתי" נשמר עם הסכום —
        אם הוא משתנה ביותר מ-5%, החריגה חוזרת לטיפול. סכומים מתחת ל-₪5,000 אינם נחשבים חריגה.
      </p>

      {!shown.length ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
          {show === 'open' ? 'אין חריגות לטיפול.' : 'אין חריגות בתצוגה הזו.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((x) => (
            <ExceptionRow key={`${x.key}|${x.kind}`} x={x} review={reviews.get(reviewKey(x.key, x.kind))} reviewed={isReviewed(x)}
              canReview={b.canPlan} onOpen={x.key.startsWith('topic:') ? () => navigate(`${b.base}/meitar${search}`) : () => openCard(x.key)}
              onSaved={(r) => setReviews((m) => new Map(m).set(reviewKey(x.key, x.kind), r))}
              onCleared={() => setReviews((m) => { const n = new Map(m); n.delete(reviewKey(x.key, x.kind)); return n })} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ExceptionRow({ x, review, reviewed, canReview, onOpen, onSaved, onCleared }: {
  x: BudgetException
  review: ExceptionReview | undefined
  reviewed: boolean
  canReview: boolean
  onOpen: () => void
  onSaved: (r: ExceptionReview) => void
  onCleared: () => void
}) {
  const b = useBudget()
  const meta = EXCEPTION_META[x.kind]
  const [note, setNote] = useState(review?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const who = review ? review.reviewed_email ?? (review.reviewed_by ? 'מנהל על' : '') : ''

  return (
    <li className={`rounded-xl border bg-white p-3 shadow-sm ${reviewed ? 'border-slate-200 opacity-75' : meta.tone === 'red' ? 'border-red-200' : 'border-amber-200'}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${meta.tone === 'red' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`} title={meta.hint}>{meta.label}</span>
        <button onClick={onOpen} className="text-sm font-semibold text-slate-800 hover:text-emerald-700 hover:underline">
          {x.key.startsWith('topic:') ? x.title : <><span className="font-mono text-xs text-slate-500" dir="ltr">{x.key}</span> {x.title}</>}
        </button>
        {x.row?.meta?.owner_name && <span className="text-xs text-slate-500">באחריות {x.row.meta.owner_name}</span>}
        {reviewed && review && <span className="rounded bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700">✓ נבדק{who ? ` ע"י ${who}` : ''} · {fmtDate(review.reviewed_at)}</span>}
        {!reviewed && review && <span className="rounded bg-amber-50 px-1.5 text-xs text-amber-700">נבדק בעבר — הסכום השתנה מאז</span>}
      </div>
      <p className="mt-1 text-sm text-slate-700">{x.detail}</p>
      {canReview && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="מה נבדק / מה הוחלט"
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-sm focus:border-emerald-400 focus:outline-none" />
          {!reviewed || note !== (review?.note ?? '') ? (
            <button disabled={busy} onClick={() => run(async () => onSaved(await saveExceptionReview(b.code, b.year, b.period, x.key, x.kind, x.value, note)))}
              className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">✓ בדקתי</button>
          ) : null}
          {reviewed && (
            <button disabled={busy} onClick={() => run(async () => { await deleteExceptionReview(b.code, b.year, b.period, x.key, x.kind); onCleared(); setNote('') })}
              className="rounded-md px-3 py-1 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50">החזרה לטיפול</button>
          )}
        </div>
      )}
      {!canReview && review?.note && <p className="mt-1 text-xs text-slate-500">הערה: {review.note}</p>}
      {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
    </li>
  )
}
