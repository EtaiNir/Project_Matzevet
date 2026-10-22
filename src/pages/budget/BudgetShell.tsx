import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import Logo from '@/components/brand/Logo'
import ModuleSwitch from '@/components/ModuleSwitch'
import HomeLink from '@/components/HomeLink'
import { Empty, ErrorBox, Loading } from '@/components/bagrut/ui'
import { BUDGET_ROLE_LABELS, fetchAuthorities, type Authority } from '@/lib/admin'
import {
  fetchBudgetYears,
  fetchCards,
  fetchMeta,
  fetchMonthly,
  fetchOrders,
  fetchPlans,
  type BudgetCard,
  type CardMeta,
  type CardPlan,
  type MonthlyRow,
} from '@/lib/budget'
import { buildRows, elapsedMonths, hebrewSchoolYear, periodRange, type Period } from '@/lib/budgetCalc'
import { openOrdersByCard, seasonalSuggestions } from '@/lib/budgetInsights'
import { fetchPlanReviews, type PlanReview } from '@/lib/budgetTracking'
import { BudgetContext, type BudgetContextValue } from './context'
import { IconChartBars, IconFlag, IconHistory, IconLandmark, IconList, IconReceipt, IconSliders, IconTable, IconUpload } from '@/components/brand/Icons'

/** אייקון בסרגל — 18px, אפור; בקישור הפעיל מקבל את צבע הקישור */
const ICON = 'h-[18px] w-[18px] shrink-0 opacity-70'

interface Loaded {
  cards: BudgetCard[]
  meta: Map<string, CardMeta>
  plans: Map<string, CardPlan>
  monthly: MonthlyRow[]
  // 024 — אותם חודשים בשנה שעברה (לצפי העונתי), ההזמנות, ומצב אישור התכנית
  prevMonthly: MonthlyRow[]
  openOrders: Map<string, number>
  planReviews: Map<string, PlanReview>
}

/**
 * מעטפת מודול התקציב (החלטה 023) — בנויה כמו מעטפת הבגרות: כותרת עם בורר
 * רשות, מחליף המודולים והאזור האישי; סרגל ניווט; והמסכים ב-Outlet.
 *
 * כאן נטען פעם אחת מה שכל המסכים צריכים: הכרטסת של השנה, שכבת המשתמש
 * (קטגוריות, צפי, תכנון) והביצוע החודשי. שמירה במסך מעדכנת את המצב כאן
 * מהשורה שהשרת החזיר (מלכודת 26) — בלי לטעון הכול מחדש.
 */
