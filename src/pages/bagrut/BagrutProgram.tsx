import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useBagrut } from './context'
import { SUBJECT_GROUPS, type RoundSubject } from '@/lib/bagrut'
import { Card, WeightBar } from '@/components/bagrut/ui'

/**
 * תוכנית הבגרות של בית הספר ("המצפן") — **דף מעוצב**, לא טבלת אקסל.
 * כרטיס לכל מקצוע, ופס משקלים שחייב להתמלא בדיוק ל-100%.
 *
 * עמודות הבקרה שהיו נוסחאות באקסל (חלקן שבורות, #REF!) מחושבות כאן:
 * סכום משקלים, ומספר הניגשים לכל שאלון. ו"שאלונים יתומים" — שאלון שיש
 * לו ציונים ואין לו מקום במצפן, או להפך — הם חדשים: באקסס לא היה איך
 * לראות אותם.
 *
 * שלב 1: צפייה. עריכה (רכז בגרויות) — שלב 3 בתוכנית.
 */
export default function BagrutProgram() {
  const { data, index, round, base } = useBagrut()

  const takers = useMemo(() => {
    const m = new Map<number, number>()
    for (const g of data.grades) if (g.grade != null) m.set(g.questionnaire_code, (m.get(g.questionnaire_code) ?? 0) + 1)
    return m
  }, [data.grades])

  const inProgram = new Set(data.program.map((p) => p.questionnaire_code))
  const orphanGraded = [...takers.keys()].filter((c) => !inProgram.has(c)).sort()
  const unused = [...inProgram].filter((c) => !takers.has(c)).sort()

  const subjectCard = (sub: RoundSubject) => {
    const rows = index.programBySubject.get(sub.subject_key) ?? []
    if (!rows.length) return null
    const counted = rows.filter((r) => (r.weight ?? 0) > 0)
    const sum = counted.reduce((s, r) => s + (r.weight ?? 0), 0)
    const ok = Math.abs(sum - 1) < 0.005
    const internal = sub.subject_group === 'פנימי'
    const note = rows.find((r) => r.notes)?.notes
    return (
      <div key={sub.subject_key} className={`rounded-2xl border bg-white p-4 shadow-sm ${ok || internal ? 'border-slate-200' : 'border-amber-300'}`}>
        <div className="mb-2.5 flex items-center gap-2">
          <Link to={`${base}/subject/${sub.subject_key}`} className="font-bold text-slate-800 hover:text-sky-700">
            {sub.subject_name}
          </Link>
          {sub.units && <span className="text-xs text-slate-400">{sub.units} יח״ל</span>}
          <span className="mr-auto" />
          {!internal && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
              {ok ? '✔' : '⚠'} {Math.round(sum * 100)}%
            </span>
          )}
        </div>
        {counted.length > 0 && <WeightBar weights={counted.map((r) => ({ code: r.questionnaire_code, weight: r.weight }))} />}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {rows.map((r) => {
            const q = data.questionnaires.get(r.questionnaire_code)
            const n = takers.get(r.questionnaire_code) ?? 0
            const zero = !(r.weight ?? 0)
            return (
              <span
                key={r.questionnaire_code}
                title={[q?.exam_form, q?.relation && `(${q.relation})`, `${n} ניגשו`].filter(Boolean).join(' · ')}
                className={`rounded-lg px-2 py-1 text-[11px] ring-1 ring-inset ${
                  zero ? 'bg-slate-50 text-slate-400 ring-slate-200' : 'bg-sky-50 text-sky-900 ring-sky-200'
                }`}
              >
                <span className="font-bold tabular-nums">{r.questionnaire_code}</span>
                {!zero && <span className="mr-1 tabular-nums">{Math.round((r.weight ?? 0) * 100)}%</span>}
                <span className="mr-1 text-slate-400 tabular-nums">· {n}</span>
              </span>
            )
          })}
        </div>
        {note && <div className="mt-2 text-xs text-slate-500">📝 {note}</div>}
      </div>
    )
  }

  const bad = data.subjects.filter((sub) => {
    if (sub.subject_group === 'פנימי') return false
    const rows = (index.programBySubject.get(sub.subject_key) ?? []).filter((r) => (r.weight ?? 0) > 0)
    return rows.length > 0 && Math.abs(rows.reduce((s, r) => s + (r.weight ?? 0), 0) - 1) >= 0.005
  })

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-800">תוכנית הבגרות של בית הספר</h1>
        <p className="mt-1 text-sm text-slate-500">
          המצפן של {round.school_name} · {round.season} {round.school_year} — אילו שאלונים מרכיבים כל מקצוע, ובאיזה משקל.
          המספר האפור ליד כל שאלון = כמה תלמידים ניגשו אליו. שאלון במשקל 0 אינו נספר בציון הסופי.
        </p>
      </div>

      {/* ── בקרה ── */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card className={bad.length ? '!border-amber-300 !bg-amber-50/50' : ''}>
          <div className="text-3xl font-extrabold tabular-nums text-slate-800">{bad.length}</div>
          <div className="text-sm font-semibold text-slate-700">מקצועות שהמשקלים בהם לא מסתכמים ל-100%</div>
          {bad.length > 0 && <div className="mt-1 text-xs text-amber-800">{bad.map((b) => b.subject_name).join(' · ')}</div>}
        </Card>
        <Card className={orphanGraded.length ? '!border-amber-300 !bg-amber-50/50' : ''}>
          <div className="text-3xl font-extrabold tabular-nums text-slate-800">{orphanGraded.length}</div>
          <div className="text-sm font-semibold text-slate-700">שאלונים עם ציונים שאינם במצפן</div>
          {orphanGraded.length > 0 && (
            <div className="mt-1 text-xs text-amber-800">
              {orphanGraded.map((c) => `${c} (${takers.get(c)})`).join(' · ')}
            </div>
          )}
        </Card>
        <Card>
          <div className="text-3xl font-extrabold tabular-nums text-slate-800">{unused.length}</div>
          <div className="text-sm font-semibold text-slate-700">שאלונים במצפן שאיש לא ניגש אליהם</div>
          {unused.length > 0 && <div className="mt-1 text-xs text-slate-500">{unused.join(' · ')}</div>}
        </Card>
      </div>

      {SUBJECT_GROUPS.map((g) => {
        const subs = data.subjects.filter((s) => s.subject_group === g && index.programBySubject.get(s.subject_key)?.length)
        if (!subs.length) return null
        return (
          <div key={g}>
            <h2 className="mb-2 text-sm font-bold text-slate-500">{g === 'חובה' ? 'מקצועות המלל (חובה)' : g}</h2>
            <div className="grid gap-3 md:grid-cols-2">{subs.map(subjectCard)}</div>
          </div>
        )
      })}
    </div>
  )
}
