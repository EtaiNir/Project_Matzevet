import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useBagrut } from './context'
import {
  ACTION_OWNERS,
  ACTION_TYPES,
  BLOCKER_LABELS,
  CYCLE_FACTORS,
  LOG_KIND_LABELS,
  TRACKING_FLAGS,
  createAction,
  createLogEntry,
  deleteAction,
  deleteLogEntry,
  eligibilityKind,
  fetchStudentCycle,
  saveTracking,
  updateAction,
  type ActionCounts,
  type BagrutAction,
  type BagrutLogEntry,
  type LogKind,
  type TrackingFlag,
} from '@/lib/bagrut'
import { buildSuggestions, fmtDate, relDays, studentPicture, todayIso, type Suggestion } from '@/lib/bagrutCycle'
import { Card, StatusBadge } from '@/components/bagrut/ui'

/**
 * לשונית המעקב כמחזור התערבות — מצב → תוכנית → מעקב
 * (docs/bagrut-intervention-design.md, שלב 1).
 *
 * ⚠️ זכאות נקבעת רק לפי T2 (decisions/014 §8). הסטטוס והחסמים כאן הם של
 * T2; ההצעות לתוכנית הן פריטי ההתערבות המומלצת של T2; הקוד מוסיף רק חשבון
 * ציונים (איזה ציון צריך כדי לסיים מקצוע ב-55).
 *
 * למורה בלבד — לתלמידים אין גישה למערכת.
 */

type Inner = 'plan' | 'log' | 'prep'

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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setActions(null)
    setLog(null)
    setError(null)
    fetchStudentCycle(round, sid)
      .then((r) => {
        if (!alive) return
        setActions(r.actions)
        setLog(r.log)
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
  if (!actions || !log) return <Card><p className="text-sm text-slate-400">טוען את המעקב…</p></Card>

  const tabs: [Inner, string][] = [['plan', 'מצב ותוכנית'], ['log', `יומן מעקב${log.length ? ` (${log.length})` : ''}`], ['prep', '🗒 הכנה לשיחה']]

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
      {inner === 'plan' && <PlanView sid={sid} actions={actions} onActions={changeActions} />}
      {inner === 'log' && <LogView sid={sid} log={log} onLog={setLog} />}
      {inner === 'prep' && <PrepView />}
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
      {kind === 'not_graduating' ? <span className="text-slate-500">לא בשכבה המסיימת</span> : <StatusBadge kind={kind} long />}
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

function PlanView({ sid, actions, onActions }: { sid: string; actions: BagrutAction[]; onActions: (a: BagrutAction[]) => void }) {
  const { index } = useBagrut()
  const s = index.studentById.get(sid)!
  const suggestions = useMemo(() => buildSuggestions(s, index), [s, index])
  const picture = useMemo(() => studentPicture(s, index, suggestions), [s, index, suggestions])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="מצב התלמיד" className="lg:col-span-3">
          <p className="text-base font-bold leading-snug text-slate-800">{picture.sentence}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Question n={2} title="מה מפריד אותו מזכאות" empty={picture.graduating ? 'לא אותרו חסמים בניתוח הזכאות' : 'אין ניתוח זכאות לשכבה הזו'}>
              {picture.blockers.map((b, i) => (
                <li key={i}>
                  <strong className="font-semibold">{BLOCKER_LABELS[b.kind]}</strong>
                  {b.kind === 'missing_required' && b.subjects ? `: ${b.subjects.join(', ')}` : b.kind !== 'other' && b.text !== BLOCKER_LABELS[b.kind] ? ` — ${b.text}` : b.kind === 'other' ? ` — ${b.text}` : ''}
                </li>
              ))}
              {picture.failing.map((f) => (
                <li key={f.name}>{f.name}: <strong className="text-rose-700">{f.final}</strong> <span className="text-slate-500">— {f.gap} נקודות מ-55</span></li>
              ))}
            </Question>

            <Question n={3} title="מה הכי קרוב לתיקון" empty="אין כרגע פעולה עם חשבון ציון">
              {picture.closest.map((c) => (
                <li key={c.key}>
                  <strong className="font-semibold">{c.title}</strong>
                  {c.detail && <div className="text-xs text-slate-500">{c.detail}</div>}
                </li>
              ))}
            </Question>

            <Question n={4} title="מה בסכנה" empty="אין מקצוע בתהליך שהממוצע בו מתחת ל-55">
              {picture.atRisk.map((r) => (
                <li key={r.name}>{r.name}: ממוצע <strong className="text-rose-700">{r.average}</strong> <span className="text-slate-500">ב-{r.done}% שבוצעו</span></li>
              ))}
            </Question>

            <Question n={5} title="על מה אפשר לבנות" empty="עוד אין מקצוע שהושלם בציון 80 ומעלה">
              {picture.strengths.map((x) => (
                <li key={x.name}>{x.name}: <strong className="text-emerald-700">{x.final}</strong></li>
              ))}
            </Question>
          </div>
          <p className="mt-4 text-[11px] text-slate-400">
            הסטטוס והחסמים — מניתוח הזכאות. החשבון (נקודות חסרות, ציון נדרש) — מציוני השאלונים ומשקלי המצפן. פירוט מלא בלשוניות "מקצועות" ו"כל השאלונים".
          </p>
        </Card>

        <StaffCard sid={sid} className="lg:col-span-2" />
      </div>

      <PlanCard sid={sid} suggestions={suggestions} actions={actions} onActions={onActions} intervention={s.intervention} />
    </div>
  )
}

function Question({ n, title, empty, children }: { n: number; title: string; empty: string; children: ReactNode }) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean)
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-500">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[10px] text-slate-500">{n}</span>
        {title}
      </div>
      {items.length ? <ul className="flex flex-col gap-1.5 text-sm text-slate-700">{children}</ul> : <p className="text-sm text-slate-400">{empty}</p>}
    </div>
  )
}

