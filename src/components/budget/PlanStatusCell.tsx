import { useState } from 'react'
import { decidePlan, PLAN_STATUS_META, submitPlan, type PlanReview, type PlanStatus } from '@/lib/budgetTracking'

/**
 * מצב אישור התכנית לשנה הבאה של כרטיס (024): בעבודה → הוגש → אושר / הוחזר.
 * אחראי (או מנהל) מגיש; רק מנהל מאשר או מחזיר — ובהחזרה חובה לכתוב למה. עריכה
 * של התכנית אחרי אישור מחזירה אותה לעבודה (במסד). ההרשאה נאכפת במסד; כאן רק
 * מה שמוצג.
 */
export default function PlanStatusCell({ code, card, year, review, canSubmit, canDecide, onSaved }: {
  code: string
  card: string
  year: number
  review: PlanReview | undefined
  canSubmit: boolean
  canDecide: boolean
  onSaved: (r: PlanReview) => void
}) {
  const status: PlanStatus = review?.status ?? 'draft'
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const meta = PLAN_STATUS_META[status]
  const who = review?.decided_at ? review.decided_email ?? 'מנהל על' : review?.submitted_email ?? (review?.submitted_at ? 'מנהל על' : null)
  const title = [meta.label, who && `· ${who}`, review?.comment && `· ${review.comment}`].filter(Boolean).join(' ')

  const run = async (fn: () => Promise<PlanReview>) => {
    setBusy(true)
    setErr(null)
    try {
      onSaved(await fn())
      setOpen(false)
      setComment('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const can = canDecide || (canSubmit && status !== 'approved' && status !== 'submitted')

  return (
    <span className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={!can} onClick={() => setOpen((v) => !v)} title={title}
        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${meta.tone} ${can ? 'hover:ring-1 hover:ring-slate-300' : 'cursor-default'}`}>
        {meta.label}{review?.comment ? ' 💬' : ''}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 flex w-64 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg" dir="rtl">
          {review?.comment && <p className="rounded bg-slate-50 px-2 py-1 text-slate-600">{review.comment}</p>}
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="הערה (בהחזרה — חובה)"
            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none" />
          <div className="flex flex-wrap gap-1.5">
            {canSubmit && status !== 'submitted' && status !== 'approved' && (
              <button disabled={busy} onClick={() => run(() => submitPlan(code, card, year, comment))}
                className="rounded-md bg-sky-600 px-2.5 py-1 font-bold text-white hover:bg-sky-700 disabled:opacity-50">הגשה לאישור</button>
            )}
            {canDecide && status !== 'approved' && (
              <button disabled={busy} onClick={() => run(() => decidePlan(code, card, year, true, comment))}
                className="rounded-md bg-emerald-600 px-2.5 py-1 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">אישור</button>
            )}
            {canDecide && (
              <button disabled={busy || !comment.trim()} onClick={() => run(() => decidePlan(code, card, year, false, comment))}
                className="rounded-md bg-amber-500 px-2.5 py-1 font-bold text-white hover:bg-amber-600 disabled:opacity-50">החזרה</button>
            )}
            <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">סגירה</button>
          </div>
          {err && <p className="text-rose-700">{err}</p>}
        </div>
      )}
    </span>
  )
}
