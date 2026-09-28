import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useBagrut, type CardNavState } from './context'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { Card, CompletionMark, Empty, Grade, Histogram, COMPLETION_META } from '@/components/bagrut/ui'
import {
  classSortKey,
  completion,
  displayName,
  fmt,
  questionnaireLabel,
  type BagrutStudent,
  type GradeRow,
  type SubjectRow,
} from '@/lib/bagrut'

interface Row {
  s: BagrutStudent
  m: SubjectRow | undefined
  q: Map<number, GradeRow>
}

/**
 * בקרת ציונים במקצוע — מסך **אחד** במקום 35 טפסי המקצוע באקסס.
 *
 * למעלה מבט-על מעוצב: כרטיס לכל שאלון (משקל, ניגשים, ממוצע) והתפלגות
 * הציון המצטבר. למטה הטבלה — קבוצת עמודות לכל שאלון (ציון · משקל ·
 * משוקלל), כמו הטופס של סבא, ואחריה מדדי המקצוע. לחיצה על עמודה
 * בהיסטוגרמה או על שאלון מסננת את הטבלה.
 */
export default function BagrutSubject() {
  const { key = '' } = useParams()
  const { data, index, base, round } = useBagrut()
  const navigate = useNavigate()
  const location = useLocation()
  const subject = index.subjectByKey.get(key)

  const [bin, setBin] = useState<[number, number] | null>(null)
  const [onlyWeak, setOnlyWeak] = useState(false)
  const [focusQ, setFocusQ] = useState<number | null>(null)
  const [grade, setGrade] = useState('')

  const codes = index.questionnairesBySubject.get(key) ?? []
  const program = new Map((index.programBySubject.get(key) ?? []).map((p) => [p.questionnaire_code, p]))

  // תלמידים שניגשו למקצוע = יש להם לפחות ציון שאלון אחד בו
  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const s of data.students) {
      const gs = index.gradesByStudent.get(s.student_id)?.get(key)
      if (!gs?.length) continue
      out.push({ s, m: index.metrics.get(s.student_id)?.get(key), q: new Map(gs.map((g) => [g.questionnaire_code, g])) })
    }
    return out
  }, [data.students, index, key])

  // שאלונים שיש להם ציון בפועל — בלי עמודות ריקות לשאלונים שאיש לא ניגש אליהם
  const activeCodes = codes.filter((c) => allRows.some((r) => r.q.has(c)))

  const stats = useMemo(() => {
    return activeCodes.map((c) => {
      const gs = allRows.map((r) => r.q.get(c)?.grade).filter((g): g is number => g != null)
      const avg = gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : null
      return { code: c, takers: gs.length, avg, weak: gs.filter((g) => g < 55).length }
    })
  }, [activeCodes, allRows])
  const avgOfAvgs = stats.filter((x) => x.avg != null && x.takers >= 5)
  const overall = avgOfAvgs.length ? avgOfAvgs.reduce((a, b) => a + b.avg!, 0) / avgOfAvgs.length : null

  const grades = [...new Set(allRows.map((r) => r.s.grade).filter(Boolean))].sort() as string[]
  const scoped = grade ? allRows.filter((r) => r.s.grade === grade) : allRows

  const rows = scoped.filter((r) => {
    const cum = r.m?.cumulative_grade
    if (onlyWeak && !(cum != null && cum < 55)) return false
    if (bin && !(cum != null && cum >= bin[0] && cum <= bin[1])) return false
    if (focusQ != null && !r.q.has(focusQ)) return false
    return true
  })

  const compCount = { done: 0, progress: 0, not_started: 0, unknown: 0 }
  for (const r of scoped) compCount[completion(r.m?.completion_status)]++

  if (!subject) return <Empty title="המקצוע לא נמצא בסבב הזה" />
  if (!allRows.length) return <Empty title={`אין ציונים ב${subject.subject_name}`}>אף תלמיד בסבב לא ניגש לשאלון במקצוע הזה.</Empty>

  const columns: Column<Row>[] = [
    { key: 'name', header: 'שם', width: 160, sticky: true, render: (r) => <span className="truncate font-semibold">{displayName(r.s)}</span>, sortValue: (r) => displayName(r.s) },
    { key: 'class', header: 'כיתה', width: 66, align: 'center', render: (r) => r.s.class_name, sortValue: (r) => classSortKey(r.s.class_name), exportValue: (r) => r.s.class_name },
    ...activeCodes.flatMap((c): Column<Row>[] => {
      const q = data.questionnaires.get(c)
      const w = program.get(c)?.weight
      const group = `q${c}`
      const title = (
        <span className="leading-tight">
          <span className="tabular-nums">{c}</span>
          <span className="block text-[10px] font-medium text-sky-700/80">{questionnaireLabel(q, w)}</span>
        </span>
      )
      return [
        { key: `${c}g`, group, groupTitle: title, header: 'ציון', exportHeader: `${c} ציון`, width: 58, align: 'center', render: (r) => r.q.has(c) ? <Grade value={r.q.get(c)?.grade} /> : null, sortValue: (r) => r.q.get(c)?.grade },
        { key: `${c}w`, group, header: 'משקל', exportHeader: `${c} משקל`, width: 54, align: 'center', render: (r) => <span className="text-xs tabular-nums text-slate-400">{r.q.get(c)?.weight != null ? `${Math.round(r.q.get(c)!.weight! * 100)}%` : ''}</span>, sortValue: (r) => r.q.get(c)?.weight },
        { key: `${c}x`, group, header: 'משוקלל', exportHeader: `${c} משוקלל`, width: 62, align: 'center', render: (r) => <span className="tabular-nums text-slate-600">{fmt(r.q.get(c)?.weighted, 1)}</span>, sortValue: (r) => r.q.get(c)?.weighted },
      ]
    }),
    { key: 'final', group: 'm', groupTitle: 'מדדי המקצוע', header: 'ציון סופי', width: 70, align: 'center', render: (r) => <Grade value={r.m?.final_grade} strong />, sortValue: (r) => r.m?.final_grade },
    { key: 'cum', group: 'm', header: 'מצטבר', width: 64, align: 'center', render: (r) => <span className="font-semibold tabular-nums">{fmt(r.m?.cumulative_grade)}</span>, sortValue: (r) => r.m?.cumulative_grade },
    { key: 'qs', group: 'm', header: 'שאלונים', width: 70, align: 'center', render: (r) => <span className="text-xs">{r.m?.questionnaires}</span>, sortValue: (r) => r.m?.questionnaires },
    { key: 'cw', group: 'm', header: 'משקל מצטבר', width: 76, align: 'center', render: (r) => <span className="text-xs tabular-nums">{r.m?.cumulative_weight != null ? `${Math.round(r.m.cumulative_weight * 100)}%` : ''}</span>, sortValue: (r) => r.m?.cumulative_weight },
    { key: 'status', group: 'm', header: 'השלמה', width: 90, render: (r) => <CompletionMark value={completion(r.m?.completion_status)} withLabel />, sortValue: (r) => r.m?.completion_status, exportValue: (r) => r.m?.completion_status },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
      {/* ── מבט-על ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs font-bold text-slate-400">{subject.subject_group === 'חובה' ? 'מקצועות המלל' : subject.subject_group}</div>
          <h1 className="text-2xl font-extrabold text-slate-800">{subject.subject_name}</h1>
        </div>
        <div className="mb-1 flex items-center gap-3 text-sm text-slate-600">
          <span><strong className="tabular-nums">{scoped.length}</strong> ניגשו</span>
          {(['done', 'progress', 'not_started'] as const).map((k) => (
            <span key={k} className={`flex items-center gap-1 ${COMPLETION_META[k].cls}`}>
              {COMPLETION_META[k].icon} <strong className="tabular-nums">{compCount[k]}</strong>
              <span className="text-xs">{COMPLETION_META[k].label}</span>
            </span>
          ))}
        </div>
        <span className="mr-auto" />
        {grades.length > 1 && (
          <select value={grade} onChange={(e) => setGrade(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value="">כל השכבות</option>
            {grades.map((g) => <option key={g} value={g}>שכבה {g}</option>)}
          </select>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-2">
          {stats.map((st) => {
            const q = data.questionnaires.get(st.code)
            const w = program.get(st.code)?.weight
            const odd = overall != null && st.avg != null && st.takers >= 5 && st.avg < overall - 12
            const on = focusQ === st.code
            return (
              <button
                key={st.code}
                onClick={() => setFocusQ(on ? null : st.code)}
                className={`rounded-2xl border bg-white p-3.5 text-right shadow-sm transition hover:border-sky-300 ${on ? 'border-sky-500 ring-2 ring-sky-200' : 'border-slate-200'}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-extrabold tabular-nums text-slate-800">{st.code}</span>
                  {w != null && <span className="rounded-md bg-sky-50 px-1.5 text-xs font-bold text-sky-800">{Math.round(w * 100)}%</span>}
                  {w == null && <span className="rounded-md bg-amber-50 px-1.5 text-[10px] font-bold text-amber-700" title="השאלון לא מופיע במצפן של בית הספר">לא במצפן</span>}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{q?.exam_form ?? '—'}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className={`text-2xl font-extrabold tabular-nums ${odd ? 'text-amber-600' : 'text-slate-700'}`}>{st.avg != null ? Math.round(st.avg) : '—'}</span>
                  <span className="text-xs text-slate-400">ממוצע</span>
                  {odd && <span title="ממוצע נמוך משמעותית משאר השאלונים במקצוע" className="text-amber-500">⚠</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {st.takers} ניגשו{st.weak ? <span className="text-rose-600"> · {st.weak} מתחת ל-55</span> : null}
                </div>
              </button>
            )
          })}
        </div>

        <Card title="התפלגות הציון המצטבר" action={bin && <button onClick={() => setBin(null)} className="text-xs text-sky-700 hover:underline">ביטול סינון {bin[0]}–{bin[1]}</button>}>
          <Histogram values={scoped.map((r) => r.m?.cumulative_grade).filter((v): v is number => v != null)} onBin={setBin} activeBin={bin} />
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={onlyWeak} onChange={(e) => setOnlyWeak(e.target.checked)} className="h-4 w-4 accent-rose-600" />
            רק מי שמתחת ל-55
          </label>
        </Card>
      </div>

      <BagrutTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.s.student_id}
        exportName={`בגרות_${round.school_name ?? ''}_${subject.subject_name}`}
        initialSort={{ key: 'cum', dir: 'asc' }}
        onRowClick={(r, _i, sorted) => {
          const state: CardNavState = { ids: sorted.map((x) => x.s.student_id), fromLabel: subject.subject_name, backTo: location.pathname }
          navigate(`${base}/student/${r.s.student_id}`, { state })
        }}
      />
    </div>
  )
}
