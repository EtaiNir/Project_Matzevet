import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useBagrut } from './context'
import {
  ACTION_OWNERS,
  ACTION_TYPES,
  CYCLE_FACTORS,
  LOG_KIND_LABELS,
  TRACKING_FLAGS,
  displayName,
  T2_FIELDS,
  type T2Field,
  createAction,
  createLogEntry,
  deleteAction,
  deleteLogEntry,
  analysisKind,
  eligibilityKind,
  ELIGIBILITY_META,
  overrideByText,
  fetchLatestAi,
  fetchStudentCycle,
  requestAi,
  saveTracking,
  updateAction,
  type ActionCounts,
  type AiAnalysis,
  type AiPicture,
  type AiPlan,
  type AiPlanAction,
  type BagrutAction,
  type BagrutLogEntry,
  type LogKind,
  type TrackingFlag,
} from '@/lib/bagrut'
import { fmtDate, relDays, todayIso } from '@/lib/bagrutCycle'
import { Card, StatusBadge } from '@/components/bagrut/ui'
import { saveBriefPdf, saveLogPdf, type BriefInput } from '@/lib/printLog'

/**
 * לשונית המעקב כמחזור התערבות — מצב → תוכנית → מעקב
 * (docs/bagrut-intervention-design.md).
 *
 * "מצב התלמיד" ו"תוכנית התערבות" מיוצרים ע"י AI — בכפתור, רק לתלמיד שהמורה
 * בוחר (Edge Function bagrut-ai, מיגרציה 031). ⚠️ זכאות נקבעת רק לפי T2
 * (decisions/014 §8): הניתוח מנסח ומתכנן, ואינו קובע זכאות.
 *
 * למורה בלבד — לתלמידים אין גישה למערכת.
 */

type AiState = { picture: AiAnalysis<AiPicture> | null; plan: AiAnalysis<AiPlan> | null }

// "הכנה לשיחה" הוסרה (משימה 6, פגישת 14.10): לשונית שלא עשתה דבר, עד שתגיע
// תבנית השיחה מהשותפה של סבא. התכנון נשאר ב-docs/bagrut-intervention-design.md §5.
type Inner = 'plan' | 'log'

const SESSIONS = ['מועד חורף', 'מועד קיץ', 'סוף המחצית', 'עד סוף החודש']

const input = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-normal focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300 disabled:bg-slate-50'

const countsOf = (actions: BagrutAction[]): ActionCounts => ({
  active: actions.filter((a) => a.status === 'active').length,
  done: actions.filter((a) => a.status === 'done').length,
})

