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
  const grade = params.get('grade') || graduating

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
                onClick={() => setParams(g === graduating ? {} : { grade: g }, { replace: true })}
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
        <Kpi value={`${pct}%`} label="אחוז זכאות" sub={`${eligible} מתוך ${grad.length}`} tone="sky" onClick={() => go('?view=graduating')}>
          <Donut
            segments={segments(byKind)}
            size={76}
            center={<span className="text-xs font-bold text-slate-500">{grad.length}</span>}
          />
        </Kpi>
        <Kpi value={byKind.eligible + byKind.one_negative} label="זכאים" sub={byKind.one_negative ? `מתוכם ${byKind.one_negative} במסלול שלילי אחד` : undefined} tone="green" onClick={() => go('?kind=eligible_any')} />
        <Kpi value={byKind.not_eligible} label="אין זכאות" tone="red" onClick={() => go('?kind=not_eligible')} />
        <Kpi value={edge} label="⚡ על הסף" sub="אין זכאות — וחסם אחד בלבד" tone="amber" onClick={() => go('?view=edge')} />
        {fighting > 0 && <Kpi value={fighting} label="🚩 נלחמים על הזכאות" onClick={() => go('?flag=fighting')} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* ── לפי כיתה ── */}
        <Card title="לפי כיתה" className="lg:col-span-3">
          <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-500">
            {KIND_ORDER.map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: TONE[ELIGIBILITY_META[k].tone].fill }} />
                {ELIGIBILITY_META[k].short}
              </span>
            ))}
          </div>
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
              <div className="mb-2 text-xs font-bold text-slate-400">מקצועות חובה שחסרים</div>
              <div className="flex flex-wrap gap-1.5">
                {blockers.required.map(([sub, n]) => (
                  <button
                    key={sub}
                    onClick={() => go(`?blocker=missing_required&missing=${encodeURIComponent(sub)}`)}
                    className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-200 hover:bg-rose-100"
                  >
                    {sub} <span className="font-bold tabular-nums">{n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── מקצועות ── */}
      <Card title={`השלמת מקצועות — שכבה ${round.graduating_grade ?? ''}`}>
        <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
          {subjectProgress.map(({ sub, takers, c }) => (
            <button key={sub.subject_key} onClick={() => navigate(`${base}/subject/${sub.subject_key}`)} className="group flex items-center gap-3 text-right">
              <span className="w-40 shrink-0 truncate text-sm font-medium text-slate-700 group-hover:text-sky-700">{sub.subject_name}</span>
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
            </button>
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

  // לפי כיתה: סך מצבי המקצועות של כל תלמידי הכיתה
  const classes = useMemo(() => {
    const m = new Map<string, { done: number; progress: number; not_started: number; weak: number; n: number }>()
    for (const s of students) {
      const c = s.class_name ?? '—'
      if (!m.has(c)) m.set(c, { done: 0, progress: 0, not_started: 0, weak: 0, n: 0 })
      const x = m.get(c)!
      const t = summaries.get(s.student_id)!
      x.done += t.done
      x.progress += t.progress
      x.not_started += t.notStarted
      x.weak += t.weakGrades > 0 ? 1 : 0
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
        <Kpi value={students.length} label={`תלמידי שכבה ${grade}`} tone="sky" onClick={() => go('')} />
        <Kpi value={avgDone.toFixed(1)} label="מקצועות שהושלמו — ממוצע לתלמיד" sub={`מתוך ${avgSubjects.toFixed(1)} מקצועות בממוצע`} tone="green" />
        <Kpi value={withWeak} label="תלמידים עם ציון מתחת ל-55" sub="בשאלון אחד לפחות" tone="amber" onClick={() => go('&weak=1')} />
        {noGrades > 0 && <Kpi value={noGrades} label="בלי אף ציון שאלון" tone="red" onClick={() => go('&nogrades=1')} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="לפי כיתה — מצב המקצועות" className="lg:col-span-3">
          <div className="mb-3 flex gap-3 text-xs text-slate-500">
            {progressSegs({ done: 0, progress: 0, not_started: 0 }).map((s) => (
              <span key={s.key} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            {classes.map(([cls, x]) => (
              <div key={cls} className="flex items-center gap-3">
                <button onClick={() => go(`&class=${encodeURIComponent(cls)}`)} className="w-14 shrink-0 text-right text-sm font-bold text-slate-700 hover:text-sky-700">
                  {cls}
                </button>
                <div className="flex-1"><StackedBar segments={progressSegs(x)} /></div>
                <span className="w-20 shrink-0 text-left text-xs text-slate-500" title="תלמידים עם ציון מתחת ל-55">
                  {x.weak ? <span className="font-bold text-amber-700">{x.weak} חלשים</span> : '—'} / {x.n}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="איפה הציונים החלשים" className="lg:col-span-2">
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
        <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
          {subjects.map(({ sub, takers, c }) => (
            <button key={sub.subject_key} onClick={() => navigate(`${base}/subject/${sub.subject_key}`)} className="group flex items-center gap-3 text-right">
              <span className="w-40 shrink-0 truncate text-sm font-medium text-slate-700 group-hover:text-sky-700">{sub.subject_name}</span>
              <div className="flex-1"><StackedBar height="h-3" segments={progressSegs(c)} /></div>
              <span className="w-10 shrink-0 text-left text-xs tabular-nums text-slate-500">{takers}</span>
            </button>
          ))}
        </div>
      </Card>
    </>
  )
}