// ── 6. מה הצוות יודע: דגלים, גורמים שאינם בציונים, הערות
function StaffCard({ sid, className = '' }: { sid: string; className?: string }) {
  const { data, round, canEditTracking, applyTracking } = useBagrut()
  const t = data.tracking.get(sid)
  const [short, setShort] = useState(t?.note_short ?? '')
  const [long, setLong] = useState(t?.note_long ?? '')
  const [factorsNote, setFactorsNote] = useState(t?.factors_note ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setShort(t?.note_short ?? '')
    setLong(t?.note_long ?? '')
    setFactorsNote(t?.factors_note ?? '')
  }, [sid, t?.note_short, t?.note_long, t?.factors_note])

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
  const dirty = short !== (t?.note_short ?? '') || long !== (t?.note_long ?? '') || factorsNote !== (t?.factors_note ?? '')

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
      <input value={factorsNote} disabled={!canEditTracking} onChange={(e) => setFactorsNote(e.target.value)} placeholder="פירוט (לא נשלח לשום מקום מחוץ למערכת)" className={`${input} mt-2`} />

      <label className="mt-4 block text-xs font-bold text-slate-500">
        הערה קצרה
        <input value={short} disabled={!canEditTracking} onChange={(e) => setShort(e.target.value)} className={`${input} mt-1`} />
      </label>
      <label className="mt-3 block text-xs font-bold text-slate-500">
        הערות כלליות לתלמיד
        <textarea value={long} disabled={!canEditTracking} onChange={(e) => setLong(e.target.value)} rows={3} className={`${input} mt-1`} />
      </label>
      <div className="mt-3 flex items-center gap-3">
        {canEditTracking && (
          <button
            disabled={!dirty || busy}
            onClick={() => save({ note_short: short.trim() || null, note_long: long.trim() || null, factors_note: factorsNote.trim() || null })}
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
function PlanCard({ sid, suggestions, actions, onActions, intervention }: {
  sid: string
  suggestions: Suggestion[]
  actions: BagrutAction[]
  onActions: (a: BagrutAction[]) => void
  intervention: string | null
}) {
  const { round, canEditTracking } = useBagrut()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [showClosed, setShowClosed] = useState(false)

  const taken = new Set(actions.map((a) => a.suggest_key).filter(Boolean))
  const open = suggestions.filter((s) => !taken.has(s.key))
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

  const fromSuggestion = (s: Suggestion, status: 'active' | 'dismissed') =>
    run(s.key, async () => [...actions, await createAction(round, sid, {
      suggest_key: s.key, title: s.title, detail: s.detail, action_type: s.action_type,
      subject_key: s.subject_key, questionnaire_code: s.questionnaire_code, required_grade: s.required_grade, status,
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
    <Card title="תוכנית התערבות" action={canEditTracking && !adding && (
      <button onClick={() => setAdding(true)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">+ פעולה ידנית</button>
    )}>
      {intervention && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5">
          <div className="text-xs font-bold text-sky-700">ההתערבות המומלצת בניתוח הזכאות</div>
          <p className="mt-0.5 text-sm text-sky-950">{intervention}</p>
        </div>
      )}

      {err && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>}
      {/* הצעות לשדות "אחראי" ו"עד מתי" — פעם אחת לכרטיס, לא בכל שורה */}
      <datalist id="bagrut-owners">{ACTION_OWNERS.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="bagrut-sessions">{SESSIONS.map((o) => <option key={o} value={o} />)}</datalist>

      {adding && <ManualAction sid={sid} onCancel={() => setAdding(false)} onSaved={(a) => { onActions([...actions, a]); setAdding(false) }} />}

      {open.length > 0 && (
        <Section title={`הצעות מתוך ניתוח הזכאות (${open.length})`} hint="כל הצעה היא פריט מההתערבות המומלצת. אישור מכניס אותה לתוכנית.">
          {open.map((s) => (
            <div key={s.key} className="flex flex-wrap items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800">{s.title}</div>
                {s.detail && <div className="mt-0.5 text-xs text-slate-600">{s.detail}</div>}
                {s.source !== s.title && <div className="mt-1 text-[11px] text-slate-400">מתוך: {s.source}</div>}
              </div>
              {s.required_grade != null && <RequiredBadge n={s.required_grade} />}
              {canEditTracking && (
                <div className="flex shrink-0 gap-1.5">
                  <button disabled={busy === s.key} onClick={() => fromSuggestion(s, 'active')} className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-40">✓ לתוכנית</button>
                  <button disabled={busy === s.key} onClick={() => fromSuggestion(s, 'dismissed')} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40">לא רלוונטי</button>
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

function LogView({ sid, log, onLog }: { sid: string; log: BagrutLogEntry[]; onLog: (l: BagrutLogEntry[]) => void }) {
  const { round, data, canEditTracking, applyTracking } = useBagrut()
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
      // מעקב הבא שנקבע בשיחה — הופך למעקב הבא של התלמיד
      if (f.next_followup) applyTracking(await saveTracking(round, sid, { next_followup: f.next_followup }, data.tracking.get(sid)))
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
          {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
          <button disabled={!valid || busy} onClick={submit} className="mt-3 rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-40">
            {busy ? 'שומר…' : 'שמירה ביומן'}
          </button>
        </Card>
      )}

      <div className={`flex flex-col gap-3 ${canEditTracking ? 'lg:col-span-3' : 'lg:col-span-5'}`}>
        {log.length === 0 ? (
          <Card><p className="text-sm text-slate-400">עוד אין רשומות ביומן. אחרי שיחה עם התלמיד — כתבו מה עלה, על מה הוסכם, ומתי המעקב הבא.</p></Card>
        ) : (
          log.map((e) => (
            <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <strong className="text-sm text-slate-800">{LOG_KIND_LABELS[e.kind]}</strong>
                <span className="text-xs text-slate-500">{fmtDate(e.happened_on)}</span>
                {e.participants && <span className="text-xs text-slate-400">· {e.participants}</span>}
                {canEditTracking && <button onClick={() => remove(e)} className="mr-auto text-xs text-slate-300 hover:text-rose-600">מחיקה</button>}
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

// ─────────────────────────────── הכנה לשיחה ───────────────────────────────

function PrepView() {
  return (
    <Card title="הכנה לשיחה">
      <p className="text-sm text-slate-600">
        כאן יהיה דף אחד להדפסה לפני שיחה עם התלמיד: המצב במשפט, על מה לבנות, הפעולות שבתוכנית עם הציון הנדרש,
        מה סוכם בפעם הקודמת, ושאלות מוצעות לשיחה — וסיכום השיחה יישמר ישר ליומן.
      </p>
      <p className="mt-2 text-sm text-slate-500">
        מבנה השיחה עצמו ממתין לתבנית מהשותפה של סבא (מומחית לשיחה הפדגוגית). עד אז — "מצב ותוכנית" ו"יומן מעקב" מכסים את רוב המידע.
      </p>
    </Card>
  )
}
