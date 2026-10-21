import { useState } from 'react'
import { analysisKind, eligibilityKind, ELIGIBILITY_META, overrideByText, setStudentStatus, type BagrutStudent, type StatusOverride } from '@/lib/bagrut'
import { fmtDate } from '@/lib/bagrutCycle'
import { useBagrut } from '@/pages/bagrut/context'
import { StatusBadge } from './ui'

type Choice = StatusOverride['kind']
const CHOICES: Choice[] = ['eligible', 'not_eligible']

/**
 * שינוי ידני של סטטוס הזכאות (מיגרציה 043, decisions/022). מנהל־על ורכז/ת
 * בגרויות משנים זכאי ↔ אין זכאות, עם סיבה; ניתוח הזכאות עצמו אינו משתנה, ואפשר
 * לחזור אליו בלחיצה. כל מה שנגזר מהסטטוס — אחוזי השכבה ובית הספר, מצטיינת וטק,
 * "על הסף", הסרגל והייצוא — נספר מחדש מעצמו, כי כולם קוראים ל-eligibilityKind.
 * השינוי נמחק בקליטת הסבב הבא, ונאמר כך בטופס.
 *
 * מי שאינו רשאי רואה רק את ההסבר — כשיש שינוי בתוקף.
 */
export default function StatusOverrideCard({ s }: { s: BagrutStudent }) {
  const { round, applyStatusOverride, canOverrideStatus } = useBagrut()
  const [open, setOpen] = useState(false)
  const current = eligibilityKind(s)
  const fromAnalysis = analysisKind(s)
  const [choice, setChoice] = useState<Choice>(current === 'not_eligible' ? 'eligible' : 'not_eligible')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const o = s.override

  if (!s.in_t2 || (!o && !canOverrideStatus)) return null

  const save = async (kind: Choice | null) => {
    setBusy(true)
    setErr(null)
    try {
      const r = await setStudentStatus(round, s.student_id, kind, kind ? reason : '')
      if (r.changed) applyStatusOverride(s.student_id, r.override)
      setOpen(false)
      setReason('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`rounded-2xl border p-4 lg:col-span-5 ${o ? 'border-violet-200 bg-violet-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-bold text-slate-700">סטטוס הזכאות</span>
        <StatusBadge kind={current} long manual={Boolean(o)} />
        {o ? (
          <span className="text-xs text-violet-900">
            {overrideByText(o)} ב-{fmtDate(o.set_at)} · בניתוח הזכאות: <b>{ELIGIBILITY_META[fromAnalysis].label}</b>
          </span>
        ) : (
          <span className="text-xs text-slate-400">לפי ניתוח הזכאות</span>
        )}
        <span className="mr-auto" />
        {canOverrideStatus && !open && (
          <>
            {o && (
              <button disabled={busy} onClick={() => save(null)}
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-white disabled:opacity-50">
                {busy ? 'שומר…' : 'חזרה לניתוח הזכאות'}
              </button>
            )}
            <button onClick={() => { setChoice(current === 'not_eligible' ? 'eligible' : 'not_eligible'); setOpen(true) }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-violet-300 hover:text-violet-800">
              ✎ שינוי סטטוס
            </button>
          </>
        )}
      </div>
      {o && <p className="mt-1.5 text-sm text-slate-700"><span className="text-xs font-bold text-slate-500">סיבה: </span>{o.reason}</p>}

      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">הסטטוס החדש:</span>
            <div className="flex gap-0.5 rounded-xl bg-slate-100 p-1">
              {CHOICES.map((k) => (
                <button key={k} onClick={() => setChoice(k)}
                  className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${choice === k ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-500 hover:text-violet-700'}`}>
                  {ELIGIBILITY_META[k].label}
                </button>
              ))}
            </div>
          </div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="סיבה (חובה) — למשל: פטור שאושר במשרד, ציון שתוקן ועוד לא הגיע בקבצים"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button disabled={busy || !reason.trim()} onClick={() => save(choice)}
              className="rounded-md bg-violet-600 px-3 py-1 font-bold text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? 'שומר…' : 'שמירה'}
            </button>
            <button disabled={busy} onClick={() => { setOpen(false); setErr(null) }}
              className="rounded-md px-3 py-1 text-slate-500 hover:bg-slate-100">ביטול</button>
            <span className="text-violet-800">
              אחוזי הזכאות, המצטיינת והטק יחושבו מחדש מיד · ניתוח הזכאות עצמו לא ישתנה · השינוי יימחק בקליטת הסבב הבא
            </span>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
    </div>
  )
}
