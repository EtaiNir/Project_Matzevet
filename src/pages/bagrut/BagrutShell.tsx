import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import Logo from '@/components/brand/Logo'
import HomeLink from '@/components/HomeLink'
import LastStudentLink from '@/components/bagrut/LastStudentLink'
import FollowupAlert from '@/components/bagrut/FollowupAlert'
import ModuleSwitch from '@/components/ModuleSwitch'
import { bagrutGeneralScope, bagrutHasSubjects, bagrutTitle, canSeeBagrutProgram, fetchAuthorities, ROLE_LABELS, type Authority } from '@/lib/admin'
import {
  buildIndex,
  canEditBagrutGrades,
  clearRoundCache,
  recomputeRound,
  roundComputed,
  type BagrutFlag,
  type StudentRows,
  editKey,
  type EditRef,
  type ManualEdit,
  classSortKey,
  eligibilityKind,
  fetchRounds,
  fetchSchoolNames,
  isOnTheEdge,
  loadRound,
  schoolsOf,
  SUBJECT_GROUPS,
  type ActionCounts,
  type BagrutRound,
  type BagrutSchool,
  type BagrutStudent,
  type RoundData,
  type RoundIndex,
  type Tracking,
} from '@/lib/bagrut'
import { BagrutContext, type BagrutContextValue } from './context'
import { isFollowupDue } from '@/lib/bagrutCycle'
import { Empty, ErrorBox, Loading } from '@/components/bagrut/ui'

const ROUND_KEY = 'bagrut:round'
const LENS_KEY = 'bagrut:lens'

/** תצוגה של הדפים הכלליים — קבוצת תלמידים אחת מתוך מה שמותר למשתמש */
interface Lens {
  id: 'scope' | 'subjects'
  label: string
  ids: Set<string>
}

/** שם המקצוע בלי מספר היחידות — "אנגלית 4 יח"ל" ← "אנגלית" */
const subjectFamily = (name: string) => name.replace(/\s*\d+\s*(יח"ל|יח״ל)?\s*$/, '').trim()

/**
 * התצוגות של משתמש בית־ספרי (037): "הכיתה שלי" (כיתות ושכבות שסומנו) ו"המקצועות
 * שלי" (מי שיש לו ציון באחד המקצועות — כמו דף המקצוע). תצוגה אחת — אין מתג;
 * רכז בגרויות, מועצה ומנהל־על — בלי צמצום (מערך ריק).
 */
function buildLenses(profile: Parameters<typeof bagrutGeneralScope>[0], data: RoundData | null): Lens[] {
  if (!data) return []
  const out: Lens[] = []
  const scope = bagrutGeneralScope(profile)
  if (scope) {
    const ids = new Set(
      data.students
        .filter((s) => (s.grade && scope.grades.includes(s.grade)) || (s.class_name && scope.classes.includes(s.class_name)))
        .map((s) => s.student_id),
    )
    const parts = [
      scope.classes.length ? `${scope.classes.length > 1 ? 'הכיתות שלי' : 'הכיתה שלי'}: ${scope.classes.join(', ')}` : null,
      scope.grades.length ? `שכבה ${scope.grades.join(', ')}` : null,
    ].filter(Boolean)
    out.push({ id: 'scope', label: parts.join(' · '), ids })
  }
  if (bagrutHasSubjects(profile)) {
    const keys = new Set(profile?.bagrut_subject_keys ?? [])
    const ids = new Set(data.grades.filter((g) => keys.has(g.subject_key)).map((g) => g.student_id))
    const names = [...new Set(data.subjects.filter((s) => keys.has(s.subject_key)).map((s) => subjectFamily(s.subject_name)))]
    out.push({ id: 'subjects', label: `המקצועות שלי: ${names.join(', ')}`, ids })
  }
  return out
}
const ZOOM_KEY = 'bagrut:zoom'
const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6]

/** גודל התצוגה — נשמר לכל צופה בדפדפן שלו, כמו הסבב שנבחר */
function useZoom(): [number, (z: number) => void] {
  const [zoom, setZoomState] = useState<number>(() => {
    try {
      const z = Number(localStorage.getItem(ZOOM_KEY))
      return ZOOM_STEPS.includes(z) ? z : 1
    } catch {
      return 1
    }
  })
  const setZoom = useCallback((z: number) => {
    setZoomState(z)
    try {
      localStorage.setItem(ZOOM_KEY, String(z))
    } catch {
      /* מצב פרטי — הגודל פשוט לא יישמר */
    }
  }, [])
  return [zoom, setZoom]
}

/** כפתורי הגדלה והקטנה — בפינה הימנית העליונה של הדף, מחוץ לאזור המוגדל */
function ZoomBar({ zoom, onChange }: { zoom: number; onChange: (z: number) => void }) {
  const i = ZOOM_STEPS.indexOf(zoom)
  const btn = 'flex h-7 w-7 items-center justify-center rounded-md text-base font-bold text-slate-600 transition hover:bg-sky-50 hover:text-sky-700 disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className="flex shrink-0 items-center px-4 pt-2">
      <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
        <button className={btn} onClick={() => onChange(ZOOM_STEPS[i + 1])} disabled={i >= ZOOM_STEPS.length - 1} title="הגדלה" aria-label="הגדלה">
          +
        </button>
        <button
          onClick={() => onChange(1)}
          className="min-w-[3.25rem] rounded-md px-1 py-0.5 text-xs font-semibold tabular-nums text-slate-600 hover:bg-sky-50 hover:text-sky-700"
          title="חזרה לגודל רגיל"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className={btn} onClick={() => onChange(ZOOM_STEPS[i - 1])} disabled={i <= 0} title="הקטנה" aria-label="הקטנה">
          −
        </button>
      </div>
    </div>
  )
}

