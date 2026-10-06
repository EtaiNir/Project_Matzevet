import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useBagrut } from './context'
import { SUBJECT_GROUPS, programWeightSum, type RoundSubject } from '@/lib/bagrut'
import { Card, WeightBar } from '@/components/bagrut/ui'

/**
 * ריבוע שאלון: הסמל בשורה העליונה, המשקל ומספר הניגשים מתחתיו. כל ערך
 * באלמנט משלו — כשהיו בשורת טקסט אחת, כיוון ימין-לשמאל ערבב את סדר המספרים.
 */
function QuestionnaireChip({ code, weight, takers, alt = false, title }: {
  code: number
  weight: number | null
  takers: number
  alt?: boolean
  title?: string
}) {
  const zero = !(weight ?? 0)
  const tone = zero ? 'bg-slate-50 text-slate-400 ring-slate-200'
    : alt ? 'bg-violet-50 text-violet-900 ring-violet-300'
      : 'bg-sky-50 text-sky-900 ring-sky-200'
  return (
    <div title={title} className={`flex min-w-[4.5rem] flex-col items-center gap-0.5 rounded-lg px-2.5 py-1.5 ring-1 ring-inset ${tone}`}>
      <div className="flex items-center gap-1">
        {alt && <span className="text-[10px] font-bold text-violet-600">או</span>}
        <span className="text-sm font-bold tabular-nums">{code}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] tabular-nums">
        <span className="font-semibold">{Math.round((weight ?? 0) * 100)}%</span>
        <span className="text-slate-400">👥 {takers}</span>
      </div>
    </div>
  )
}

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
    const sum = programWeightSum(rows)
    // מקצוע שכל שאלוניו במשקל 0 (בחינות פנימיות) — מוצג כ-0%, לא אזהרה
    const allZero = sum === 0
    const ok = allZero || Math.abs(sum - 1) < 0.005
    const internal = sub.subject_group === 'פנימי'
    const note = rows.find((r) => r.notes)?.notes
    // קטע אחד בפס לכל שאלון — וקבוצת שאלונים שקולים היא קטע אחד
    const segments: { code: string; weight: number | null }[] = []
    const groupSeen = new Set<number>()
    for (const r of rows) {
      if (!(r.weight ?? 0)) continue
      if (r.alt_group == null) {
        segments.push({ code: String(r.questionnaire_code), weight: r.weight })
      } else if (!groupSeen.has(r.alt_group)) {
        groupSeen.add(r.alt_group)
        const members = rows.filter((x) => x.alt_group === r.alt_group).map((x) => x.questionnaire_code)
        segments.push({ code: members.join(' / '), weight: r.weight })
      }
    }
    return (
      <div key={sub.subject_key} className={`rounded-2xl border bg-white p-4 shadow-sm ${ok || internal ? 'border-slate-200' : 'border-amber-300'}`}>
        <div className="mb-2.5 flex items-center gap-2">
          <Link to={`${base}/subject/${sub.subject_key}`} className="font-bold text-slate-800 hover:text-sky-700">
            {sub.subject_name}
          </Link>
          {sub.units && <span className="text-xs text-slate-400">{sub.units} יח״ל</span>}
          <span className="mr-auto" />
          {!internal && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
              allZero ? 'bg-slate-100 text-slate-500' : ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
              {allZero ? '' : ok ? '✔ ' : '⚠ '}{Math.round(sum * 100)}%
            </span>
          )}
        </div>
        {segments.length > 0 && <WeightBar weights={segments} />}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {rows.map((r) => {
            const q = data.questionnaires.get(r.questionnaire_code)
            const n = takers.get(r.questionnaire_code) ?? 0
            const zero = !(r.weight ?? 0)
            const alt = r.alt_group != null
            return (
              <QuestionnaireChip
                key={r.questionnaire_code}
                code={r.questionnaire_code}
                weight={r.weight}
                takers={n}
                alt={alt}
                title={[alt && 'שאלון שקול — נספר אחד מהקבוצה', zero && 'משקל 0% — אינו נספר בציון הסופי',
                  q?.exam_form, q?.relation && `(${q.relation})`, `${n} תלמידים ניגשו`].filter(Boolean).join(' · ')}
              />
            )
          })}
        </div>
        {note && <div className="mt-2 text-xs text-slate-500">📝 {note}</div>}
      </div>
    )
  }

  const bad = data.subjects.filter((sub) => {
    if (sub.subject_group === 'פנימי') return false
    const sum = programWeightSum(index.programBySubject.get(sub.subject_key) ?? [])
    return sum > 0 && Math.abs(sum - 1) >= 0.005
  })

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-800">תוכנית הבגרות של בית הספר</h1>
        <p className="mt-1 text-sm text-slate-500">
          המצפן של {round.school_name} · {round.season} {round.school_year} — אילו שאלונים מרכיבים כל מקצוע, ובאיזה משקל.
        </p>
      </div>

      {/* ── מקרא: מה כל מספר בריבוע השאלון ── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-sm">
        <span className="font-bold text-slate-700">מקרא</span>
        <div className="flex items-center gap-2.5">
          <QuestionnaireChip code={16382} weight={0.27} takers={124} />
          <div className="flex flex-col gap-0.5 leading-tight">
            <span><strong>16382</strong> — סמל השאלון</span>
            <span><strong>27%</strong> — משקל השאלון בציון הסופי של המקצוע</span>
            <span><strong>👥 124</strong> — מספר התלמידים שניגשו אליו</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <QuestionnaireChip code={14331} weight={0.3} takers={0} alt />
          <span>שאלון שקול («או/או») — משלים את אותו חלק כמו שאלון אחר, ונספר אחד מהם</span>
        </div>
        <div className="flex items-center gap-2">
          <QuestionnaireChip code={23225} weight={0} takers={0} />
          <span>משקל 0% — אינו נספר בציון הסופי</span>
        </div>
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
