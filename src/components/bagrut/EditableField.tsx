import { useState, type ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { canEditBagrutData, editBagrutField, editKey, type EditRef } from '@/lib/bagrut'
import { fmtDate } from '@/lib/bagrutCycle'
import { useBagrut } from '@/pages/bagrut/context'

/**
 * ערך בנתוני הבגרות שאפשר לתקן ידנית (משימה 7, מיגרציה 037).
 *
 * מי שרשאי (רכז בגרויות, רכז שכבה, רכז מקצוע במקצועות שלו, מנהל־על) רואה
 * עיפרון בריחוף. שדה שנערך מסומן "נערך" — מי, מתי, ומה היה במקור. התיקון
 * **נמחק בקליטת הסבב הבא**, ונאמר כך בזמן העריכה. ההרשאה עצמה נאכפת במסד.
 */
export default function EditableField({
  edit: ref,
  value,
  children,
  multiline = false,
  numeric = false,
  percent = false,
  readOnly = false,
  className = '',
}: {
  edit: EditRef
  /** הערך הגולמי לעריכה (מה שנשמר) */
  value: string | number | null | undefined
  /** איך הערך מוצג כשלא עורכים. ברירת מחדל: הערך עצמו */
  children?: ReactNode
  multiline?: boolean
  numeric?: boolean
  /** נשמר כשבר (0.27) ונערך באחוזים (27) — משקלים */
  percent?: boolean
  /** סימון "נערך" בלבד, בלי עריכה — לטבלה צפופה */
  readOnly?: boolean
  className?: string
}) {
  const { round, data, applyDataEdit } = useBagrut()
  const { profile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const allowed = !readOnly && canEditBagrutData(profile, ref.target === 'student' ? null : ref.subjectKey ?? null)
  const edited = data.edits.get(editKey(ref))
  const raw = value == null || value === '' ? '' : percent ? String(Math.round(Number(value) * 10000) / 100) : String(value)
  const pct = (v: string | null) => (v == null || v === '' ? 'ריק' : percent ? `${Math.round(Number(v) * 10000) / 100}%` : v)

  const start = () => {
    setDraft(raw)
    setErr(null)
    setEditing(true)
  }
  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      // משקל באחוזים → שבר. לא מספר — נשלח כמו שהוא, והמסד יחזיר "אינו מספר"
      const out = percent && draft.trim() !== '' && !Number.isNaN(Number(draft)) ? String(Number(draft) / 100) : draft
      const r = await editBagrutField(round, ref, out)
      if (r.changed) applyDataEdit(ref, r.value, r.edit)
      setEditing(false)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    const field = 'w-full rounded-md border border-sky-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400'
    return (
      <div className={`flex flex-col gap-1 ${className}`} onClick={(e) => e.stopPropagation()}>
        {multiline ? (
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} className={field} />
        ) : (
          <input
            autoFocus
            inputMode={numeric || percent ? 'decimal' : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
            className={`${field} ${numeric || percent ? 'max-w-[7rem] tabular-nums' : ''}`}
          />
        )}
        {percent && <span className="text-[11px] text-slate-500">באחוזים (למשל 27)</span>}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <button disabled={busy} onClick={save} className="rounded-md bg-sky-600 px-2 py-0.5 font-bold text-white hover:bg-sky-700 disabled:opacity-50">
            {busy ? 'שומר…' : 'שמירה'}
          </button>
          <button disabled={busy} onClick={() => setEditing(false)} className="rounded-md px-2 py-0.5 text-slate-500 hover:bg-slate-100">ביטול</button>
          <span className="text-amber-700">תיקון ידני — יימחק בקליטת הסבב הבא</span>
        </div>
        {err && <p className="text-xs text-rose-700">{err}</p>}
      </div>
    )
  }

  return (
    <span className={`group/edit inline-flex max-w-full items-start gap-1 ${className}`}>
      <span className="min-w-0">{children ?? (raw || <span className="text-slate-300">—</span>)}</span>
      {edited && (
        <span
          title={`נערך ידנית${edited.edited_by_email ? ` ע"י ${edited.edited_by_email}` : ''} ב-${fmtDate(edited.edited_at)} · במקור: ${pct(edited.old_value)} · יימחק בקליטת הסבב הבא`}
          className="shrink-0 cursor-help rounded bg-amber-100 px-1 text-[10px] font-bold leading-4 text-amber-800"
        >
          נערך
        </span>
      )}
      {allowed && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            start()
          }}
          title="תיקון ידני של הערך"
          aria-label="עריכה"
          className="shrink-0 rounded px-0.5 text-xs text-slate-300 opacity-0 transition hover:text-sky-700 focus:opacity-100 group-hover/edit:opacity-100"
        >
          ✎
        </button>
      )}
    </span>
  )
}