/**
 * המעטפת של מודול הבגרות: כותרת (לוגו · מודול · רשות · סבב · זהות) וסרגל
 * ניווט ימני. טוענת את הסבב פעם אחת ומעבירה אותו לכל המסכים ב-context —
 * המעבר בין לוח הבקרה, הרשימה, המקצוע והכרטיס אינו טוען מחדש.
 */
export default function BagrutShell() {
  const { profile, signOut } = useAuth()
  const { code: codeFromUrl, school: schoolFromUrl } = useParams()
  const navigate = useNavigate()
  const isSuperAdmin = profile?.role === 'super_admin'
  // מסך הקליטה עומד בפני עצמו, בלי לחכות לטעינת הסבב
  const isUpload = Boolean(useMatch('/bagrut/:code/:school/upload'))
  const isHome = Boolean(useMatch('/bagrut/:code/:school'))
  // הגדלה והקטנה — בכל דף חוץ מתמונת המצב, קליטת הסבב ובחירת בית הספר
  const zoomable = Boolean(schoolFromUrl) && !isUpload && !isHome
  const [zoom, setZoom] = useZoom()

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
  const [schoolNames, setSchoolNames] = useState<Map<string, string>>(new Map())
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
    // שמות בתי הספר מהרשימה (033) — כשל בה לא חוסם; נופלים לשם שבקבצים
    Promise.all([fetchRounds(authorityCode), fetchSchoolNames(authorityCode).catch(() => new Map<string, string>())])
      .then(([rs, names]) => {
        setSchoolNames(names)
        setRounds(rs)
      })
      .catch((e: Error) => setError(e.message))
  }, [authorityCode])

  // ── בתי הספר (החלטה 016): כל בית ספר נצפה בנפרד. מי שרואה בית ספר אחד בלבד
  // (מחנכת, רכז מקצוע, רכז בגרויות) נכנס אליו ישר; רשות עם כמה — בוחרים.
  // מנהל־על מקבל תמיד את מסך הבחירה, גם כשיש בית ספר אחד (אייל, 11.10).
  const schools = useMemo(() => schoolsOf(rounds ?? [], schoolNames), [rounds, schoolNames])
  const school = schools.find((s) => s.code === schoolFromUrl) ?? null
  useEffect(() => {
    if (!rounds || !authorityCode) return
    if (!schoolFromUrl && schools.length === 1 && !isSuperAdmin) navigate(`/bagrut/${authorityCode}/${schools[0].code}`, { replace: true })
    // בית ספר שלא קיים או לא גלוי למשתמש (וגם כתובות ישנות בלי בית ספר)
    if (schoolFromUrl && !school) navigate(`/bagrut/${authorityCode}`, { replace: true })
  }, [rounds, schools, school, schoolFromUrl, authorityCode, isSuperAdmin, navigate])

  const round = useMemo(() => {
    if (!school) return null
    return school.rounds.find((r) => r.id === roundId) ?? school.rounds[0]
  }, [school, roundId])

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

  // ── הדפים הכלליים מול דפי המקצוע (אייל, 18.10). מחנך שהוא גם רכז מקצוע מקבל
  // מה-RLS את תלמידי הכיתה **ואת** תלמידי המקצוע (037) — אחרת דף המקצוע ריק.
  // הדפים הכלליים (תמונת המצב, הרשימות, הסרגל) מציגים **תצוגה אחת** בכל פעם:
  // "הכיתה שלי" או "המקצועות שלי", ומתג ביניהן. דף המקצוע וכרטיס התלמיד מקבלים
  // הכול; זה לא הרחבת הרשאה — ה-RLS כבר החליט מה מותר.
  const lenses = useMemo(() => buildLenses(profile, data), [profile, data])
  const [lensId, setLensId] = useState<string>(() => {
    try {
      return sessionStorage.getItem(LENS_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const lens = lenses.find((l) => l.id === lensId) ?? lenses[0] ?? null
  const chooseLens = (id: string) => {
    setLensId(id)
    try {
      sessionStorage.setItem(LENS_KEY, id)
    } catch {
      /* מצב פרטי */
    }
  }
  const general = useMemo(() => {
    if (!data || !lens) return data
    const ids = lens.ids
    return {
      ...data,
      students: data.students.filter((s) => ids.has(s.student_id)),
      grades: data.grades.filter((g) => ids.has(g.student_id)),
      subjectRows: data.subjectRows.filter((r) => ids.has(r.student_id)),
    }
  }, [data, lens])
  const generalIndex = useMemo(() => (general && general !== data ? buildIndex(general) : index), [general, data, index])
  const onSubjectPage = Boolean(useMatch('/bagrut/:code/:school/subject/:key'))
  const onStudentCard = Boolean(useMatch('/bagrut/:code/:school/student/:id'))
  const fullView = onSubjectPage || onStudentCard

  const applyTracking = useCallback((t: Tracking) => {
    setData((d) => {
      if (!d) return d
      const tracking = new Map(d.tracking)
      tracking.set(t.student_id, t)
      return { ...d, tracking }
    })
  }, [])

  const applyActionCounts = useCallback((studentId: string, counts: ActionCounts) => {
    setData((d) => {
      if (!d) return d
      const actionCounts = new Map(d.actionCounts)
      actionCounts.set(studentId, counts)
      return { ...d, actionCounts }
    })
  }, [])

  const applyDataEdit = useCallback((ref: EditRef, value: string | null, edit: ManualEdit | null) => {
    // המטמון של הסבב מחזיק את הנתונים מלפני העריכה — שכניסה הבאה למודול תטען מחדש
    if (round) clearRoundCache(round.id)
    const num = (v: string | null) => (v == null ? null : Number(v))
    setData((d) => {
      if (!d) return d
      const next = { ...d }
      if (ref.target === 'student') {
        const numeric = ref.field === 'negatives_count' || ref.field === 'core_units'
        next.students = d.students.map((s) => (s.student_id === ref.studentId ? { ...s, [ref.field]: numeric ? num(value) : value } : s))
      } else if (ref.target === 'subject') {
        const numeric = ref.field !== 'completion_status'
        next.subjectRows = d.subjectRows.map((r) =>
          r.student_id === ref.studentId && r.subject_key === ref.subjectKey ? { ...r, [ref.field]: numeric ? num(value) : value } : r)
      } else {
        next.grades = d.grades.map((g) =>
          g.student_id === ref.studentId && g.subject_key === ref.subjectKey && g.questionnaire_code === ref.questionnaireCode
            ? { ...g, [ref.field]: num(value) } : g)
      }
      if (edit) {
        const edits = new Map(d.edits)
        const prev = edits.get(editKey(ref))
        edits.set(editKey(ref), prev ? { ...edit, old_value: prev.old_value } : edit)
        next.edits = edits
      }
      return next
    })
  }, [round])

  const applyStudentRows = useCallback((rows: StudentRows) => {
    if (round) clearRoundCache(round.id)
    const sid = rows.student.student_id
    setData((d) => {
      if (!d) return d
      return {
        ...d,
        students: d.students.map((s) => (s.student_id === sid ? rows.student : s)),
        subjectRows: [...d.subjectRows.filter((r) => r.student_id !== sid), ...rows.subjectRows],
        grades: [...d.grades.filter((g) => g.student_id !== sid), ...rows.grades],
        flags: [...d.flags.filter((f) => f.student_id !== sid), ...rows.flags],
      }
    })
  }, [round])

  const applyFlag = useCallback((flag: BagrutFlag) => {
    if (round) clearRoundCache(round.id)
    setData((d) => (d ? { ...d, flags: d.flags.map((f) => (f.id === flag.id ? { ...f, ...flag } : f)) } : d))
  }, [round])

  // סבב שנקלט לפני מנוע הזכאות — מנהל־על מריץ את החישוב בלחיצה
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeError, setRecomputeError] = useState<string | null>(null)
  const runRecompute = async () => {
    if (!round) return
    setRecomputing(true)
    setRecomputeError(null)
    try {
      await recomputeRound(round.id)
      clearRoundCache(round.id)
      setData(await loadRound(round))
    } catch (e) {
      setRecomputeError((e as Error).message)
    } finally {
      setRecomputing(false)
    }
  }
  const notComputed = Boolean(data && !roundComputed(data))

  const ctx: BagrutContextValue | null =
    round && data && index && general && generalIndex
      ? {
          authorityCode,
          round,
          data: fullView ? data : general,
          index: fullView ? index : generalIndex,
          canEditTracking: isSuperAdmin || (Boolean(profile?.bagrut_role) && profile?.bagrut_role !== 'council'),
          applyTracking,
          applyActionCounts,
          applyDataEdit,
          applyStudentRows,
          applyFlag,
          canEditGrades: canEditBagrutGrades(profile),
          base: `/bagrut/${authorityCode}/${round.school_code}`,
        }
      : null

  const authorityName = allAuthorities.find((a) => a.code === authorityCode)?.name ?? ''
  const identity = [
    profile?.display_name ?? profile?.email,
    profile?.bagrut_role ? bagrutTitle(profile) : profile?.role ? ROLE_LABELS[profile.role] : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* ── כותרת ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        {/* הלוגו מוביל לאזור האישי — משם עוברים בין המוצרים */}
        <Link to="/home" title="לאזור האישי" className="shrink-0 rounded-lg transition hover:opacity-80">
          <Logo className="h-7 w-7" />
        </Link>
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
        <HomeLink />
        <LastStudentLink />

        {/* בית הספר — בחירה רק כשיש יותר מאחד */}
        {school && (schools.length > 1 ? (
          <select
            value={school.code}
            onChange={(e) => navigate(`/bagrut/${authorityCode}/${e.target.value}`)}
            className="rounded-lg border border-violet-300 bg-violet-50 px-2 py-1 text-sm font-semibold text-violet-900"
            title="בית הספר"
          >
            {schools.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        ) : isSuperAdmin ? (
          // בית ספר יחיד — למנהל־על הכפתור מחזיר למסך הבחירה
          <Link to={`/bagrut/${authorityCode}`} title="לבחירת בית ספר"
            className="rounded-lg bg-violet-50 px-3 py-1 text-sm font-bold text-violet-900 transition hover:bg-violet-100">
            {school.name}
          </Link>
        ) : (
          <span className="rounded-lg bg-violet-50 px-3 py-1 text-sm font-bold text-violet-900">{school.name}</span>
        ))}

        {school && round && (school.rounds.length > 1 ? (
          <select
            value={round.id}
            onChange={(e) => setRoundId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
            title="סבב: מועד · שנה"
          >
            {school.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.season} {r.school_year}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-slate-500">{round.season} {round.school_year}</span>
        ))}

        <span className="mr-auto" />
        <div className="flex items-center gap-1 text-sm">
          <span className="truncate text-slate-500">{identity}</span>
          {isSuperAdmin && (
            <>
              <span className="text-slate-300">|</span>
              <Link to={`/admin/client/${authorityCode}?tab=data&product=bagrut${school ? `&school=${school.code}` : ''}`} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-sky-50 hover:text-sky-700">
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
        {/* הסרגל סופר תמיד את הדפים הכלליים, ואת "המקצועות שלי" — לפי כל מה שמותר */}
        {ctx && general && generalIndex && index && (
          <Rail ctx={{ ...ctx, data: general, index: generalIndex }} fullIndex={index} allStudents={data?.students ?? []}
            lensId={lens?.id ?? null} onClassLens={() => chooseLens('scope')} isSuperAdmin={isSuperAdmin} />
        )}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* מתג התצוגה — רק כשיש יותר מאחת, ורק בדפים הכלליים */}
          {ctx && lens && lenses.length > 1 && !fullView && !isUpload && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
              <span className="text-sm font-semibold text-slate-500">תצוגה:</span>
              <div className="flex gap-0.5 rounded-xl bg-slate-100 p-1">
                {lenses.map((l) => (
                  <button key={l.id} onClick={() => chooseLens(l.id)}
                    className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${l.id === lens.id ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-500 hover:text-violet-700'}`}>
                    {l.label} <span className="text-xs font-normal opacity-70">({l.ids.size})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {ctx && !isUpload && notComputed && (
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              <span>
                <b>פרטי הזכאות בסבב הזה עוד לא חושבו במנוע.</b> מוצג ניתוח הזכאות כפי שהגיע בקבצים — עדכון ציון לא ישנה אותו.
              </span>
              {isSuperAdmin ? (
                <button onClick={runRecompute} disabled={recomputing}
                  className="rounded-md bg-amber-600 px-3 py-1 font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                  {recomputing ? 'מחשב…' : 'חישוב עכשיו'}
                </button>
              ) : (
                <span className="text-amber-700">מנהל־על יכול להריץ את החישוב.</span>
              )}
              {recomputeError && <span className="text-rose-700">{recomputeError}</span>}
            </div>
          )}
          {ctx && !isUpload && <FollowupAlert ctx={ctx} />}
          {zoomable && <ZoomBar zoom={zoom} onChange={setZoom} />}
          {/* גלילת הדף — ב-RTL הסרגל יושב בצד השמאלי של המסך */}
          <div className="min-h-0 flex-1 overflow-auto">
            {/* zoom ולא transform: הדף מתארגן מחדש בכל גודל (רוחב וגובה באחוזים
                נשארים יחסיים למסך), והטבלאות הווירטואליות מודדות נכון — נבדק
                בכרום: scrollTop ו-ResizeObserver ביחידות של האלמנט עצמו. */}
            <div className="flex h-full flex-col" style={zoomable && zoom !== 1 ? { zoom } : undefined}>
              {isUpload ? (
                <Outlet />
              ) : error ? (
                <ErrorBox message={error} />
              ) : rounds && rounds.length === 0 ? (
                <Empty title="אין עדיין נתוני בגרות לרשות הזו">
                  סבב נטען לכל בית ספר אחרי כל מועד (קיץ / חורף): הציונים, ניתוח הזכאות והמצפן של בית הספר.
                  {isSuperAdmin && (
                    <Link to={`/admin/client/${authorityCode}?tab=data&product=bagrut`} className="mt-3 block font-semibold text-sky-700 hover:underline">
                      ⬆ קליטת הסבב הראשון
                    </Link>
                  )}
                </Empty>
              ) : rounds && !schoolFromUrl && (schools.length > 1 || isSuperAdmin) ? (
                <SchoolPicker authorityCode={authorityCode} authorityName={authorityName} schools={schools} isSuperAdmin={isSuperAdmin} />
              ) : ctx ? (
                <BagrutContext.Provider value={ctx}>
                  <Outlet />
                </BagrutContext.Provider>
              ) : (
                <Loading />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/**
 * בחירת בית ספר — לרשות עם כמה בתי ספר, ולמנהל־על תמיד. כל כרטיס פותח את
 * בית הספר בנפרד; מנהל־על מקבל גם כרטיס לקליטת בית ספר חדש.
 */
function SchoolPicker({ authorityCode, authorityName, schools, isSuperAdmin }: {
  authorityCode: string
  authorityName: string
  schools: BagrutSchool[]
  isSuperAdmin: boolean
}) {
  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <h1 className="text-2xl font-extrabold text-slate-800">בחירת בית ספר</h1>
      <p className="mt-1 text-sm text-slate-500">
        {authorityName ? `${authorityName} — ` : ''}{schools.length === 1 ? 'בית ספר אחד' : `${schools.length} בתי ספר`}.
        {' '}הנתונים של כל בית ספר נקלטים ונצפים בנפרד.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {schools.map((s) => {
          const last = s.rounds[0]
          return (
            <Link
              key={s.code}
              to={`/bagrut/${authorityCode}/${s.code}`}
              className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-lg"
            >
              <div className="h-1.5 bg-gradient-to-l from-violet-400 to-indigo-600" />
              <div className="flex flex-1 flex-col p-5">
                <div className="text-lg font-bold text-slate-800 group-hover:text-violet-800">{s.name}</div>
                <div className="font-mono text-xs text-slate-400" dir="ltr">{s.code}</div>
                <dl className="mt-4 flex gap-4 text-sm">
                  <div>
                    <dd className="font-bold tabular-nums text-slate-700">{last.stats?.students?.toLocaleString('he-IL') ?? '—'}</dd>
                    <dt className="text-xs text-slate-500">תלמידים</dt>
                  </div>
                  <div>
                    <dd className="font-bold text-slate-700">{last.season} {last.school_year}</dd>
                    <dt className="text-xs text-slate-500">{s.rounds.length > 1 ? `הסבב האחרון מתוך ${s.rounds.length}` : 'סבב'}</dt>
                  </div>
                </dl>
                <span className="mt-4 text-sm font-bold text-violet-700 transition group-hover:-translate-x-1">כניסה ←</span>
              </div>
            </Link>
          )
        })}
        {isSuperAdmin && (
          <Link
            to={`/admin/client/${authorityCode}?tab=data&product=bagrut`}
            className="flex min-h-[10rem] items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 text-sm font-semibold text-sky-700 transition hover:border-sky-400 hover:bg-sky-50"
          >
            + בית ספר חדש
          </Link>
        )}
      </div>
    </div>
  )
}

/** סרגל ימני: המסכים, התצורות המוכנות עם ספירות, והמקצועות לפי קבוצה. */
function Rail({ ctx, fullIndex, allStudents, lensId, onClassLens, isSuperAdmin }: {
  ctx: BagrutContextValue
  fullIndex: RoundIndex
  /** כל התלמידים שמותר לראות — לספירת "הכיתה שלי" בלי קשר לתצוגה */
  allStudents: BagrutStudent[]
  lensId: string | null
  /** לחיצה על "הכיתה שלי" עוברת לתצוגת הכיתה */
  onClassLens: () => void
  isSuperAdmin: boolean
}) {
  const { data, base } = ctx
  const openFlags = data.flags.filter((f) => f.status === 'open').length
  const location = useLocation()
  const counts = useMemo(() => {
    const t2 = data.students.filter((s) => s.in_t2)
    // כיתות של קבוצת תלמידים, עם מספר התלמידים בכל אחת — במיון טבעי (יב-2 לפני יב-10)
    const classesOf = (students: typeof data.students): [string, number][] =>
      [...students.reduce((m, s) => (s.class_name ? m.set(s.class_name, (m.get(s.class_name) ?? 0) + 1) : m), new Map<string, number>())]
        .sort((a, b) => classSortKey(a[0]).localeCompare(classSortKey(b[0])))
    return {
      all: data.students.length,
      graduating: t2.length,
      graduatingClasses: classesOf(t2),
      classesByGrade: (g: string) => classesOf(data.students.filter((s) => s.grade === g)),
      notEligible: t2.filter((s) => eligibilityKind(s) === 'not_eligible').length,
      edge: t2.filter(isOnTheEdge).length,
      fighting: data.students.filter((s) => data.tracking.get(s.student_id)?.fighting).length,
      followup: data.students.filter((s) => isFollowupDue(data.tracking.get(s.student_id)?.next_followup)).length,
      // שכבות שאינן מסיימות — בלי T2, עם התקדמות T1 בלבד
      otherGrades: [...data.students.reduce((m, s) => {
        if (s.grade && s.grade !== ctx.round.graduating_grade) m.set(s.grade, (m.get(s.grade) ?? 0) + 1)
        return m
      }, new Map<string, number>())].sort((a, b) => b[0].localeCompare(a[0], 'he')),
    }
  }, [data, ctx.round.graduating_grade])

  // כמה ניגשו לכל מקצוע — מתוך כל מה שמותר (כמו דף המקצוע עצמו), לא רק הכיתה
  const takers = useMemo(() => {
    const m = new Map<string, number>()
    for (const [, bySub] of fullIndex.gradesByStudent) for (const k of bySub.keys()) m.set(k, (m.get(k) ?? 0) + 1)
    return m
  }, [fullIndex])

  const { profile } = useAuth()
  // סומנו לו מקצועות (גם יחד עם כיתה) — בסרגל רק "המקצועות שלי" (18.10)
  const isSubjectCoordinator = bagrutHasSubjects(profile)
  const mySubjects = useMemo(() => {
    // גם מחנך שהוא רכז מקצוע מקבל את "המקצועות שלי" בראש הסרגל
    const keys = profile?.bagrut_subject_keys ?? []
    return data.subjects.filter((s) => keys.includes(s.subject_key))
  }, [profile, data.subjects])

  // הכיתות שסומנו לו — עם מספר התלמידים מכל מה שמותר (לא רק התצוגה הנוכחית),
  // וקישור לרשימה באותו פורמט כמו הכיתות שמתחת לשכבה
  const myClasses = useMemo(() => {
    const scope = bagrutGeneralScope(profile)
    if (!scope?.classes.length) return []
    return scope.classes.map((name) => {
      const inClass = allStudents.filter((s) => s.class_name === name)
      const grade = inClass[0]?.grade ?? ''
      const q = grade && grade === ctx.round.graduating_grade
        ? `?view=graduating&class=${encodeURIComponent(name)}`
        : `?grade=${encodeURIComponent(grade)}&class=${encodeURIComponent(name)}`
      return { name, n: inClass.length, q }
    })
  }, [profile, allStudents, ctx.round.graduating_grade])

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
      isActive ? 'bg-sky-100 font-bold text-sky-900' : 'text-slate-700 hover:bg-slate-100'
    }`
  const count = (n: number) => <span className="mr-auto text-xs tabular-nums text-slate-400">{n}</span>

  // קישור פעיל לפי הפרמטרים עצמם ולא לפי סדרם — תמונת המצב והרשימה בונות את אותה כתובת בסדר שונה
  const norm = (q: string) => [...new URLSearchParams(q)].map(([k, v]) => `${k}=${v}`).sort().join('&')
  const here = location.pathname === `${base}/students` ? norm(location.search) : null
  const isHere = (q: string) => here === norm(q)

  // שכבה נפתחת לכיתות שלה בלחיצה על החץ, ונשארת פתוחה כשעומדים על אחת מהן
  const [openGrades, setOpenGrades] = useState<Set<string>>(new Set())
  const toggleGrade = (key: string) =>
    setOpenGrades((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  interface StudentLink {
    q: string
    label: string
    n: number
    classes?: { q: string; label: string; n: number }[]
  }
  const gradQ = '?view=graduating'
  const studentLinks: StudentLink[] = [
    { q: '', label: 'כל התלמידים', n: counts.all },
    {
      q: gradQ,
      label: `שכבה ${ctx.round.graduating_grade ?? ''} (מסיימת)`,
      n: counts.graduating,
      classes: counts.graduatingClasses.map(([c, n]) => ({ q: `${gradQ}&class=${encodeURIComponent(c)}`, label: c, n })),
    },
    ...counts.otherGrades.map(([g, n]): StudentLink => {
      const q = `?grade=${encodeURIComponent(g)}`
      return { q, label: `שכבה ${g}`, n, classes: counts.classesByGrade(g).map(([c, cn]) => ({ q: `${q}&class=${encodeURIComponent(c)}`, label: c, n: cn })) }
    }),
    { q: '?view=edge', label: 'על הסף', n: counts.edge },
    { q: '?kind=not_eligible', label: 'אין זכאות', n: counts.notEligible },
    { q: '?flag=fighting', label: 'נלחמים על הזכאות', n: counts.fighting },
    { q: '?view=followup', label: 'מעקב השבוע', n: counts.followup },
  ]

  return (
    <aside className="thin-scrollbar flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-white p-3">
      <div>
        <NavLink end to={base} className={link}>
          <span aria-hidden>◔</span> תמונת מצב
        </NavLink>
        {/* מחושב אצלנו מעל הזכאות (decisions/019) — לשכבה המסיימת */}
        {counts.graduating > 0 && (
          <NavLink to={`${base}/honors`} className={link}>
            <span aria-hidden>★</span> מצטיינת וטק
          </NavLink>
        )}
        {/* תוכנית בית הספר — רק לרכז בגרויות ולמנהל־על (אייל, 18.10) */}
        {canSeeBagrutProgram(profile) && (
          <NavLink to={`${base}/program`} className={link}>
            <span aria-hidden>▤</span> תוכנית בית הספר
          </NavLink>
        )}
        {/* איפה המנוע אינו מסכים עם הקבצים (041) — למי שמעדכן ציונים */}
        {ctx.canEditGrades && (
          <NavLink to={`${base}/flags`} className={link}>
            <span aria-hidden className="text-rose-600">⚑</span> דגלים אדומים
            {openFlags > 0 && <span className="mr-auto rounded-full bg-rose-100 px-1.5 text-xs font-bold tabular-nums text-rose-700">{openFlags}</span>}
          </NavLink>
        )}
        {isSuperAdmin && (
          <NavLink to={`${base}/upload`} className={link}>
            <span aria-hidden>⬆</span> קליטת סבב
          </NavLink>
        )}
      </div>

      <div>
        <div className="px-3 pb-1 text-xs font-bold text-slate-400">תלמידים</div>
        {studentLinks.map(({ q, label, n, classes }) => {
          if (!classes?.length) {
            return (
              <Link key={q} to={`${base}/students${q}`} className={link({ isActive: isHere(q) })}>
                {label} {count(n)}
              </Link>
            )
          }
          const open = openGrades.has(q) || classes.some((c) => isHere(c.q))
          return (
            <div key={q}>
              <div className="flex items-center">
                <Link to={`${base}/students${q}`} className={`${link({ isActive: isHere(q) })} min-w-0 flex-1`}>
                  {label} {count(n)}
                </Link>
                <button
                  onClick={() => toggleGrade(q)}
                  aria-expanded={open}
                  title={open ? 'הסתרת הכיתות' : 'הצגת הכיתות'}
                  className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <span aria-hidden className={`transition-transform ${open ? '' : 'rotate-90'}`}>▾</span>
                </button>
              </div>
              {open && (
                <div className="mr-4 border-r border-slate-200 pr-1">
                  {classes.map((c) => (
                    <Link key={c.q} to={`${base}/students${c.q}`} className={link({ isActive: isHere(c.q) })}>
                      {c.label} {count(c.n)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* מחנך: "הכיתה שלי" — רשימת תלמידי הכיתה, בתצוגת הכיתה (אייל, 18.10) */}
      {myClasses.length > 0 && (
        <div className="rounded-xl bg-violet-50/70 py-1.5">
          <div className="px-3 pb-1 text-xs font-bold text-violet-700">{myClasses.length > 1 ? 'הכיתות שלי' : 'הכיתה שלי'}</div>
          {myClasses.map((c) => (
            <Link key={c.name} to={`${base}/students${c.q}`} onClick={onClassLens}
              className={link({ isActive: lensId === 'scope' && isHere(c.q) })}>
              <span className="truncate">{c.name}</span>
              {count(c.n)}
            </Link>
          ))}
        </div>
      )}

      {/* רכז מקצוע: רק המקצועות שלו (035 — גם התלמידים רק שלו). שאר המקצועות לא מוצגים */}
      {mySubjects.length > 0 && (
        <div className="rounded-xl bg-sky-50/60 py-1.5">
          <div className="px-3 pb-1 text-xs font-bold text-sky-700">המקצועות שלי</div>
          {mySubjects.map((s) => (
            <NavLink key={s.subject_key} to={`${base}/subject/${s.subject_key}`} className={link}>
              <span className="truncate">{s.subject_name}</span>
              {count(takers.get(s.subject_key) ?? 0)}
            </NavLink>
          ))}
        </div>
      )}

      {/* מחנך ורכז שכבה רואים רק מקצועות שלתלמידים שלהם יש בהם ציון (takers נספר מה-RLS) */}
      {!isSubjectCoordinator && SUBJECT_GROUPS.map((g) => {
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
