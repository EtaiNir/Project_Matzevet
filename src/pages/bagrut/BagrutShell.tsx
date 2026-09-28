import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import Logo from '@/components/brand/Logo'
import ModuleSwitch from '@/components/ModuleSwitch'
import { fetchAuthorities, ROLE_LABELS, type Authority } from '@/lib/admin'
import {
  buildIndex,
  eligibilityKind,
  fetchRounds,
  isOnTheEdge,
  loadRound,
  SUBJECT_GROUPS,
  type BagrutRound,
  type RoundData,
  type Tracking,
} from '@/lib/bagrut'
import { BagrutContext, type BagrutContextValue } from './context'
import { Empty, ErrorBox, Loading } from '@/components/bagrut/ui'

const ROUND_KEY = 'bagrut:round'

const BAGRUT_ROLE_LABELS: Record<string, string> = {
  council: 'צפייה מועצתית',
  coordinator: 'רכז/ת בגרויות',
  grade_coordinator: 'רכז/ת שכבה',
  track_coordinator: 'רכז/ת מגמה',
  homeroom: 'מחנך/ת',
}

/**
 * המעטפת של מודול הבגרות: כותרת (לוגו · מודול · רשות · סבב · זהות) וסרגל
 * ניווט ימני. טוענת את הסבב פעם אחת ומעבירה אותו לכל המסכים ב-context —
 * המעבר בין לוח הבקרה, הרשימה, המקצוע והכרטיס אינו טוען מחדש.
 */
export default function BagrutShell() {
  const { profile, signOut } = useAuth()
  const { code: codeFromUrl } = useParams()
  const navigate = useNavigate()
  const isSuperAdmin = profile?.role === 'super_admin'

  const [allAuthorities, setAllAuthorities] = useState<Authority[]>([])
  useEffect(() => {
    fetchAuthorities().then(setAllAuthorities).catch(() => setAllAuthorities([]))
  }, [])
  const authorities = useMemo(
    () => (isSuperAdmin ? allAuthorities.map((a) => a.code) : (profile?.authority_codes ?? [])),
    [isSuperAdmin, allAuthorities, profile?.authority_codes],
  )
  const authorityCode = codeFromUrl ?? authorities[0] ?? ''
  useEffect(() => {
    if (!codeFromUrl && authorities[0]) navigate(`/bagrut/${authorities[0]}`, { replace: true })
  }, [codeFromUrl, authorities, navigate])

  // ── סבבים
  const [rounds, setRounds] = useState<BagrutRound[] | null>(null)
  const [roundId, setRoundId] = useState<string>(() => {
    try {
      return sessionStorage.getItem(ROUND_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authorityCode) return
    setRounds(null)
    setError(null)
    fetchRounds(authorityCode)
      .then(setRounds)
      .catch((e: Error) => setError(e.message))
  }, [authorityCode])

  const round = useMemo(() => {
    if (!rounds?.length) return null
    return rounds.find((r) => r.id === roundId) ?? rounds[0]
  }, [rounds, roundId])

  // ── נתוני הסבב
  const [data, setData] = useState<RoundData | null>(null)
  useEffect(() => {
    if (!round) return
    let alive = true
    setData(null)
    loadRound(round)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
    try {
      sessionStorage.setItem(ROUND_KEY, round.id)
    } catch {
      /* מצב פרטי — לא נורא */
    }
    return () => {
      alive = false
    }
  }, [round])

  const index = useMemo(() => (data ? buildIndex(data) : null), [data])

  const applyTracking = useCallback((t: Tracking) => {
    setData((d) => {
      if (!d) return d
      const tracking = new Map(d.tracking)
      tracking.set(t.student_id, t)
      return { ...d, tracking }
    })
  }, [])

  const ctx: BagrutContextValue | null =
    round && data && index
      ? {
          authorityCode,
          round,
          data,
          index,
          canEditTracking: isSuperAdmin || (Boolean(profile?.bagrut_role) && profile?.bagrut_role !== 'council'),
          applyTracking,
          base: `/bagrut/${authorityCode}`,
        }
      : null

  const authorityName = allAuthorities.find((a) => a.code === authorityCode)?.name ?? ''
  const identity = [
    profile?.display_name ?? profile?.email,
    profile?.bagrut_role ? BAGRUT_ROLE_LABELS[profile.bagrut_role] : profile?.role ? ROLE_LABELS[profile.role] : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* ── כותרת ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <Logo className="h-7 w-7 shrink-0" />
        {authorities.length > 1 ? (
          <select
            value={authorityCode}
            onChange={(e) => navigate(`/bagrut/${e.target.value}`)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium"
          >
            {authorities.map((a) => {
              const name = allAuthorities.find((x) => x.code === a)?.name
              return (
                <option key={a} value={a}>
                  {name ? `${name} (${a})` : `רשות ${a}`}
                </option>
              )
            })}
          </select>
        ) : (
          <span className="rounded-lg bg-sky-50 px-3 py-1 text-sm font-bold text-sky-800">
            {authorityName || `רשות ${authorityCode}`}
          </span>
        )}
        <ModuleSwitch authorityCode={authorityCode} />

        {rounds && rounds.length > 0 && round && (
          <select
            value={round.id}
            onChange={(e) => setRoundId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
            title="סבב: בית ספר · מועד · שנה"
          >
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.school_name ?? r.school_code} · {r.season} {r.school_year}
              </option>
            ))}
          </select>
        )}

        <span className="mr-auto" />
        <div className="flex items-center gap-1 text-sm">
          <span className="truncate text-slate-500">{identity}</span>
          {isSuperAdmin && (
            <>
              <span className="text-slate-300">|</span>
              <Link to={`/admin/client/${authorityCode}`} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-sky-50 hover:text-sky-700">
                ניהול
              </Link>
            </>
          )}
          <span className="text-slate-300">|</span>
          <button onClick={signOut} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-red-50 hover:text-red-600">
            יציאה
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {ctx && <Rail ctx={ctx} />}
        <main className="thin-scrollbar flex min-w-0 flex-1 flex-col overflow-auto">
          {error ? (
            <ErrorBox message={error} />
          ) : rounds && rounds.length === 0 ? (
            <Empty title="אין עדיין נתוני בגרות לרשות הזו">
              סבב נטען לכל בית ספר אחרי כל מועד (קיץ / חורף): T1, T2 והמצפן של בית הספר.
            </Empty>
          ) : ctx ? (
            <BagrutContext.Provider value={ctx}>
              <Outlet />
            </BagrutContext.Provider>
          ) : (
            <Loading />
          )}
        </main>
      </div>
    </div>
  )
}

