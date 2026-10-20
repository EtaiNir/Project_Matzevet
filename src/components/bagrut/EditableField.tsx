import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { canEditBagrutGrades, editBagrutField, editKey, fetchStudentRows, type EditRef } from '@/lib/bagrut'
import { fmtDate } from '@/lib/bagrutCycle'
import { useBagrut } from '@/pages/bagrut/context'

/**
 * ערך בנתוני הבגרות שאפשר לעדכן — ציון שאלון, משקל, יח"ל (מיגרציות 038, 041).
 *
 * העריכה היא **לכל הריבוע בבת אחת** (אייל, 18.10): עיפרון אחד בפינת הכרטיס
 * (`EditGroup`) מעביר את כל השדות שבו למצב עריכה, ושמירה אחת שומרת את מה
 * שהשתנה. המסד מחשב מחדש באותה טרנזקציה את המקצוע, את הזכאות ואת המצטיינת/טק
 * (041), והמסך טוען את התלמיד מחדש — כך גם תמונת המצב והרשימות מתעדכנות.
 * רק מנהל־על ורכז/ת בגרויות (אייל, 20.10); ההרשאה עצמה נאכפת במסד.
 *
 * שדה שנערך מסומן "נערך" — מי, מתי, ומה היה במקור. העדכון **נמחק בקליטת הסבב
 * הבא**, ונאמר כך בזמן העריכה. מחוץ ל-`EditGroup`, או עם `readOnly` (ערך
 * מחושב), השדה מציג רק את הערך ואת הסימון "נערך".
 */

interface Entry {
  ref: EditRef
  raw: string
  percent: boolean
  draft: string
}

interface EditGroupValue {
  editing: boolean
  draftOf: (key: string, raw: string) => string
  setDraft: (key: string, e: Entry) => void
  save: () => void
  cancel: () => void
}

const EditGroupContext = createContext<EditGroupValue | null>(null)

/** הערך שנשמר: משקל באחוזים → שבר. לא מספר — נשלח כמו שהוא, והמסד יחזיר "אינו מספר" */
const toStored = (e: Entry) =>
  e.percent && e.draft.trim() !== '' && !Number.isNaN(Number(e.draft)) ? String(Number(e.draft) / 100) : e.draft

/**
 * כרטיס שעורכים בבת אחת. `children` מקבל את העיפרון (לפינת הכרטיס) ואת שורת
 * השמירה (לתחתיתו), כדי שכל כרטיס יציב אותם במקום שלו.
 */
export function EditGroup({ allowed, children }: {
  /** מי שאינו רשאי לא רואה עיפרון; ההרשאה עצמה — במסד */
  allowed: boolean
  children: (parts: { toggle: ReactNode; actions: ReactNode }) => ReactNode
}) {
  const { round, applyDataEdit, applyStudentRows } = useBagrut()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [, force] = useState(0)
  const entries = useRef(new Map<string, Entry>())

  const cancel = () => {
    entries.current.clear()
    setErr(null)
    setEditing(false)
  }

  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      // שומרים אחד אחד — רק מה שהשתנה. שגיאה עוצרת, ומה שכבר נשמר נשאר שמור
      const touched = new Set<string>()
      try {
        for (const [key, e] of entries.current) {
          if (e.draft === e.raw) continue
          const r = await editBagrutField(round, e.ref, toStored(e))
          if (r.changed) {
            applyDataEdit(e.ref, r.value, r.edit)
            touched.add(e.ref.studentId)
          }
          entries.current.delete(key)
        }
      } finally {
        // מה שהמסד חישב מחדש — גם כשאחת השמירות נכשלה באמצע (מלכודת 26)
        for (const sid of touched) applyStudentRows(await fetchStudentRows(round, sid))
      }
      cancel()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const value: EditGroupValue = {
    editing,
    draftOf: (key, raw) => entries.current.get(key)?.draft ?? raw,
    setDraft: (key, e) => {
      entries.current.set(key, e)
      force((n) => n + 1)
    },
    save,
    cancel,
  }

  const toggle = allowed && !editing ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      title="עדכון ציונים — הזכאות תחושב מחדש"
      aria-label="עדכון הציונים בכרטיס"
      className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-500 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
    >
      ✎ עריכה
    </button>
  ) : null

  const actions = editing ? (
    <div className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={busy} onClick={save}
          className="rounded-md bg-sky-600 px-3 py-1 font-bold text-white hover:bg-sky-700 disabled:opacity-50">
          {busy ? 'שומר…' : 'שמירה'}
        </button>
        <button type="button" disabled={busy} onClick={cancel}
          className="rounded-md px-3 py-1 text-slate-500 hover:bg-slate-100">ביטול</button>
        <span className="text-amber-700">הזכאות, המקצוע והמצטיינת/טק יחושבו מחדש מיד · העדכון יימחק בקליטת הסבב הבא</span>
      </div>
      {err && <p className="text-xs text-rose-700">{err}</p>}
    </div>
  ) : null

  return <EditGroupContext.Provider value={value}>{children({ toggle, actions })}</EditGroupContext.Provider>
}

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
  /** סימון "נערך" בלבד, בלי עריכה — לטבלה צפופה, ולערך מחושב */
  readOnly?: boolean
  className?: string
}) {
  const { data } = useBagrut()
  const { profile } = useAuth()
  const group = useContext(EditGroupContext)

  const key = editKey(ref)
  const allowed = !readOnly && canEditBagrutGrades(profile)
  const edited = data.edits.get(key)
  const raw = value == null || value === '' ? '' : percent ? String(Math.round(Number(value) * 10000) / 100) : String(value)
  const pct = (v: string | null) => (v == null || v === '' ? 'ריק' : percent ? `${Math.round(Number(v) * 10000) / 100}%` : v)

  if (group?.editing && allowed) {
    const field = 'w-full rounded-md border border-sky-300 bg-white px-2 py-0.5 text-sm font-normal text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-400'
    const draft = group.draftOf(key, raw)
    const set = (v: string) => group.setDraft(key, { ref, raw, percent, draft: v })
    return (
      <span className={`inline-flex max-w-full flex-col gap-0.5 ${className}`} onClick={(e) => e.stopPropagation()}>
        {multiline ? (
          <textarea value={draft} onChange={(e) => set(e.target.value)} rows={3} className={field} />
        ) : (
          <input
            inputMode={numeric || percent ? 'decimal' : undefined}
            value={draft}
            onChange={(e) => set(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') group.save()
              if (e.key === 'Escape') group.cancel()
            }}
            className={`${field} ${numeric || percent ? 'w-[4.5rem] text-center tabular-nums' : ''}`}
          />
        )}
        {percent && <span className="text-[10px] text-slate-400">באחוזים</span>}
      </span>
    )
  }

  return (
    <span className={`inline-flex max-w-full items-start gap-1 ${className}`}>
      <span className="min-w-0">{children ?? (raw || <span className="text-slate-300">—</span>)}</span>
      {edited && (
        <span
          title={`נערך ידנית${edited.edited_by_email ? ` ע"י ${edited.edited_by_email}` : ''} ב-${fmtDate(edited.edited_at)} · במקור: ${pct(edited.old_value)} · יימחק בקליטת הסבב הבא`}
          className="shrink-0 cursor-help rounded bg-amber-100 px-1 text-[10px] font-bold leading-4 text-amber-800"
        >
          נערך
        </span>
      )}
    </span>
  )
}
