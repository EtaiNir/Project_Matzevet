import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useBagrut, type CardNavState } from './context'
import {
  BLOCKER_LABELS,
  completion,
  displayName,
  eligibilityKind,
  fmt,
  gradeTone,
  parseBlockers,
  questionnaireLabel,
  saveTracking,
  SUBJECT_GROUPS,
  TRACKING_FLAGS,
  type GradeRow,
  type RoundSubject,
  type SubjectRow,
  type TrackingFlag,
} from '@/lib/bagrut'
import { Card, CompletionMark, ContributionBar, Empty, Grade, StatusBadge } from '@/components/bagrut/ui'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'

type Tab = 'summary' | 'subjects' | 'all' | 'tracking'

/**
 * כרטיס תלמיד — **דף מעוצב**, לא טבלה. מחליף את שני טפסי "הכרטיס
 * האישי" באקסס (209 שדות על מסך אחד) ואת "כל שאלוני התלמיד".
 *
 * עיקרון "חריגים קודם": מקצוע שהושלם בציון עובר מוצג מקופל; נכשל או
 * "בתהליך" פתוח ובולט. הקודם/הבא מדפדפים ברשימה שממנה הגעת.
 */
export default function BagrutStudent() {
  const { id = '' } = useParams()
  const { data, index, base, round } = useBagrut()
  const navigate = useNavigate()
  const nav = useLocation().state as CardNavState | null
  const [tab, setTab] = useState<Tab>('summary')

  const s = index.studentById.get(id)
  const ids = nav?.ids ?? data.students.map((x) => x.student_id)
  const pos = ids.indexOf(id)
  const go = (i: number) => {
    const next = ids[i]
    if (next) navigate(`${base}/student/${next}`, { state: nav, replace: true })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
      // RTL: חץ ימינה = הקודם, שמאלה = הבא
      if (e.key === 'ArrowRight') go(pos - 1)
      if (e.key === 'ArrowLeft') go(pos + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!s) return <Empty title="התלמיד לא נמצא בסבב הזה" />

  const kind = eligibilityKind(s)
  const tracking = data.tracking.get(id)
  const flags = TRACKING_FLAGS.filter((f) => tracking?.[f.key])
  const gradesBySub = index.gradesByStudent.get(id) ?? new Map<string, GradeRow[]>()
  const metrics = index.metrics.get(id) ?? new Map<string, SubjectRow>()

  const tabs: [Tab, string][] = [
    ['summary', 'סיכום זכאות'],
    ['subjects', 'מקצועות'],
    ['all', 'כל השאלונים'],
    ['tracking', 'מעקב'],
  ]

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      {/* ── כותרת ── */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link to={nav?.backTo ?? `${base}/students`} className="rounded-lg px-2 py-1 text-sky-700 hover:bg-sky-50">
          → חזרה ל{nav?.fromLabel ?? 'רשימת התלמידים'}
        </Link>
        <span className="mr-auto" />
        <button disabled={pos <= 0} onClick={() => go(pos - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1 hover:border-sky-400 disabled:opacity-40">
          ▶ הקודם
        </button>
        <span className="tabular-nums text-slate-500">{pos + 1} מתוך {ids.length}</span>
        <button disabled={pos < 0 || pos >= ids.length - 1} onClick={() => go(pos + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1 hover:border-sky-400 disabled:opacity-40">
          הבא ◀
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-100 text-lg font-extrabold text-sky-800">
            {(s.first_name ?? displayName(s)).slice(0, 1)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold text-slate-800">{displayName(s)}</h1>
            <div className="text-sm text-slate-500">
              כיתה {s.class_name ?? '—'} · ת״ז <span className="tabular-nums">{s.student_id}</span>
              {s.track && <> · מגמת {s.track}</>}
              {s.missing_status && <> · {s.missing_status}</>}
            </div>
          </div>
          <span className="mr-auto" />
          {s.in_t2 && <StatusBadge kind={kind} long />}
          {flags.map((f) => (
            <span key={f.key} className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800 ring-1 ring-inset ring-amber-200">
              {f.icon} {f.label}
            </span>
          ))}
        </div>
        <div className="mt-4 flex gap-1 border-b border-slate-100">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
                tab === k ? 'border-sky-600 text-sky-800' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'summary' && <Summary sid={id} onSubjects={() => setTab('subjects')} />}
      {tab === 'subjects' && (
        <div className="flex flex-col gap-5">
          {SUBJECT_GROUPS.map((g) => {
            const subs = data.subjects.filter((x) => x.subject_group === g && (gradesBySub.has(x.subject_key) || metrics.get(x.subject_key)?.completion_status))
            const taken = subs.filter((x) => gradesBySub.has(x.subject_key))
            if (!taken.length) return null
            return (
              <div key={g}>
                <h2 className="mb-2 text-sm font-bold text-slate-500">{g === 'חובה' ? 'מקצועות המלל (חובה)' : g}</h2>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {taken.map((sub) => (
                    <SubjectTile key={sub.subject_key} sub={sub} grades={gradesBySub.get(sub.subject_key) ?? []} m={metrics.get(sub.subject_key)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {tab === 'all' && <AllQuestionnaires sid={id} />}
      {tab === 'tracking' && <TrackingPanel sid={id} />}

      <div className="text-center text-xs text-slate-400">
        {round.school_name} · {round.season} {round.school_year} · ← → לדפדוף
      </div>
    </div>
  )
}

// ─────────────────────────────── סיכום ───────────────────────────────

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail?: ReactNode }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl p-3 ${ok === false ? 'bg-rose-50' : ok ? 'bg-emerald-50/60' : 'bg-slate-50'}`}>
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${ok === false ? 'bg-rose-500' : ok ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        {ok === false ? '✕' : ok ? '✓' : '?'}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-bold text-slate-800">{label}</div>
        {detail && <div className="text-xs text-slate-600">{detail}</div>}
      </div>
    </div>
  )
}

function Summary({ sid, onSubjects }: { sid: string; onSubjects: () => void }) {
  const { index, data } = useBagrut()
  const s = index.studentById.get(sid)!
  const blockers = parseBlockers(s.blockers)
  const has = (k: string) => blockers.some((b) => b.kind === k)

  const metrics = index.metrics.get(sid)
  const progress = useMemo(() => {
    const c = { done: 0, progress: 0, not_started: 0 }
    for (const [key] of index.gradesByStudent.get(sid) ?? []) {
      const k = completion(metrics?.get(key)?.completion_status)
      if (k in c) c[k as keyof typeof c]++
    }
    return c
  }, [index, sid, metrics])

  if (!s.in_t2) {
    return (
      <Card title="בדרך לזכאות">
        <p className="text-sm text-slate-600">
          ניתוח הזכאות (T2) נעשה לשכבה המסיימת בלבד. לתלמיד בשכבה {s.grade} מוצגת כאן התקדמות המקצועות.
        </p>
        <div className="mt-3 flex gap-4 text-sm">
          <span className="text-emerald-700">✔ {progress.done} הושלמו</span>
          <span className="text-amber-700">◐ {progress.progress} בתהליך</span>
          <span className="text-slate-500">○ {progress.not_started} טרם החלו</span>
        </div>
        <button onClick={onSubjects} className="mt-3 text-sm font-semibold text-sky-700 hover:underline">לפירוט המקצועות ←</button>
      </Card>
    )
  }

  const units = s.total_units ? Number.parseFloat(s.total_units) : null
  const missing = blockers.find((b) => b.kind === 'missing_required')
  const kind = eligibilityKind(s)

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card title="בדרך לזכאות" className="lg:col-span-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Check ok={!missing} label="מקצועות חובה" detail={missing ? `חסרים: ${missing.subjects?.join(', ')}` : 'כל מקצועות החובה במגזר'} />
          <Check ok={!has('no_reinforced')} label="מקצוע מוגבר 5 יח״ל" detail={s.reinforced_subject && !has('no_reinforced') ? s.reinforced_subject : 'לא אותר מוגבר שעבר'} />
          <Check
            ok={s.negatives_count == null ? null : s.negatives_count === 0 || kind === 'one_negative'}
            label="ציונים שליליים"
            detail={s.negatives_count ? `${s.negatives_count} שליליים · ${s.one_negative_option ?? ''}` : 'אין ציון שלילי'}
          />
          <Check ok={s.mother_tongue_status ? !s.mother_tongue_status.includes('חסר') : null} label="שפת אם" detail={s.mother_tongue_status ?? '—'} />
          <Check ok={null} label="דרישות פנימיות" detail="חנ״ג, מעורבות חברתית, השכלה כללית — לא נבדקו בניתוח (בכפוף לבית הספר)" />
          <Check
            ok={s.compensation_eligible ? !s.compensation_eligible.includes('לא') : null}
            label="כלל השיפוי"
            detail={s.compensation_eligible ?? 'לא נבדק בניתוח'}
          />
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-bold text-slate-700">יחידות לימוד</span>
            <span className="tabular-nums text-slate-600">{units ?? '—'} / 21</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${units != null && units >= 21 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, ((units ?? 0) / 21) * 100)}%` }} />
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-4 lg:col-span-2">
        {s.intervention && (
          <div className="rounded-2xl border-2 border-sky-200 bg-sky-50 p-5">
            <div className="mb-1 text-xs font-bold text-sky-700">התערבות מומלצת</div>
            <p className="text-sm leading-relaxed text-sky-950">{s.intervention}</p>
          </div>
        )}
        {blockers.length > 0 && (
          <Card title="חסמים">
            <ul className="flex flex-col gap-1.5">
              {blockers.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-rose-500">●</span>
                  <span><strong className="font-semibold">{BLOCKER_LABELS[b.kind]}</strong>{b.kind !== 'missing_required' && b.kind !== 'no_reinforced' ? ` — ${b.text}` : b.subjects ? `: ${b.subjects.join(', ')}` : ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {(s.grades_summary || s.done_summary) && (
        <Card title="ריכוז המקצועות והציונים לזכאות" className="lg:col-span-5">
          <p className="text-sm leading-relaxed text-slate-700">{s.grades_summary}</p>
          {s.done_summary && <p className="mt-2 text-xs text-slate-500">מה כבר בוצע: {s.done_summary}</p>}
          {s.reason && <p className="mt-2 text-xs text-slate-500">סיבת הסטטוס: {s.reason}</p>}
          <p className="mt-3 text-[11px] text-slate-400">מקור: ניתוח T2 · {data.round.season} {data.round.school_year}</p>
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────── אריח מקצוע ───────────────────────────────

function SubjectTile({ sub, grades, m }: { sub: RoundSubject; grades: GradeRow[]; m: SubjectRow | undefined }) {
  const { index, data } = useBagrut()
  const comp = completion(m?.completion_status)
  const passed = comp === 'done' && gradeTone(m?.final_grade) === 'pass'
  const [open, setOpen] = useState(!passed)

  const order = index.questionnairesBySubject.get(sub.subject_key) ?? []
  const program = new Map((index.programBySubject.get(sub.subject_key) ?? []).map((p) => [p.questionnaire_code, p]))
  const rows = [...grades].sort((a, b) => order.indexOf(a.questionnaire_code) - order.indexOf(b.questionnaire_code))
  const tone = gradeTone(m?.final_grade ?? m?.cumulative_grade)
  const border = !passed && (tone === 'fail' || tone === 'borderline') ? 'border-rose-200' : comp === 'progress' ? 'border-amber-200' : 'border-slate-200'

  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${border}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-right">
        <CompletionMark value={comp} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold text-slate-800">{sub.subject_name}</div>
          <div className="text-xs text-slate-500">{m?.questionnaires ? `${m.questionnaires} שאלונים` : ''}{m?.units ? ` · ${m.units} יח״ל` : ''}</div>
        </div>
        <div className="text-left">
          <Grade value={m?.final_grade ?? null} strong />
          {m?.final_grade == null && m?.cumulative_grade != null && (
            <div className="mt-0.5 text-[11px] text-slate-400">מצטבר {fmt(m.cumulative_grade)}</div>
          )}
        </div>
        <span className="text-slate-300">{open ? '▴' : '▾'}</span>
      </button>
      <div className="px-4 pb-1">
        <ContributionBar parts={rows.map((g) => ({ code: g.questionnaire_code, weighted: g.weighted, weight: g.weight ?? program.get(g.questionnaire_code)?.weight ?? null, grade: g.grade }))} />
      </div>
      {open && (
        <div className="px-4 pb-4 pt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-slate-400">
                <th className="pb-1 text-right font-medium">שאלון</th>
                <th className="pb-1 font-medium">ציון</th>
                <th className="pb-1 font-medium">משקל</th>
                <th className="pb-1 font-medium">נקודות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.questionnaire_code} className="border-t border-slate-100">
                  <td className="py-1.5">
                    <span className="font-semibold tabular-nums">{g.questionnaire_code}</span>
                    <span className="mr-1 text-[11px] text-slate-400">{questionnaireLabel(data.questionnaires.get(g.questionnaire_code), null)}</span>
                  </td>
                  <td className="text-center"><Grade value={g.grade} /></td>
                  <td className="text-center text-xs tabular-nums text-slate-500">{g.weight != null ? `${Math.round(g.weight * 100)}%` : ''}</td>
                  <td className="text-center font-semibold tabular-nums text-slate-700">{fmt(g.weighted, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {m?.cumulative_weight != null && (
            <div className="mt-2 text-xs text-slate-500">
              משקל מצטבר {Math.round(m.cumulative_weight * 100)}% · ציון מצטבר {fmt(m.cumulative_grade)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────── כל השאלונים ───────────────────────────────

function AllQuestionnaires({ sid }: { sid: string }) {
  const { index, data } = useBagrut()
  const rows = [...(index.gradesByStudent.get(sid)?.values() ?? [])].flat()
  const columns: Column<GradeRow>[] = [
    { key: 'code', header: 'שאלון', width: 80, render: (g) => <span className="font-semibold tabular-nums">{g.questionnaire_code}</span>, sortValue: (g) => g.questionnaire_code },
    { key: 'sub', header: 'מקצוע', width: 170, render: (g) => index.subjectByKey.get(g.subject_key)?.subject_name, sortValue: (g) => index.subjectByKey.get(g.subject_key)?.subject_name },
    { key: 'form', header: 'צורת היבחנות', width: 150, render: (g) => <span className="text-xs text-slate-500">{data.questionnaires.get(g.questionnaire_code)?.exam_form}</span>, sortValue: (g) => data.questionnaires.get(g.questionnaire_code)?.exam_form },
    { key: 'grade', header: 'ציון', width: 70, align: 'center', render: (g) => <Grade value={g.grade} />, sortValue: (g) => g.grade },
    { key: 'w', header: 'משקל', width: 70, align: 'center', render: (g) => (g.weight != null ? `${Math.round(g.weight * 100)}%` : ''), sortValue: (g) => g.weight },
    { key: 'x', header: 'משוקלל', width: 80, align: 'center', render: (g) => fmt(g.weighted, 1), sortValue: (g) => g.weighted },
  ]
  return (
    <div className="flex h-[60vh] flex-col">
      <BagrutTable rows={rows} columns={columns} rowKey={(g) => `${g.subject_key}:${g.questionnaire_code}`} initialSort={{ key: 'sub', dir: 'asc' }} />
    </div>
  )
}

// ─────────────────────────────── מעקב ───────────────────────────────

function TrackingPanel({ sid }: { sid: string }) {
  const { data, round, canEditTracking, applyTracking } = useBagrut()
  const t = data.tracking.get(sid)
  const [short, setShort] = useState(t?.note_short ?? '')
  const [long, setLong] = useState(t?.note_long ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setShort(t?.note_short ?? '')
    setLong(t?.note_long ?? '')
  }, [sid, t?.note_short, t?.note_long])

  const save = async (patch: Parameters<typeof saveTracking>[2]) => {
    setBusy(true)
    setMsg(null)
    try {
      applyTracking(await saveTracking(round, sid, patch, data.tracking.get(sid)))
      setMsg({ ok: true, text: 'נשמר' })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const dirty = short !== (t?.note_short ?? '') || long !== (t?.note_long ?? '')

  return (
    <Card title="מעקב הצוות" action={t?.updated_at && <span className="text-xs text-slate-400">עודכן {new Date(t.updated_at).toLocaleString('he-IL')}</span>}>
      {!canEditTracking && <p className="mb-3 text-xs text-slate-500">צפייה בלבד — עדכון המעקב פתוח לצוות בית הספר.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {TRACKING_FLAGS.map((f) => {
          const on = Boolean(t?.[f.key as TrackingFlag])
          return (
            <button
              key={f.key}
              disabled={!canEditTracking || busy}
              onClick={() => save({ [f.key]: !on })}
              className={`flex items-center gap-3 rounded-xl border p-3 text-right transition ${
                on ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white hover:border-slate-300'
              } ${canEditTracking ? '' : 'cursor-default'}`}
            >
              <span className={`text-lg ${on ? '' : 'opacity-30 grayscale'}`}>{f.icon}</span>
              <span className="text-sm font-semibold text-slate-700">{f.label}</span>
              <span className={`mr-auto h-5 w-9 rounded-full p-0.5 transition ${on ? 'bg-amber-500' : 'bg-slate-200'}`}>
                <span className={`block h-4 w-4 rounded-full bg-white shadow transition ${on ? '-translate-x-4' : ''}`} />
              </span>
            </button>
          )
        })}
      </div>
      <label className="mt-4 block text-sm font-semibold text-slate-700">
        הערה קצרה
        <input value={short} disabled={!canEditTracking} onChange={(e) => setShort(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
      </label>
      <label className="mt-3 block text-sm font-semibold text-slate-700">
        הערות כלליות לתלמיד
        <textarea value={long} disabled={!canEditTracking} onChange={(e) => setLong(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
      </label>
      <div className="mt-3 flex items-center gap-3">
        {canEditTracking && (
          <button
            disabled={!dirty || busy}
            onClick={() => save({ note_short: short.trim() || null, note_long: long.trim() || null })}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-sky-700 disabled:opacity-40"
          >
            {busy ? 'שומר…' : 'שמירת ההערות'}
          </button>
        )}
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</span>}
      </div>
    </Card>
  )
}