/** סרגל ימני: המסכים, התצורות המוכנות עם ספירות, והמקצועות לפי קבוצה. */
function Rail({ ctx }: { ctx: BagrutContextValue }) {
  const { data, index, base } = ctx
  const location = useLocation()
  const counts = useMemo(() => {
    const t2 = data.students.filter((s) => s.in_t2)
    return {
      all: data.students.length,
      graduating: t2.length,
      notEligible: t2.filter((s) => eligibilityKind(s) === 'not_eligible').length,
      edge: t2.filter(isOnTheEdge).length,
      fighting: data.students.filter((s) => data.tracking.get(s.student_id)?.fighting).length,
      // שכבות שאינן מסיימות — בלי T2, עם התקדמות T1 בלבד
      otherGrades: [...data.students.reduce((m, s) => {
        if (s.grade && s.grade !== ctx.round.graduating_grade) m.set(s.grade, (m.get(s.grade) ?? 0) + 1)
        return m
      }, new Map<string, number>())].sort((a, b) => b[0].localeCompare(a[0], 'he')),
    }
  }, [data, ctx.round.graduating_grade])

  const takers = useMemo(() => {
    const m = new Map<string, number>()
    for (const [, bySub] of index.gradesByStudent) for (const k of bySub.keys()) m.set(k, (m.get(k) ?? 0) + 1)
    return m
  }, [index])

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
      isActive ? 'bg-sky-100 font-bold text-sky-900' : 'text-slate-700 hover:bg-slate-100'
    }`
  const count = (n: number) => <span className="mr-auto text-xs tabular-nums text-slate-400">{n}</span>

  return (
    <aside className="thin-scrollbar flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-white p-3">
      <div>
        <NavLink end to={base} className={link}>
          <span aria-hidden>◔</span> תמונת מצב
        </NavLink>
        <NavLink to={`${base}/program`} className={link}>
          <span aria-hidden>▤</span> תוכנית בית הספר
        </NavLink>
      </div>

      <div>
        <div className="px-3 pb-1 text-xs font-bold text-slate-400">תלמידים</div>
        {[
          ['', 'כל התלמידים', counts.all],
          ['?view=graduating', `שכבה ${ctx.round.graduating_grade ?? ''} (מסיימת)`, counts.graduating],
          ...counts.otherGrades.map(([g, n]) => [`?grade=${encodeURIComponent(g)}`, `שכבה ${g}`, n]),
          ['?view=edge', '⚡ על הסף', counts.edge],
          ['?kind=not_eligible', 'אין זכאות', counts.notEligible],
          ['?flag=fighting', '🚩 נלחמים על הזכאות', counts.fighting],
        ].map(([q, label, n]) => {
          const active = location.pathname === `${base}/students` && location.search === q
          return (
            <Link key={q as string} to={`${base}/students${q}`} className={link({ isActive: active })}>
              {label} {count(n as number)}
            </Link>
          )
        })}
      </div>

      {SUBJECT_GROUPS.map((g) => {
        const subs = data.subjects.filter((s) => s.subject_group === g && takers.get(s.subject_key))
        if (!subs.length) return null
        return (
          <div key={g}>
            <div className="px-3 pb-1 text-xs font-bold text-slate-400">{g === 'חובה' ? 'מקצועות המלל' : g}</div>
            {subs.map((s) => (
              <NavLink key={s.subject_key} to={`${base}/subject/${s.subject_key}`} className={link}>
                <span className="truncate">{s.subject_name}</span>
                {count(takers.get(s.subject_key) ?? 0)}
              </NavLink>
            ))}
          </div>
        )
      })}
    </aside>
  )
}