export default function BudgetShell() {
  const { profile, signOut } = useAuth()
  const { code: codeFromUrl } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const isSuperAdmin = profile?.role === 'super_admin'

  const [allAuthorities, setAllAuthorities] = useState<Authority[]>([])
  useEffect(() => {
    fetchAuthorities().then(setAllAuthorities).catch(() => setAllAuthorities([]))
  }, [])
  const authorities = isSuperAdmin
    ? allAuthorities.filter((a) => a.is_active).map((a) => a.code)
    : (profile?.authority_codes ?? [])
  const code = codeFromUrl ?? ''

  const [years, setYears] = useState<number[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  const year = Number(params.get('year')) || years?.[0] || new Date().getFullYear()
  const period: Period = params.get('period') === 'school' ? 'school' : 'calendar'

  // השנים שיש בהן כרטסת — בכל החלפת רשות
  useEffect(() => {
    if (!code) return
    setYears(null)
    setError(null)
    fetchBudgetYears(code).then(setYears).catch((e: Error) => setError(e.message))
  }, [code])

  // מונה בקשות — תשובה ישנה (רשות/שנה קודמת) לא דורסת חדשה (מלכודת 26)
  const seq = useRef(0)
  useEffect(() => {
    if (!code || !years?.length) return
    const mine = ++seq.current
    setLoaded(null)
    setError(null)
    const range = periodRange(year, period)
    const prev = periodRange(year - 1, period)
    Promise.all([
      fetchCards(code, year), fetchMeta(code), fetchPlans(code, year), fetchMonthly(code, range.from, range.to),
      // 024 — לא חוסמים את המסכים אם אחד מאלה נכשל: בלעדיהם הכול כמו שהיה
      fetchMonthly(code, prev.from, prev.to).catch(() => [] as MonthlyRow[]),
      fetchOrders(code).catch(() => []),
      fetchPlanReviews(code, year).catch(() => new Map<string, PlanReview>()),
    ])
      .then(([cards, meta, plans, monthly, prevMonthly, orders, planReviews]) => {
        if (mine !== seq.current) return
        setLoaded({
          cards,
          meta: new Map(meta.map((m) => [m.card_code, m])),
          plans: new Map(plans.map((p) => [p.card_code, p])),
          monthly,
          prevMonthly,
          openOrders: openOrdersByCard(orders),
          planReviews,
        })
      })
      .catch((e: Error) => mine === seq.current && setError(e.message))
  }, [code, year, period, years])

  const applyMeta = useCallback((m: CardMeta) => {
    setLoaded((l) => (l ? { ...l, meta: new Map(l.meta).set(m.card_code, m) } : l))
  }, [])
  const applyPlan = useCallback((p: CardPlan) => {
    setLoaded((l) => {
      if (!l) return l
      // עריכת התכנית אחרי אישור — המסד מחזיר אותה לעבודה (047); כך גם כאן
      const prevPlan = l.plans.get(p.card_code)
      const reviews = new Map(l.planReviews)
      if (reviews.get(p.card_code)?.status === 'approved'
          && (prevPlan?.next_income !== p.next_income || prevPlan?.next_expense !== p.next_expense)) reviews.delete(p.card_code)
      return { ...l, plans: new Map(l.plans).set(p.card_code, p), planReviews: reviews }
    })
  }, [])
  const applyPlanReview = useCallback((r: PlanReview) => {
    setLoaded((l) => (l ? { ...l, planReviews: new Map(l.planReviews).set(r.card_code, r) } : l))
  }, [])

  const role = profile?.budget_role ?? null
  const canManage = isSuperAdmin || role === 'manager'
  const isOwner = !isSuperAdmin && role === 'owner'

  const ctx = useMemo<BudgetContextValue | null>(() => {
    if (!loaded) return null
    const range = periodRange(year, period)
    // תאריך הנתונים: מהשם של דוח ה-EPR (as_of), אחרת מתי נקלט — לא התנועה
    // האחרונה, שעשויה להיות עתידית
    const asOf = loaded.cards.reduce<string | null>((m, c) => {
      const d = c.as_of ?? c.loaded_at
      return !m || d > m ? d : m
    }, null)
    const elapsed = elapsedMonths(asOf, year, period)
    const seasonal = seasonalSuggestions(loaded.monthly, loaded.prevMonthly, asOf, year, period)
    const rows = buildRows(loaded.cards, loaded.meta, loaded.plans, loaded.monthly, elapsed, seasonal, loaded.openOrders)
    return {
      code,
      authorityName: allAuthorities.find((a) => a.code === code)?.name ?? '',
      year,
      period,
      periodFrom: range.from,
      rows,
      monthly: loaded.monthly,
      asOf,
      elapsed,
      canManage,
      canPlan: canManage || isOwner,
      isOwner,
      applyMeta,
      applyPlan,
      seasonal: Boolean(seasonal),
      planReviews: loaded.planReviews,
      applyPlanReview,
      base: `/budget/${code}`,
    }
  }, [loaded, year, period, code, allAuthorities, canManage, isOwner, applyMeta, applyPlan, applyPlanReview])

  if (!codeFromUrl) {
    if (authorities.length) return <Navigate to={`/budget/${authorities[0]}`} replace />
    if (isSuperAdmin && !allAuthorities.length) return <Loading label="טוען…" />
    return <Empty title="אין רשות משויכת">לבקשת גישה — מנהל המערכת ברשות שלך.</Empty>
  }

  const setParam = (k: string, v: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (v == null) next.delete(k)
      else next.set(k, v)
      return next
    }, { replace: true })

  const isUpload = location.pathname.endsWith('/upload')
  const authorityName = allAuthorities.find((a) => a.code === code)?.name
  const identity = [profile?.display_name ?? profile?.email, isSuperAdmin ? 'מנהל־על' : role ? BUDGET_ROLE_LABELS[role] : '']
    .filter(Boolean).join(' · ')

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <Link to="/home" title="לאזור האישי" className="shrink-0 rounded-lg transition hover:opacity-80">
          <Logo className="h-7 w-7" />
        </Link>
        {authorities.length > 1 ? (
          <select value={code} onChange={(e) => navigate(`/budget/${e.target.value}`)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium">
            {authorities.map((a) => {
              const name = allAuthorities.find((x) => x.code === a)?.name
              return <option key={a} value={a}>{name ? `${name} (${a})` : `רשות ${a}`}</option>
            })}
          </select>
        ) : (
          <span className="rounded-lg bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-800">{authorityName || `רשות ${code}`}</span>
        )}
        <ModuleSwitch authorityCode={code} />
        <HomeLink />

        {years && years.length > 0 && (
          <>
            <select value={year} onChange={(e) => setParam('year', e.target.value)} title="שנת התקציב"
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-900">
              {years.map((y) => <option key={y} value={y}>תקציב {y}</option>)}
            </select>
            {/* כמו באקסס: אותו כרטיס בשתי שנים — המועצה קלנדרית, משרד החינוך ספטמבר–אוגוסט */}
            <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5 text-sm" title="תקופת הביצוע">
              {([['calendar', `ינואר–דצמבר ${year}`], ['school', `שנה"ל ${hebrewSchoolYear(year)}`]] as [Period, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setParam('period', k === 'calendar' ? null : k)}
                  className={`rounded-md px-2.5 py-0.5 font-semibold transition ${period === k ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500 hover:text-emerald-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        <span className="mr-auto" />
        <div className="flex items-center gap-1 text-sm">
          <span className="truncate text-slate-500">{identity}</span>
          {isSuperAdmin && (
            <>
              <span className="text-slate-300">|</span>
              <Link to={`/admin/client/${code}?tab=data&product=budget`} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-sky-50 hover:text-sky-700">ניהול</Link>
            </>
          )}
          <span className="text-slate-300">|</span>
          <button onClick={signOut} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-red-50 hover:text-red-600">יציאה</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Rail base={`/budget/${code}`} search={location.search} cards={ctx?.rows.length ?? null}
          canManage={canManage} isOwner={isOwner} />
        <main className="flex min-w-0 flex-1 flex-col overflow-auto">
          {isUpload ? (
            <Outlet />
          ) : error ? (
            <ErrorBox message={error} />
          ) : years && years.length === 0 ? (
            <Empty title="אין עדיין נתוני תקציב לרשות הזו">
              הנתונים נקלטים משני דוחות EPR — ברמת הכרטיס וברמת הפעולה — ומקובצי המיתר.
              {canManage && (
                <Link to={`/budget/${code}/upload`} className="mt-3 block font-semibold text-emerald-700 hover:underline">⬆ קליטת הקבצים הראשונים</Link>
              )}
            </Empty>
          ) : ctx ? (
            <BudgetContext.Provider value={ctx}>
              <Outlet />
            </BudgetContext.Provider>
          ) : (
            <Loading label="טוען את נתוני התקציב…" />
          )}
        </main>
      </div>
    </div>
  )
}

function Rail({ base, search, cards, canManage, isOwner }: {
  base: string
  /** השנה והתקופה עוברות בין המסכים בכתובת */
  search: string
  cards: number | null
  canManage: boolean
  isOwner: boolean
}) {
  const keep = new URLSearchParams(search)
  const q = ['year', 'period'].filter((k) => keep.get(k)).map((k) => `${k}=${keep.get(k)}`).join('&')
  const to = (path: string) => `${base}${path}${q ? `?${q}` : ''}`
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${isActive ? 'bg-emerald-100 font-bold text-emerald-900' : 'text-slate-700 hover:bg-slate-100'}`
  return (
    <aside className="thin-scrollbar w-52 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-3">
      <nav className="flex flex-col gap-0.5">
        {/* אייקונים בקו (brand/Icons) ולא אמוג'י — אחידים בכל מערכת, ובצבע ההקשר */}
        <NavLink end to={to('')} className={link}><IconChartBars className={ICON} /> תמונת תקציב</NavLink>
        <NavLink to={to('/cards')} className={link}>
          <IconTable className={ICON} /> מעקב ותכנון {cards != null && <span className="mr-auto text-xs tabular-nums text-slate-400">{cards}</span>}
        </NavLink>
        {/* 024 — מעקב ותכנון: חריגות, מה השתנה, סימולציית תקציב */}
        <NavLink to={to('/exceptions')} className={link}><IconFlag className={ICON} /> חריגות לטיפול</NavLink>
        <NavLink to={to('/changes')} className={link}><IconHistory className={ICON} /> מה השתנה</NavLink>
        <NavLink to={to('/scenarios')} className={link}><IconSliders className={ICON} /> סימולציית תקציב</NavLink>
        <NavLink to={to('/actions')} className={link}><IconList className={ICON} /> פירוט הפעולות</NavLink>
        {/* המיתר הוא הכנסות ברמת הרשות — לא לאחראי על כרטיסים (ה-RLS חוסם ממילא) */}
        {!isOwner && <NavLink to={to('/meitar')} className={link}><IconLandmark className={ICON} /> מיתר — הכנסות</NavLink>}
        <NavLink to={to('/orders')} className={link}><IconReceipt className={ICON} /> רכש</NavLink>
        {canManage && (
          <>
            <div className="my-2 border-t border-slate-100" />
            <NavLink to={to('/upload')} className={link}><IconUpload className={ICON} /> קליטת קבצים</NavLink>
          </>
        )}
      </nav>
    </aside>
  )
}
