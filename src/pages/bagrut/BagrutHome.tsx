import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBagrut } from './context'
import {
  BLOCKER_LABELS,
  classSortKey,
  completion,
  eligibilityKind,
  ELIGIBILITY_META,
  isEligible,
  isOnTheEdge,
  parseBlockers,
  t1Summary,
  type BlockerKind,
  type EligibilityKind,
} from '@/lib/bagrut'
import { Card, Donut, KIND_ORDER, Kpi, StackedBar, TONE, type Segment } from '@/components/bagrut/ui'
import { HONOR_KEYS, HONOR_META, honorsMap, type HonorKey } from '@/lib/bagrutHonors'

/**
 * "תמונת מצב" — הדף הראשון במודול. עונה על "איפה אנחנו עומדים?" במבט
 * אחד, וכל מספר בו הוא דלת: לחיצה פותחת את רשימת התלמידים שמאחוריו.
 * באקסס לא היה מסך כזה — רק תפריטי כפתורים.
 */
export default function BagrutHome() {
  const { data, round } = useBagrut()
  const [params, setParams] = useSearchParams()
  const grades = useMemo(
    () => ([...new Set(data.students.map((s) => s.grade).filter(Boolean))] as string[]).sort().reverse(),
    [data.students],
  )
  const graduating = round.graduating_grade ?? grades[0] ?? ''
  // ברירת המחדל — השכבה המסיימת, אם יש בה תלמידים בתצוגה הזו. מחנך יב-1 לא
  // צריך לנחות על "שכבה יג — 0 תלמידים"
  const defaultGrade = grades.length && !grades.includes(graduating) ? grades[0] : graduating
  const grade = params.get('grade') || defaultGrade

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            {round.school_name ?? round.school_code}
            <span className="mr-2 text-lg font-bold text-slate-400">· {round.season} {round.school_year}</span>
          </h1>
        </div>
        <span className="mr-auto" />
        {grades.length > 1 && (
          <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
            {grades.map((g) => (
              <button
                key={g}
                onClick={() => setParams(g === defaultGrade ? {} : { grade: g }, { replace: true })}
                className={`rounded-lg px-4 py-1.5 text-sm font-bold transition ${
                  g === grade ? 'bg-sky-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                שכבה {g}
                {g === graduating && <span className="mr-1 text-xs font-medium opacity-80">(מסיימת)</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {grade === graduating ? <GraduatingView /> : <ProgressView grade={grade} />}
    </div>
  )
}

/** השכבה המסיימת — לפי ניתוח הזכאות (T2). */
function GraduatingView() {
  const { data, index, round, base } = useBagrut()
  const navigate = useNavigate()
  const go = (q: string) => navigate(`${base}/students${q}`)

  const grad = useMemo(() => data.students.filter((s) => s.in_t2), [data])
  const byKind = useMemo(() => {
    const m: Record<EligibilityKind, number> = { eligible: 0, one_negative: 0, not_eligible: 0, not_graduating: 0 }
    for (const s of grad) m[eligibilityKind(s)]++
    return m
  }, [grad])
  const eligible = grad.filter((s) => isEligible(eligibilityKind(s))).length
  const pct = grad.length ? Math.round((eligible / grad.length) * 100) : 0
  const edge = grad.filter(isOnTheEdge).length
  const fighting = data.students.filter((s) => data.tracking.get(s.student_id)?.fighting).length

  const segments = (counts: Record<string, number>): Segment[] =>
    KIND_ORDER.map((k) => ({ key: k, value: counts[k] ?? 0, color: TONE[ELIGIBILITY_META[k].tone].fill, label: ELIGIBILITY_META[k].label }))

  // ── לפי כיתה
  const classes = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const s of grad) {
      const c = s.class_name ?? '—'
      if (!m.has(c)) m.set(c, {})
      const k = eligibilityKind(s)
      m.get(c)![k] = (m.get(c)![k] ?? 0) + 1
    }
    return [...m.entries()].sort((a, b) => classSortKey(a[0]).localeCompare(classSortKey(b[0])))
  }, [grad])

  // ── חסמים נפוצים
  const blockers = useMemo(() => {
    const kinds = new Map<BlockerKind, number>()
    const required = new Map<string, number>()
    for (const s of grad) {
      if (eligibilityKind(s) !== 'not_eligible') continue
      const seen = new Set<BlockerKind>()
      for (const b of parseBlockers(s.blockers)) {
        if (!seen.has(b.kind)) kinds.set(b.kind, (kinds.get(b.kind) ?? 0) + 1)
        seen.add(b.kind)
        for (const sub of b.subjects ?? []) required.set(sub, (required.get(sub) ?? 0) + 1)
      }
    }
    return {
      kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]),
      required: [...required.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [grad])
  const maxBlocker = Math.max(1, ...blockers.kinds.map(([, n]) => n))

  // ── השלמת מקצועות בשכבה המסיימת
  const gradIds = useMemo(() => new Set(grad.map((s) => s.student_id)), [grad])
  const subjectProgress = useMemo(() => {
    return data.subjects
      .map((sub) => {
        const c = { done: 0, progress: 0, not_started: 0 }
        let takers = 0
        for (const id of gradIds) {
          if (!index.gradesByStudent.get(id)?.has(sub.subject_key)) continue
          takers++
          const k = completion(index.metrics.get(id)?.get(sub.subject_key)?.completion_status)
          if (k in c) c[k as keyof typeof c]++
        }
        return { sub, takers, c }
      })
      .filter((x) => x.takers > 0)
  }, [data.subjects, gradIds, index])

  return (
    <>
      <p className="-mt-3 text-sm text-slate-500">
        תמונת הזכאות של שכבה {round.graduating_grade} ({grad.length} תלמידים), לפי ניתוח הזכאות. כל מספר כאן נפתח לרשימת התלמידים שמאחוריו.
      </p>

      {/* ── מדדים ── */}
      <div className="flex flex-wrap gap-4">
        <Kpi value={`${pct}%`} label="אחוז הזכאות בשכבה" sub={`${eligible} זכאים מתוך ${grad.length} תלמידים`} tone="sky" onClick={() => go('?view=graduating')}>
          <Donut
            segments={segments(byKind)}
            size={76}
            center={<span className="text-xs font-bold text-slate-500">{grad.length}</span>}
          />
        </Kpi>
        <Kpi value={byKind.eligible + byKind.one_negative} label="תלמידים זכאים" sub={byKind.one_negative ? `מתוכם ${byKind.one_negative} במסלול שלילי אחד` : `מתוך ${grad.length} בשכבה`} tone="green" onClick={() => go('?kind=eligible_any')} />
        <Kpi value={byKind.not_eligible} label="תלמידים ללא זכאות" sub={`מתוך ${grad.length} בשכבה`} tone="red" onClick={() => go('?kind=not_eligible')} />
        <Kpi value={edge} label="תלמידים על הסף" sub="ללא זכאות, עם חסם אחד בלבד" tone="amber" onClick={() => go('?view=edge')} />
        {fighting > 0 && <Kpi value={fighting} label="תלמידים שסומנו «נלחמים על הזכאות»" sub="סימון של הצוות, בכל השכבות" onClick={() => go('?flag=fighting')} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* ── לפי כיתה ── */}
        <Card title="לפי כיתה" className="lg:col-span-3">
          <Legend
            items={KIND_ORDER.map((k) => [TONE[ELIGIBILITY_META[k].tone].fill, ELIGIBILITY_META[k].short])}
            note="המספר בפס: תלמידים · האחוז בקצה: שיעור הזכאים בכיתה · לחיצה על קטע בפס או על שם הכיתה פותחת את רשימת התלמידים"
          />
          <div className="flex flex-col gap-2.5">
            {classes.map(([cls, counts]) => {
              const n = Object.values(counts).reduce((a, b) => a + b, 0)
              const ok = (counts.eligible ?? 0) + (counts.one_negative ?? 0)
              return (
                <div key={cls} className="flex items-center gap-3">
                  <button onClick={() => go(`?class=${encodeURIComponent(cls)}&view=graduating`)} className="w-14 shrink-0 text-right text-sm font-bold text-slate-700 hover:text-sky-700">
                    {cls}
                  </button>
                  <div className="flex-1">
                    <StackedBar segments={segments(counts)} onSegment={(k) => go(`?class=${encodeURIComponent(cls)}&kind=${k}`)} />
                  </div>
                  <span className="w-12 shrink-0 text-left text-sm font-bold tabular-nums text-slate-600">{n ? Math.round((ok / n) * 100) : 0}%</span>
                </div>
              )
            })}
          </div>
        </Card>

        {/* ── חסמים ── */}
        <Card title="מה חוסם את מי שאין לו זכאות" className="lg:col-span-2">
          <Legend
            items={[['#fb7185', 'תלמידים שיש להם החסם']]}
            note="המספר: תלמידים; לתלמיד אחד יכולים להיות כמה חסמים · לחיצה על שורה פותחת את רשימת התלמידים"
          />
          <div className="flex flex-col gap-2">
            {blockers.kinds.map(([k, n]) => (
              <button key={k} onClick={() => go(`?blocker=${k}`)} className="group text-right">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-medium text-slate-700 group-hover:text-sky-700">{BLOCKER_LABELS[k]}</span>
                  <span className="mr-auto font-bold tabular-nums text-slate-800">{n}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-rose-400 transition group-hover:bg-rose-500" style={{ width: `${(n / maxBlocker) * 100}%` }} />
                </div>
              </button>
            ))}
          </div>
          {blockers.required.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 text-xs font-bold text-slate-400">מקצועות חובה שחסרים — ולכמה תלמידים</div>
              <div className="flex flex-wrap gap-1.5">
                {blockers.required.map(([sub, n]) => (
                  <button
                    key={sub}
                    onClick={() => go(`?blocker=missing_required&missing=${encodeURIComponent(sub)}`)}
                    title={`${sub} חסר ל-${n} תלמידים`}
                    className="flex items-center gap-1.5 rounded-full bg-rose-50 py-1 pl-1 pr-2.5 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-200 hover:bg-rose-100"
                  >
                    {sub}
                    <span className="rounded-full bg-white px-1.5 py-0.5 font-bold tabular-nums ring-1 ring-inset ring-rose-200">
                      {n === 1 ? 'תלמיד אחד' : `${n} תלמידים`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <HonorsCard />

      {/* ── מקצועות ── */}
      <Card title={`השלמת מקצועות — שכבה ${round.graduating_grade ?? ''}`}>
        <ProgressLegend />
        <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
          {subjectProgress.map(({ sub, takers, c }) => (
            <div key={sub.subject_key} className="flex items-center gap-3">
              <SubjectLink name={sub.subject_name} onClick={() => navigate(`${base}/subject/${sub.subject_key}`)} />
              <div className="flex-1">
                <StackedBar
                  height="h-3"
                  segments={[
                    { key: 'done', value: c.done, color: '#10b981', label: 'הושלם' },
                    { key: 'progress', value: c.progress, color: '#f59e0b', label: 'בתהליך' },
                    { key: 'not_started', value: c.not_started, color: '#cbd5e1', label: 'טרם החל' },
                  ]}
                />
              </div>
              <span className="w-10 shrink-0 text-left text-xs tabular-nums text-slate-500">{takers}</span>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-center text-xs text-slate-400">
        סטטוס הזכאות, החסמים וההתערבות המומלצת מגיעים מניתוח הזכאות. "על הסף" = אין זכאות וחסם אחד בלבד.
      </p>
    </>
  )
}

/**
 * שכבה שאינה מסיימת (י"ב בקיץ) — אין לה ניתוח זכאות, ולכן התמונה נבנית
 * מ-T1: כמה מקצועות כל תלמיד כבר השלים, ואיפה יש ציונים חלשים שכדאי
 * לטפל בהם *לפני* שהשכבה הופכת למסיימת.
 */
function ProgressView({ grade }: { grade: string }) {
  const { data, index, base } = useBagrut()
  const navigate = useNavigate()
  const go = (q: string) => navigate(`${base}/students?grade=${encodeURIComponent(grade)}${q}`)

  const students = useMemo(() => data.students.filter((s) => s.grade === grade), [data.students, grade])
  const summaries = useMemo(() => new Map(students.map((s) => [s.student_id, t1Summary(index, s.student_id)])), [students, index])
  const all = [...summaries.values()]
  const withWeak = all.filter((x) => x.weakGrades > 0).length
  const avgDone = all.length ? all.reduce((a, b) => a + b.done, 0) / all.length : 0
  const avgSubjects = all.length ? all.reduce((a, b) => a + b.subjects, 0) / all.length : 0
  const noGrades = all.filter((x) => x.subjects === 0).length

  const progressSegs = (c: { done: number; progress: number; not_started: number }): Segment[] => [
    { key: 'done', value: c.done, color: '#10b981', label: 'הושלם' },
    { key: 'progress', value: c.progress, color: '#f59e0b', label: 'בתהליך' },
    { key: 'not_started', value: c.not_started, color: '#cbd5e1', label: 'טרם החל' },
  ]

  // לפי כיתה: כמה תלמידים יש להם ציון חלש (מתחת ל-55) בשאלון כלשהו
  const classes = useMemo(() => {
    const m = new Map<string, { weak: number; n: number }>()
    for (const s of students) {
      const c = s.class_name ?? '—'
      if (!m.has(c)) m.set(c, { weak: 0, n: 0 })
      const x = m.get(c)!
      x.weak += summaries.get(s.student_id)!.weakGrades > 0 ? 1 : 0
      x.n++
    }
    return [...m.entries()].sort((a, b) => classSortKey(a[0]).localeCompare(classSortKey(b[0])))
  }, [students, summaries])

  // לפי מקצוע: השלמה + כמה תלמידים עם ציון חלש בו
  const subjects = useMemo(() => {
    return data.subjects
      .map((sub) => {
        const c = { done: 0, progress: 0, not_started: 0 }
        let takers = 0
        let weak = 0
        for (const s of students) {
          if (!index.gradesByStudent.get(s.student_id)?.has(sub.subject_key)) continue
          takers++
          const k = completion(index.metrics.get(s.student_id)?.get(sub.subject_key)?.completion_status)
          if (k in c) c[k as keyof typeof c]++
          if (summaries.get(s.student_id)!.weakSubjects.includes(sub.subject_key)) weak++
        }
        return { sub, takers, c, weak }
      })
      .filter((x) => x.takers > 0)
  }, [data.subjects, students, index, summaries])

  return (
    <>
      <p className="-mt-3 text-sm text-slate-500">
        לשכבה {grade} אין עדיין ניתוח זכאות (הוא נעשה לשכבה המסיימת בלבד). התמונה כאן: התקדמות במקצועות, וציונים חלשים שכדאי לטפל בהם עכשיו.
      </p>

      <div className="flex flex-wrap gap-4">
        <Kpi value={students.length} label={`תלמידי שכבה ${grade}`} sub="כל תלמידי השכבה בסבב" tone="sky" onClick={() => go('')} />
        <Kpi value={avgDone.toFixed(1)} label="מקצועות שהושלמו — ממוצע לתלמיד" sub={`מתוך ${avgSubjects.toFixed(1)} מקצועות בממוצע`} tone="green" />
        <Kpi value={withWeak} label="תלמידים עם ציון מתחת ל-55" sub="בשאלון אחד לפחות" tone="amber" onClick={() => go('&weak=1')} />
        {noGrades > 0 && <Kpi value={noGrades} label="תלמידים בלי אף ציון שאלון" sub="רשומים בסבב, בלי ציונים" tone="red" onClick={() => go('&nogrades=1')} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="לפי כיתה — תלמידים עם ציון חלש" className="lg:col-span-3">
          <Legend
            items={[
              ['#f59e0b', 'עם ציון חלש'],
              ['#10b981', 'בלי ציון חלש'],
            ]}
            note="ציון חלש = ציון מתחת ל-55 בשאלון אחד לפחות · המספר בפס: תלמידים · האחוז בקצה: שיעור התלמידים עם ציון חלש בכיתה · לחיצה על קטע בפס או על שם הכיתה פותחת את רשימת התלמידים"
          />
          <div className="flex flex-col gap-2.5">
            {classes.map(([cls, x]) => (
              <div key={cls} className="flex items-center gap-3">
                <button onClick={() => go(`&class=${encodeURIComponent(cls)}`)} className="w-14 shrink-0 text-right text-sm font-bold text-slate-700 hover:text-sky-700">
                  {cls}
                </button>
                <div className="flex-1">
                  <StackedBar
                    segments={[
                      { key: 'weak', value: x.weak, color: '#f59e0b', label: 'עם ציון חלש' },
                      { key: 'ok', value: x.n - x.weak, color: '#10b981', label: 'בלי ציון חלש' },
                    ]}
                    onSegment={(k) => go(`&class=${encodeURIComponent(cls)}&weak=${k === 'weak' ? 1 : 0}`)}
                  />
                </div>
                <span className="w-12 shrink-0 text-left text-sm font-bold tabular-nums text-slate-600">{x.n ? Math.round((x.weak / x.n) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="איפה הציונים החלשים" className="lg:col-span-2">
          <Legend
            items={[['#fbbf24', 'תלמידים עם ציון חלש במקצוע']]}
            note="ציון חלש = ציון מתחת ל-55 בשאלון · המספרים: תלמידים עם ציון חלש במקצוע, מתוך הלומדים אותו · לחיצה על שורה פותחת את מסך המקצוע"
          />
          <div className="flex flex-col gap-2">
            {[...subjects].sort((a, b) => b.weak - a.weak).filter((x) => x.weak > 0).slice(0, 10).map(({ sub, weak, takers }) => (
              <button key={sub.subject_key} onClick={() => navigate(`${base}/subject/${sub.subject_key}`)} className="group text-right">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-medium text-slate-700 group-hover:text-sky-700">{sub.subject_name}</span>
                  <span className="mr-auto font-bold tabular-nums text-slate-800">{weak}</span>
                  <span className="text-xs text-slate-400">/ {takers}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-amber-400 group-hover:bg-amber-500" style={{ width: `${(weak / Math.max(1, takers)) * 100}%` }} />
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card title={`השלמת מקצועות — שכבה ${grade}`}>
        <ProgressLegend />
        <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
          {subjects.map(({ sub, takers, c }) => (
            <div key={sub.subject_key} className="flex items-center gap-3">
              <SubjectLink name={sub.subject_name} onClick={() => navigate(`${base}/subject/${sub.subject_key}`)} />
              <div className="flex-1"><StackedBar height="h-3" segments={progressSegs(c)} /></div>
              <span className="w-10 shrink-0 text-left text-xs tabular-nums text-slate-500">{takers}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

/** שם המקצוע הוא הקישור למסך המקצוע — הפס שלידו אינו לחיץ. */
function SubjectLink({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`${name} — למסך המקצוע`}
      className="w-40 shrink-0 truncate text-right text-sm font-medium text-slate-700 hover:text-sky-700 hover:underline"
    >
      {name}
    </button>
  )
}

const PROGRESS_ITEMS: [string, string][] = [
  ['#10b981', 'הושלם'],
  ['#f59e0b', 'בתהליך'],
  ['#cbd5e1', 'טרם החל'],
]

/** מקרא אחיד לכל כרטיס בדף: נקודות צבע, ומתחתן שורה שמסבירה מה כל מספר. */
// ── בגרות מצטיינת וטק — טבעת לכל מדד, מתוך תלמידי השכבה המסיימת
const HONOR_PARTS: { key: 'yes' | 'near' | 'rest'; label: string; color: string }[] = [
  { key: 'yes', label: 'עומדים בתנאים', color: '#10b981' },
  { key: 'near', label: 'חסר תנאי אחד', color: '#f59e0b' },
  { key: 'rest', label: 'לא עומדים', color: '#cbd5e1' },
]

/**
 * אחוזי בגרות מצטיינת, טק וטק ללא אנגלית בשכבה המסיימת. החישוב — של אייל,
 * ב-lib/bagrutHonors (decisions/019): מעל ניתוח הזכאות, לא במקומו. לחיצה על
 * מדד או על שורה במקרא פותחת את מסך "מצטיינת וטק" מסונן.
 */
function HonorsCard() {
  const { data, index, base } = useBagrut()
  const navigate = useNavigate()
  const grad = useMemo(() => data.students.filter((s) => s.in_t2), [data.students])
  const counts = useMemo(() => {
    const honors = honorsMap(index, grad)
    const out = {} as Record<HonorKey, { yes: number; near: number; rest: number }>
    for (const k of HONOR_KEYS) {
      let yes = 0
      let near = 0
      for (const s of grad) {
        const r = honors.get(s.student_id)?.results[k]
        if (r?.ok) yes++
        else if (r?.missing === 1) near++
      }
      out[k] = { yes, near, rest: grad.length - yes - near }
    }
    return out
  }, [index, grad])
  if (!grad.length) return null
  const pct = (n: number) => `${Math.round((n / grad.length) * 100)}%`
  const open = (k: HonorKey, show: 'yes' | 'near' | 'all') => navigate(`${base}/honors?type=${k}&show=${show}`)

  return (
    <Card title="בגרות מצטיינת וטק — בשכבה המסיימת">
      <Legend
        items={HONOR_PARTS.map((p) => [p.color, p.label])}
        note={`האחוזים — מתוך ${grad.length} תלמידי השכבה המסיימת · רק תלמיד זכאי לפי ניתוח הזכאות יכול לעמוד בתנאים · לחיצה פותחת את רשימת התלמידים`}
      />
      <div className="grid gap-6 sm:grid-cols-3">
        {HONOR_KEYS.map((k) => {
          const c = counts[k]
          return (
            <div key={k} className="flex items-center gap-4">
              <button onClick={() => open(k, 'yes')} title={`${HONOR_META[k].label} — לרשימת העומדים בתנאים`} className="shrink-0 rounded-full transition hover:opacity-80">
                <Donut
                  size={96}
                  segments={HONOR_PARTS.map((p) => ({ key: p.key, value: c[p.key], color: p.color, label: p.label }))}
                  center={<span className="text-lg font-extrabold tabular-nums text-slate-800">{pct(c.yes)}</span>}
                />
              </button>
              <div className="min-w-0 text-sm">
                <div className="font-bold text-slate-800">{HONOR_META[k].label}</div>
                {HONOR_PARTS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => open(k, p.key === 'rest' ? 'all' : p.key)}
                    className="mt-0.5 flex w-full items-center gap-1.5 text-right text-xs text-slate-600 hover:text-sky-700"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
                    <span className="truncate">{p.label}</span>
                    <span className="mr-auto font-semibold tabular-nums text-slate-700">{c[p.key]}</span>
                    <span className="w-9 shrink-0 text-left tabular-nums text-slate-400">{pct(c[p.key])}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function Legend({ items, note }: { items: [string, string][]; note: string }) {
  return (
    <div className="mb-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
        {items.map(([color, label]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
      <p className="mt-1 leading-relaxed text-slate-400">{note}</p>
    </div>
  )
}

/** מקרא לכרטיס "השלמת מקצועות" — זהה בשתי השכבות. */
function ProgressLegend() {
  return (
    <Legend
      items={PROGRESS_ITEMS}
      note="המספר בפס: תלמידים · המספר בקצה השורה: סך הלומדים את המקצוע בשכבה · לחיצה על שם המקצוע פותחת את מסך המקצוע"
    />
  )
}