export default function CycleTab({ sid }: { sid: string }) {
  const { round, applyActionCounts } = useBagrut()
  const [inner, setInner] = useState<Inner>('plan')
  const [actions, setActions] = useState<BagrutAction[] | null>(null)
  const [log, setLog] = useState<BagrutLogEntry[] | null>(null)
  const [ai, setAi] = useState<AiState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setActions(null)
    setLog(null)
    setAi(null)
    setError(null)
    Promise.all([fetchStudentCycle(round, sid), fetchLatestAi(round, sid)])
      .then(([r, a]) => {
        if (!alive) return
        setActions(r.actions)
        setLog(r.log)
        setAi(a)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [round, sid])

  // כל שינוי בתוכנית — גם לרשימה ולפס (מלכודת 26: מחילים את תשובת השרת)
  const changeActions = useCallback((next: BagrutAction[]) => {
    setActions(next)
    applyActionCounts(sid, countsOf(next))
  }, [sid, applyActionCounts])

  if (error) return <Card><p className="text-sm text-rose-700">{error}</p></Card>
  if (!actions || !log || !ai) return <Card><p className="text-sm text-slate-400">טוען את המעקב…</p></Card>

  const tabs: [Inner, string][] = [['plan', 'מצב ותוכנית'], ['log', `יומן מעקב${log.length ? ` (${log.length})` : ''}`]]

  return (
    <div className="flex flex-col gap-4">
      <StatusStrip sid={sid} actions={actions} />
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setInner(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              inner === k ? 'border-sky-600 text-sky-800' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {inner === 'plan' && <PlanView sid={sid} actions={actions} onActions={changeActions} ai={ai} onAi={setAi} />}
      {inner === 'log' && <LogView sid={sid} log={log} onLog={setLog} actions={actions} ai={ai} onAi={setAi} />}
    </div>
  )
}

// ─────────────────────────────── פס מצב ───────────────────────────────

function StatusStrip({ sid, actions }: { sid: string; actions: BagrutAction[] }) {
  const { index, data, round, canEditTracking, applyTracking } = useBagrut()
  const s = index.studentById.get(sid)!
  const t = data.tracking.get(sid)
  const kind = eligibilityKind(s)
  const blockers = s.blockers ? s.blockers.split(';').filter((b) => b.trim() && !b.includes('לא אותרו')).length : 0
  const c = countsOf(actions)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const setFollowup = async (v: string) => {
    setBusy(true)
    setErr(null)
    try {
      applyTracking(await saveTracking(round, sid, { next_followup: v || null }, t))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const rel = t?.next_followup ? relDays(t.next_followup) : null
  const relCls = rel?.tone === 'red' ? 'text-rose-700' : rel?.tone === 'amber' ? 'text-amber-700' : 'text-slate-500'

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      {kind === 'not_graduating' ? <span className="text-slate-500">לא בשכבה המסיימת</span> : <StatusBadge kind={kind} long manual={Boolean(s.override)} />}
      {s.total_units && <Stat label='יח"ל' value={`${s.total_units} / 21`} />}
      {kind !== 'not_graduating' && <Stat label="חסמים" value={blockers} warn={blockers > 0} />}
      {s.negatives_count != null && kind !== 'not_graduating' && <Stat label="שליליים" value={s.negatives_count} warn={s.negatives_count > 0} />}
      <Stat label="תוכנית" value={c.active + c.done ? `${c.done}/${c.active + c.done} הושלמו` : 'אין עדיין'} />
      <span className="mr-auto flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">מעקב הבא</span>
        <input
          type="date"
          value={t?.next_followup ?? ''}
          disabled={!canEditTracking || busy}
          onChange={(e) => setFollowup(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:border-transparent disabled:bg-transparent"
        />
        {rel && <span className={`text-xs font-semibold ${relCls}`}>{rel.text}</span>}
      </span>
      {err && <span className="w-full text-xs text-rose-700">{err}</span>}
    </div>
  )
}

function Stat({ label, value, warn = false }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <strong className={`tabular-nums ${warn ? 'text-rose-700' : 'text-slate-800'}`}>{value}</strong>
    </span>
  )
}

// ─────────────────────────────── מצב ותוכנית ───────────────────────────────

function PlanView({ sid, actions, onActions, ai, onAi }: {
  sid: string
  actions: BagrutAction[]
  onActions: (a: BagrutAction[]) => void
  ai: AiState
  onAi: (a: AiState) => void
}) {
  const { index } = useBagrut()
  const s = index.studentById.get(sid)!

  return (
    <div className="flex flex-col gap-4">
      {/* ניתוח הזכאות כפי שהגיע. "מצב התלמיד" של ה-AI הוסר מהמסך (21.10) — התוכנית
          נשארת; הפונקציה עדיין יודעת לייצר אותו, ומה שנוצר בעבר נשמר במסד */}
      <T2Card sid={sid} />
      <StaffCard sid={sid} />
      <PlanCard sid={sid} actions={actions} onActions={onActions} intervention={s.intervention}
        plan={ai.plan} onNewPlan={(a) => onAi({ ...ai, plan: a })} />
    </div>
  )
}

/**
 * ניתוח הזכאות (T2) — כל השדות, בכותרות ובתוכן המקוריים, בלי AI ובלי עיבוד.
 * סבא: "השקענו הרבה מאוד מחשבה ביצירה של 10 השדות האלה". שדה ריק נשאר ריק
 * (מסומן "—"), לא ממלאים ולא מסכמים. הזכאות — לפי מה שכתוב כאן (014 §8),
 * אלא אם רכז/ת הבגרויות שינו את הסטטוס ידנית (043): אז הכרטיס אומר זאת בראשו,
 * ושדה הסטטוס מסומן — השדות עצמם נשארים כפי שהגיעו (אייל, 21.10).
 */
function T2Card({ sid }: { sid: string }) {
  const { index } = useBagrut()
  const s = index.studentById.get(sid)!
  const value = (f: T2Field) => {
    const v = s[f.key]
    return v == null || String(v).trim() === '' ? null : String(v)
  }
  const short = T2_FIELDS.filter((f) => f.short)
  const long = T2_FIELDS.filter((f) => !f.short)
  const o = s.override
  return (
    <Card title="ניתוח הזכאות" action={<span className="text-xs text-slate-400">כפי שהגיע, בלי עיבוד</span>}>
      {!s.in_t2 ? (
        <p className="text-sm text-slate-500">לתלמיד הזה אין ניתוח זכאות — הוא נעשה לשכבה המסיימת בלבד.</p>
      ) : (
        <>
          {o && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-violet-900">סטטוס הזכאות שונה ידנית:</span>
                <StatusBadge kind={o.kind} long manual />
                <span className="text-xs text-violet-800">
                  {overrideByText(o)} ב-{fmtDate(o.set_at)} · בניתוח הזכאות: {ELIGIBILITY_META[analysisKind(s)].label}
                </span>
              </div>
              <p className="mt-1 text-violet-950"><span className="text-xs font-bold text-violet-700">סיבה: </span>{o.reason}</p>
              <p className="mt-1 text-[11px] text-violet-700">
                הסטטוס הזה קובע בכל המסכים — אחוזי הזכאות, מצטיינת וטק, הרשימות והייצוא. השדות שלמטה — ניתוח הזכאות כפי שהגיע.
              </p>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-slate-50 px-4 py-3 sm:grid-cols-3">
            {short.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="text-[11px] font-semibold leading-tight text-slate-500">{f.label}</dt>
                <dd className={`mt-0.5 text-sm font-bold ${value(f) ? 'text-slate-800' : 'text-slate-300'} ${f.key === 'status' && o ? 'line-through decoration-violet-400' : ''}`}>
                  {value(f) ?? '—'}
                </dd>
                {f.key === 'status' && o && (
                  <p className="mt-0.5 text-[11px] font-semibold text-violet-700">✎ שונה ידנית ל: {ELIGIBILITY_META[o.kind].label}</p>
                )}
              </div>
            ))}
          </dl>
          <dl className="mt-4 flex flex-col gap-3">
            {long.map((f) => (
              <div key={f.key}>
                <dt className="text-xs font-bold text-slate-500">{f.label}</dt>
                <dd className={`mt-0.5 whitespace-pre-wrap text-sm leading-relaxed ${value(f) ? 'text-slate-700' : 'text-slate-300'}`}>
                  {value(f) ?? '—'}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Card>
  )
}

/** כפתור "יצירת ניתוח" — קורא ל-AI רק כשהמורה לוחץ. לוקח עד דקה. */
function useAiRequest<T extends AiPicture | AiPlan>(sid: string, kind: 'picture' | 'plan', onNew: (a: AiAnalysis<T>) => void) {
  const { round } = useBagrut()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      onNew(await requestAi<T>(round, sid, kind))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, err, run }
}

function AiButton({ has, busy, onClick }: { has: boolean; busy: boolean; onClick: () => void }) {
  const { canEditTracking } = useBagrut()
  if (!canEditTracking) return null
  return (
    <button
      disabled={busy}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition disabled:opacity-60 ${
        has ? 'border border-violet-300 text-violet-700 hover:bg-violet-50' : 'bg-violet-600 text-white shadow-sm hover:bg-violet-700'
      }`}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {busy ? 'ה-AI מנתח… (עד דקה)' : has ? '↻ ניתוח מחדש' : '✨ יצירת ניתוח'}
    </button>
  )
}

/** "נוצר ב-…" — ואזהרה אם הניתוח נוצר על סבב קודם */
function AiMeta({ analysis }: { analysis: AiAnalysis }) {
  const { round } = useBagrut()
  const stale = analysis.round_id && analysis.round_id !== round.id
  return (
    <p className="mt-4 text-[11px] text-slate-400">
      ניתוח AI · {new Date(analysis.created_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })} — לבדיקת המורה. הזכאות עצמה — רק לפי ניתוח הזכאות.
      {stale && <span className="mr-1 rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">נוצר על סבב קודם — כדאי לנתח מחדש</span>}
    </p>
  )
}

// ── 6. מה הצוות יודע: דגלים, גורמים שאינם בציונים, הערות
function StaffCard({ sid, className = '' }: { sid: string; className?: string }) {
  const { data, round, canEditTracking, applyTracking } = useBagrut()
  const t = data.tracking.get(sid)
  // "הערה קצרה" הוסרה מהמסך (אייל, 7.10). העמודה note_short נשארת במסד — לא
  // מוחקים ערכים שכבר נכתבו (או יובאו מאקסס).
  const [long, setLong] = useState(t?.note_long ?? '')
  const [factorsNote, setFactorsNote] = useState(t?.factors_note ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setLong(t?.note_long ?? '')
    setFactorsNote(t?.factors_note ?? '')
  }, [sid, t?.note_long, t?.factors_note])

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

  const factors = t?.factors ?? []
  const dirty = long !== (t?.note_long ?? '') || factorsNote !== (t?.factors_note ?? '')

  return (
    <Card title="מה הצוות יודע" className={className} action={t?.updated_at && <span className="text-xs text-slate-400">עודכן {new Date(t.updated_at).toLocaleDateString('he-IL')}</span>}>
      {!canEditTracking && <p className="mb-3 text-xs text-slate-500">צפייה בלבד — עדכון המעקב פתוח לצוות בית הספר.</p>}
      <div className="flex flex-wrap gap-1.5">
        {TRACKING_FLAGS.map((f) => {
          const on = Boolean(t?.[f.key as TrackingFlag])
          return (
            <button
              key={f.key}
              disabled={!canEditTracking || busy}
              onClick={() => save({ [f.key]: !on })}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                on ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
              } ${canEditTracking ? '' : 'cursor-default'}`}
            >
              <span className={on ? '' : 'opacity-30 grayscale'}>{f.icon}</span>
              {f.label}
            </button>
          )
        })}
      </div>

      <div className="mt-4 text-xs font-bold text-slate-500">גורמים שאינם בציונים</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {CYCLE_FACTORS.map((f) => {
          const on = factors.includes(f)
          return (
            <button
              key={f}
              disabled={!canEditTracking || busy}
              onClick={() => save({ factors: on ? factors.filter((x) => x !== f) : [...factors, f] })}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                on ? 'border-violet-300 bg-violet-50 font-semibold text-violet-900' : 'border-slate-200 text-slate-500 hover:border-slate-300'
              } ${canEditTracking ? '' : 'cursor-default'}`}
            >
              {on ? '✓ ' : ''}{f}
            </button>
          )
        })}
      </div>
      <input value={factorsNote} disabled={!canEditTracking} onChange={(e) => setFactorsNote(e.target.value)} placeholder="פירוט (נכלל בניתוח ה-AI — בלי שם ובלי ת״ז)" className={`${input} mt-2`} />

      <label className="mt-4 block text-xs font-bold text-slate-500">
        הערות כלליות לתלמיד
        <textarea value={long} disabled={!canEditTracking} onChange={(e) => setLong(e.target.value)} rows={3} className={`${input} mt-1`} />
      </label>
      <div className="mt-3 flex items-center gap-3">
        {canEditTracking && (
          <button
            disabled={!dirty || busy}
            onClick={() => save({ note_long: long.trim() || null, factors_note: factorsNote.trim() || null })}
            className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-bold text-white shadow-sm hover:bg-sky-700 disabled:opacity-40"
          >
            {busy ? 'שומר…' : 'שמירה'}
          </button>
        )}
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</span>}
      </div>
    </Card>
  )
}

// ── תוכנית ההתערבות
/** מפתח קבוע להצעת AI — כדי שהצעה שאושרה או נדחתה לא תוצע שוב */
// התוכן כבר עבר plainTerms בטעינה, וגם המפתחות השמורים (plainAction) — כך הצעה
// שטופלה לפני התרגום לא חוזרת להופיע
const aiKey = (a: AiPlanAction) => `ai:${a.title.replace(/\s+/g, ' ').trim()}`

function PlanCard({ sid, actions, onActions, intervention, plan, onNewPlan }: {
  sid: string
  actions: BagrutAction[]
  onActions: (a: BagrutAction[]) => void
  intervention: string | null
  plan: AiAnalysis<AiPlan> | null
  onNewPlan: (a: AiAnalysis<AiPlan>) => void
}) {
  const { round, data, canEditTracking } = useBagrut()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const ai = useAiRequest<AiPlan>(sid, 'plan', onNewPlan)

  const taken = new Set(actions.map((a) => a.suggest_key).filter(Boolean))
  const open = (plan?.content.actions ?? []).filter((s) => !taken.has(aiKey(s)))
  const subjectKeyOf = (name: string | null) => (name ? data.subjects.find((x) => x.subject_name === name)?.subject_key ?? null : null)
  const active = actions.filter((a) => a.status === 'active')
  const done = actions.filter((a) => a.status === 'done')
  const dismissed = actions.filter((a) => a.status === 'dismissed')

  const run = async (key: string, fn: () => Promise<BagrutAction[]>) => {
    setBusy(key)
    setErr(null)
    try {
      onActions(await fn())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const fromSuggestion = (s: AiPlanAction, status: 'active' | 'dismissed') =>
    run(aiKey(s), async () => [...actions, await createAction(round, sid, {
      suggest_key: aiKey(s), title: s.title,
      detail: [s.why && `מטפל ב: ${s.why}`, s.how].filter(Boolean).join('\n') || null,
      action_type: s.action_type, subject_key: subjectKeyOf(s.subject), questionnaire_code: s.questionnaire_code,
      required_grade: s.required_grade, owner: s.owner || null, status,
    })])

  const patch = (a: BagrutAction, p: Partial<BagrutAction>) =>
    run(a.id, async () => {
      const saved = await updateAction(a.id, p)
      return actions.map((x) => (x.id === a.id ? saved : x))
    })

  const remove = (a: BagrutAction) =>
    run(a.id, async () => {
      await deleteAction(a.id)
      return actions.filter((x) => x.id !== a.id)
    })

  return (
    <Card title="תוכנית התערבות" action={
      <div className="flex items-center gap-2">
        {canEditTracking && !adding && (
          <button onClick={() => setAdding(true)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">+ פעולה ידנית</button>
        )}
        <AiButton has={Boolean(plan)} busy={ai.busy} onClick={ai.run} />
      </div>
    }>
      {intervention && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5">
          <div className="text-xs font-bold text-sky-700">ההתערבות המומלצת בניתוח הזכאות</div>
          <p className="mt-0.5 text-sm text-sky-950">{intervention}</p>
        </div>
      )}

      {(err || ai.err) && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{err || ai.err}</div>}
      {!plan && (
        <p className="mb-3 text-sm text-slate-500">
          "יצירת ניתוח" בונה מה-AI תוכנית מדורגת לתלמיד הזה — מתוך ההתערבות המומלצת והחסמים בניתוח הזכאות, הציונים ומה שהצוות כתב.
          כל פעולה מגיעה כהצעה, והמורה מחליט מה נכנס לתוכנית.
        </p>
      )}
      {plan?.content.note && <p className="mb-3 rounded-lg bg-violet-50/60 px-3 py-2 text-sm text-violet-950">{plan.content.note}</p>}
      {/* הצעות לשדות "אחראי" ו"עד מתי" — פעם אחת לכרטיס, לא בכל שורה */}
      <datalist id="bagrut-owners">{ACTION_OWNERS.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="bagrut-sessions">{SESSIONS.map((o) => <option key={o} value={o} />)}</datalist>

      {adding && <ManualAction sid={sid} onCancel={() => setAdding(false)} onSaved={(a) => { onActions([...actions, a]); setAdding(false) }} />}

      {open.length > 0 && (
        <Section title={`הצעות ה-AI (${open.length})`} hint="לפי סדר העדיפות. אישור מכניס פעולה לתוכנית.">
          {open.map((s, i) => (
            <div key={aiKey(s)} className="flex flex-wrap items-start gap-3 rounded-xl border border-dashed border-violet-300 bg-violet-50/30 p-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-700">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800">{s.title}</div>
                {s.why && <div className="mt-0.5 text-xs text-slate-500">מטפל ב: {s.why}</div>}
                {s.how && <div className="mt-1 text-xs leading-relaxed text-slate-700">{s.how}</div>}
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                  {s.action_type && <span className="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">{s.action_type}</span>}
                  {s.subject && <span className="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">{s.subject}{s.questionnaire_code ? ` · ${s.questionnaire_code}` : ''}</span>}
                  {s.owner && <span className="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">{s.owner}</span>}
                </div>
              </div>
              {s.required_grade != null && <RequiredBadge n={s.required_grade} />}
              {canEditTracking && (
                <div className="flex shrink-0 gap-1.5">
                  <button disabled={busy === aiKey(s)} onClick={() => fromSuggestion(s, 'active')} className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-40">✓ לתוכנית</button>
                  <button disabled={busy === aiKey(s)} onClick={() => fromSuggestion(s, 'dismissed')} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40">לא רלוונטי</button>
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      <Section title={`בביצוע (${active.length})`}>
        {active.length === 0 ? (
          <p className="text-sm text-slate-400">{open.length ? 'עוד לא אושרה פעולה — אשרו הצעה מלמעלה או הוסיפו פעולה ידנית.' : 'אין פעולות פתוחות.'}</p>
        ) : (
          active.map((a) => <ActionRow key={a.id} a={a} busy={busy === a.id} onPatch={(p) => patch(a, p)} onRemove={() => remove(a)} />)
        )}
      </Section>

      {(done.length > 0 || dismissed.length > 0) && (
        <button onClick={() => setShowClosed((v) => !v)} className="mt-3 text-xs font-semibold text-sky-700 hover:underline">
          {showClosed ? '▴' : '▾'} הושלמו ({done.length}) · לא רלוונטיות ({dismissed.length})
        </button>
      )}
      {showClosed && (
        <div className="mt-2 flex flex-col gap-2">
          {done.map((a) => <ActionRow key={a.id} a={a} busy={busy === a.id} onPatch={(p) => patch(a, p)} onRemove={() => remove(a)} />)}
          {dismissed.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2 text-sm text-slate-400">
              <span className="flex-1 line-through">{a.title}</span>
              {canEditTracking && <button disabled={busy === a.id} onClick={() => remove(a)} className="text-xs text-sky-700 hover:underline">החזרה להצעות</button>}
            </div>
          ))}
        </div>
      )}
      {plan && <AiMeta analysis={plan} />}
    </Card>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="mb-2 flex items-baseline gap-2">
        <h4 className="text-sm font-bold text-slate-700">{title}</h4>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function RequiredBadge({ n }: { n: number }) {
  return (
    <span className="shrink-0 rounded-lg bg-amber-50 px-2 py-1 text-center text-xs font-bold text-amber-800 ring-1 ring-inset ring-amber-200" title="הציון הנדרש כדי שהציון הסופי של המקצוע יגיע ל-55">
      נדרש {n}
    </span>
  )
}

function ActionRow({ a, busy, onPatch, onRemove }: { a: BagrutAction; busy: boolean; onPatch: (p: Partial<BagrutAction>) => void; onRemove: () => void }) {
  const { canEditTracking } = useBagrut()
  const [outcome, setOutcome] = useState(a.outcome ?? '')
  const done = a.status === 'done'
  const field = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-xs disabled:border-transparent disabled:bg-transparent'

  return (
    <div className={`rounded-xl border p-3 ${done ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <button
          disabled={!canEditTracking || busy}
          onClick={() => onPatch({ status: done ? 'active' : 'done' })}
          title={done ? 'החזרה לבביצוע' : 'סימון כהושלם'}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent hover:border-emerald-400'}`}
        >
          ✓
        </button>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold ${done ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{a.title}</div>
          {a.detail && <div className="mt-0.5 text-xs text-slate-600">{a.detail}</div>}
        </div>
        {a.required_grade != null && <RequiredBadge n={a.required_grade} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pr-8">
        <select disabled={!canEditTracking || busy} value={a.action_type ?? ''} onChange={(e) => onPatch({ action_type: e.target.value || null })} className={field} title="סוג הפעולה">
          <option value="">סוג פעולה…</option>
          {ACTION_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input
          list="bagrut-owners"
          disabled={!canEditTracking || busy}
          defaultValue={a.owner ?? ''}
          onBlur={(e) => e.target.value !== (a.owner ?? '') && onPatch({ owner: e.target.value.trim() || null })}
          placeholder="אחראי"
          className={`${field} w-32`}
        />
        <input
          list="bagrut-sessions"
          disabled={!canEditTracking || busy}
          defaultValue={a.due_label ?? ''}
          onBlur={(e) => e.target.value !== (a.due_label ?? '') && onPatch({ due_label: e.target.value.trim() || null })}
          placeholder="עד מתי / מועד"
          className={`${field} w-32`}
        />
        {canEditTracking && (
          // פעולה שנולדה מהצעה חוזרת להצעות; ידנית — נמחקת
          <button
            disabled={busy}
            onClick={() => (a.suggest_key || confirm('למחוק את הפעולה?')) && onRemove()}
            className="mr-auto text-xs text-slate-400 hover:text-rose-600"
          >
            {a.suggest_key ? 'החזרה להצעות' : 'מחיקה'}
          </button>
        )}
      </div>
      {done && (
        <div className="mt-2 flex items-center gap-2 pr-8">
          <input
            value={outcome}
            disabled={!canEditTracking || busy}
            onChange={(e) => setOutcome(e.target.value)}
            onBlur={() => outcome !== (a.outcome ?? '') && onPatch({ outcome: outcome.trim() || null })}
            placeholder="מה יצא? (למשל: ניגש בחורף, ציון 68)"
            className={`${field} flex-1`}
          />
        </div>
      )}
    </div>
  )
}

function ManualAction({ sid, onCancel, onSaved }: { sid: string; onCancel: () => void; onSaved: (a: BagrutAction) => void }) {
  const { round, data } = useBagrut()
  const [title, setTitle] = useState('')
  const [type, setType] = useState('')
  const [subject, setSubject] = useState('')
  const [owner, setOwner] = useState('')
  const [due, setDue] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      onSaved(await createAction(round, sid, {
        title: title.trim(), action_type: type || null, subject_key: subject || null,
        owner: owner.trim() || null, due_label: due.trim() || null, detail: detail.trim() || null, status: 'active',
      }))
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-sky-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="מה לעשות *" className={`${input} sm:col-span-2`} />
        <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
          <option value="">סוג פעולה…</option>
          {ACTION_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={subject} onChange={(e) => setSubject(e.target.value)} className={input}>
          <option value="">מקצוע (לא חובה)</option>
          {data.subjects.filter((x) => x.subject_group !== 'פנימי').map((x) => <option key={x.subject_key} value={x.subject_key}>{x.subject_name}</option>)}
        </select>
        <input list="bagrut-owners" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="אחראי" className={input} />
        <input list="bagrut-sessions" value={due} onChange={(e) => setDue(e.target.value)} placeholder="עד מתי / מועד" className={input} />
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="פירוט" rows={2} className={`${input} sm:col-span-2`} />
      </div>
      {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button disabled={!title.trim() || busy} onClick={submit} className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-40">{busy ? 'שומר…' : 'הוספה לתוכנית'}</button>
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">ביטול</button>
      </div>
    </div>
  )
}

// ─────────────────────────────── יומן מעקב ───────────────────────────────

function LogView({ sid, log, onLog, actions, ai, onAi }: {
  sid: string
  log: BagrutLogEntry[]
  onLog: (l: BagrutLogEntry[]) => void
  /** לסיכום ותוכנית: התוכנית וניתוח ה-AI שבמסך — וההצעות שייווצרו חוזרות אליו */
  actions: BagrutAction[]
  ai: AiState
  onAi: (a: AiState) => void
}) {
  const { round, data, index, canEditTracking, applyTracking } = useBagrut()
  const student = index.studentById.get(sid)
  // ייצוא ל-PDF — רשומה בודדת או כל היומן (משימה 4): ישר לחלון "שמירה בשם"
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const exportPdf = async (entries: BagrutLogEntry[], key: string) => {
    setPdfBusy(key)
    setErr(null)
    try {
      await saveLogPdf({
        studentName: student ? displayName(student) : sid,
        className: student?.class_name ?? null,
        school: round.school_name ?? round.school_code,
        roundLabel: `${round.season} ${round.school_year}`,
        entries,
      })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setPdfBusy(null)
    }
  }
  // ── סיכום ותוכנית (אייל, 21.10): הפגישה האחרונה + ניתוח הזכאות (הרקע לשיחה) +
  // תוכנית ההתערבות. אין תוכנית (לא פעולות ולא הצעות) — ה-AI יוצר הצעות, כמו
  // הכפתור "יצירת ניתוח": הן נשמרות ומופיעות בכרטיס התוכנית כהצעות לאישור, והמורה
  // מחליט מה נכנס. במסמך — "הצעה — טרם אושרה".
  const [briefStage, setBriefStage] = useState<string | null>(null)
  const exportBrief = async () => {
    setPdfBusy('brief')
    setBriefStage('יוצר קובץ…')
    setErr(null)
    try {
      await saveBriefPdf(student ? displayName(student) : sid, async (): Promise<BriefInput> => {
        const approved = actions.filter((a) => a.status !== 'dismissed')
        let plan = ai.plan
        let generatedNow = false
        if (!approved.length && !plan) {
          setBriefStage('ה-AI בונה תוכנית — עד דקה…')
          try {
            plan = await requestAi<AiPlan>(round, sid, 'plan')
          } catch (e) {
            throw new Error(`יצירת התוכנית ב-AI נכשלה: ${(e as Error).message}`)
          }
          generatedNow = true
          onAi({ ...ai, plan })
          setBriefStage('יוצר קובץ…')
        }
        const taken = new Set(actions.map((a) => a.suggest_key).filter(Boolean))
        const suggestions = (plan?.content.actions ?? []).filter((x) => !taken.has(aiKey(x)))
        // "הפגישה האחרונה" — שיחה או ישיבה; "עדכון" רק כשאין אחרת. היומן ממוין מהחדש
        const last = log.find((e) => e.kind !== 'update') ?? log[0] ?? null
        const s = student
        const kind = s ? eligibilityKind(s) : 'not_graduating'
        const o = s?.override
        return {
          studentName: s ? displayName(s) : sid,
          className: s?.class_name ?? null,
          school: round.school_name ?? round.school_code,
          roundLabel: `${round.season} ${round.school_year}`,
          lastEntry: last,
          eligibility: {
            graduating: Boolean(s?.in_t2),
            status: ELIGIBILITY_META[kind].label,
            manual: s && o
              ? `הסטטוס ${overrideByText(o)} ב-${fmtDate(o.set_at)} · סיבה: ${o.reason} · בניתוח הזכאות: ${ELIGIBILITY_META[analysisKind(s)].label}`
              : null,
            // הסטטוס כבר בראש הפרק; שאר השדות — כפי שהגיעו, ריק נשאר ריק
            fields: T2_FIELDS.filter((f) => f.key !== 'status').map((f) => {
              const v = s?.[f.key]
              return { label: f.label, value: v == null || String(v).trim() === '' ? null : String(v), short: Boolean(f.short) }
            }),
          },
          plan: {
            approved: approved
              .sort((a, b) => (a.status === b.status ? a.created_at.localeCompare(b.created_at) : a.status === 'active' ? -1 : 1))
              .map((a) => ({
                title: a.title, detail: a.detail, status: a.status === 'done' ? 'done' : 'active', actionType: a.action_type,
                owner: a.owner, due: a.due_label, requiredGrade: a.required_grade, outcome: a.outcome,
              })),
            suggestions: suggestions.map((x) => ({
              title: x.title, why: x.why || null, how: x.how || null,
              subject: x.subject ? `${x.subject}${x.questionnaire_code ? ` · ${x.questionnaire_code}` : ''}` : null,
              owner: x.owner || null, requiredGrade: x.required_grade,
            })),
            aiNote: plan?.content.note || null,
            aiAt: plan?.created_at ?? null,
            generatedNow,
          },
        }
      })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setPdfBusy(null)
      setBriefStage(null)
    }
  }
  const empty = { kind: 'student' as LogKind, happened_on: todayIso(), participants: '', summary: '', agreements: '', next_step: '', next_followup: '' }
  const [f, setF] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const valid = Boolean(f.summary.trim() || f.agreements.trim() || f.next_step.trim())

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const entry = await createLogEntry(round, sid, {
        kind: f.kind, happened_on: f.happened_on || todayIso(),
        participants: f.participants.trim() || null, summary: f.summary.trim() || null,
        agreements: f.agreements.trim() || null, next_step: f.next_step.trim() || null,
        next_followup: f.next_followup || null,
      })
      onLog([entry, ...log].sort((a, b) => b.happened_on.localeCompare(a.happened_on) || b.created_at.localeCompare(a.created_at)))
      // מעקב הבא שנקבע בשיחה — הופך למעקב הבא של התלמיד. ובלי מועד חדש: רשומה
      // מיום המעקב או אחריו **סוגרת** אותו — אחרת המועד נשאר "באיחור" לתמיד,
      // והתראת שווא קבועה מלמדת להתעלם מכל ההתראות (משימה 5)
      const cur = data.tracking.get(sid)
      const happened = f.happened_on || todayIso()
      if (f.next_followup) applyTracking(await saveTracking(round, sid, { next_followup: f.next_followup }, cur))
      else if (cur?.next_followup && cur.next_followup <= happened) applyTracking(await saveTracking(round, sid, { next_followup: null }, cur))
      setF(empty)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (e: BagrutLogEntry) => {
    if (!confirm('למחוק את הרשומה?')) return
    try {
      await deleteLogEntry(e.id)
      onLog(log.filter((x) => x.id !== e.id))
    } catch (x) {
      setErr((x as Error).message)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {canEditTracking && (
        <Card title="רשומה חדשה" className="lg:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={f.kind} onChange={(e) => set('kind', e.target.value)} className={input}>
              {(Object.keys(LOG_KIND_LABELS) as LogKind[]).map((k) => <option key={k} value={k}>{LOG_KIND_LABELS[k]}</option>)}
            </select>
            <input type="date" value={f.happened_on} onChange={(e) => set('happened_on', e.target.value)} className={input} />
            <input value={f.participants} onChange={(e) => set('participants', e.target.value)} placeholder="מי השתתף" className={`${input} sm:col-span-2`} />
          </div>
          <Field label="מה עלה"><textarea value={f.summary} onChange={(e) => set('summary', e.target.value)} rows={3} className={input} /></Field>
          <Field label="על מה הוסכם"><textarea value={f.agreements} onChange={(e) => set('agreements', e.target.value)} rows={2} className={input} /></Field>
          <Field label="הצעד הבא"><input value={f.next_step} onChange={(e) => set('next_step', e.target.value)} className={input} /></Field>
          <Field label="מעקב הבא"><input type="date" value={f.next_followup} onChange={(e) => set('next_followup', e.target.value)} className={input} /></Field>
          {(() => {
            const cur = data.tracking.get(sid)?.next_followup
            if (!cur || f.next_followup || cur > (f.happened_on || todayIso())) return null
            return <p className="mt-1 text-xs text-slate-500">בלי מועד חדש, הרשומה תסגור את המעקב שנקבע ל-{fmtDate(cur)}.</p>
          })()}
          {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
          <button disabled={!valid || busy} onClick={submit} className="mt-3 rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-40">
            {busy ? 'שומר…' : 'שמירה ביומן'}
          </button>
        </Card>
      )}

      <div className={`flex flex-col gap-3 ${canEditTracking ? 'lg:col-span-3' : 'lg:col-span-5'}`}>
        <div className="flex flex-wrap items-center gap-2">
          {log.length > 0 && <span className="text-xs text-slate-500">{log.length} רשומות</span>}
          <span className="mr-auto" />
          {/* שני מסמכים (אייל, 21.10): היומן כולו — כמו שהיה; סיכום ותוכנית — לשיחה */}
          {log.length > 0 && (
            <button
              disabled={pdfBusy !== null}
              onClick={() => exportPdf(log, 'all')}
              title="שמירת כל היומן כקובץ PDF — כל הרשומות, מהחדשה לישנה"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-sky-400 hover:text-sky-800 disabled:opacity-50"
            >
              {pdfBusy === 'all' ? 'יוצר קובץ…' : 'ייצוא היומן ל-PDF'}
            </button>
          )}
          <button
            disabled={pdfBusy !== null}
            onClick={exportBrief}
            title="הפגישה האחרונה, ניתוח הזכאות ותוכנית ההתערבות במסמך אחד. אין תוכנית — ה-AI יוצר הצעות, והן נשמרות גם בכרטיס התוכנית לאישור"
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 hover:border-sky-500 hover:bg-sky-100 disabled:opacity-50"
          >
            {pdfBusy === 'brief' ? briefStage ?? 'יוצר קובץ…' : 'סיכום ותוכנית ל-PDF'}
          </button>
        </div>
        {err && !canEditTracking && <p className="text-sm text-rose-700">{err}</p>}
        {log.length === 0 ? (
          <Card><p className="text-sm text-slate-400">עוד אין רשומות ביומן. אחרי שיחה עם התלמיד — כתבו מה עלה, על מה הוסכם, ומתי המעקב הבא.</p></Card>
        ) : (
          log.map((e) => (
            <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <strong className="text-sm text-slate-800">{LOG_KIND_LABELS[e.kind]}</strong>
                <span className="text-xs text-slate-500">{fmtDate(e.happened_on)}</span>
                {e.participants && <span className="text-xs text-slate-400">· {e.participants}</span>}
                <span className="mr-auto" />
                <button disabled={pdfBusy !== null} onClick={() => exportPdf([e], e.id)} title="שמירת הרשומה הזו בלבד כקובץ PDF" className="text-xs text-slate-400 hover:text-sky-700 disabled:opacity-50">{pdfBusy === e.id ? 'יוצר…' : 'PDF'}</button>
                {canEditTracking && <button onClick={() => remove(e)} className="text-xs text-slate-300 hover:text-rose-600">מחיקה</button>}
              </div>
              {e.summary && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{e.summary}</p>}
              {e.agreements && <p className="mt-2 text-sm"><span className="font-semibold text-slate-600">הוסכם: </span><span className="whitespace-pre-line text-slate-700">{e.agreements}</span></p>}
              {(e.next_step || e.next_followup) && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {e.next_step && <span className="rounded-md bg-sky-50 px-2 py-0.5 text-sky-800">הצעד הבא: {e.next_step}</span>}
                  {e.next_followup && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-800">מעקב: {fmtDate(e.next_followup)}</span>}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-2.5 block text-xs font-bold text-slate-500">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

