import { useState, type KeyboardEvent } from 'react'
import { money } from '@/lib/budgetCalc'
import { parseAmount } from '@/lib/budget'

/**
 * תאי עריכה בתוך שורה בטבלה. נשמרים ביציאה מהתא (או Enter), רק אם הערך
 * השתנה; Escape מחזיר. הלחיצה לא מגיעה לשורה — אחרת היא הייתה פותחת את
 * הכרטיס באמצע ההקלדה.
 */

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

function keys(e: KeyboardEvent<HTMLInputElement>, reset: () => void) {
  if (e.key === 'Enter') e.currentTarget.blur()
  if (e.key === 'Escape') {
    reset()
    e.currentTarget.blur()
  }
}

export function AmountCell({ value, placeholder, disabled, onSave }: {
  value: number | null
  /** מה שמוצג כשריק — למשל הצעת הצפי לפי הקצב */
  placeholder?: number | null
  disabled?: boolean
  onSave: (v: number | null) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(0)   // מאפס את השדה אחרי Escape / כישלון
  if (disabled) return <span className="tabular-nums text-slate-700">{money(value)}</span>
  return (
    <input
      key={key}
      dir="ltr"
      inputMode="decimal"
      defaultValue={value == null ? '' : String(Math.round(value))}
      placeholder={placeholder == null ? '' : money(placeholder)}
      title={placeholder != null && value == null ? 'ריק — מוצג הצפי לפי הקצב (לא נשמר)' : undefined}
      disabled={busy}
      onClick={stop}
      onKeyDown={(e) => keys(e, () => setKey((k) => k + 1))}
      onBlur={async (e) => {
        const next = parseAmount(e.currentTarget.value)
        if (next === value || (next == null && value == null)) return
        setBusy(true)
        try {
          await onSave(next)
        } catch {
          setKey((k) => k + 1)
        } finally {
          setBusy(false)
        }
      }}
      className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-left tabular-nums placeholder:italic placeholder:text-slate-300 hover:border-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none disabled:opacity-50"
    />
  )
}

export function TextCell({ value, options, disabled, onSave, listId }: {
  value: string | null
  /** הצעות להשלמה — ערכים שכבר בשימוש */
  options?: string[]
  disabled?: boolean
  onSave: (v: string | null) => Promise<void>
  listId: string
}) {
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(0)
  if (disabled) return <span className="truncate text-slate-700">{value ?? ''}</span>
  return (
    <>
      <input
        key={key}
        list={listId}
        defaultValue={value ?? ''}
        disabled={busy}
        onClick={stop}
        onKeyDown={(e) => keys(e, () => setKey((k) => k + 1))}
        onBlur={async (e) => {
          const next = e.currentTarget.value.trim() || null
          if (next === (value ?? null)) return
          setBusy(true)
          try {
            await onSave(next)
          } catch {
            setKey((k) => k + 1)
          } finally {
            setBusy(false)
          }
        }}
        className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 hover:border-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none disabled:opacity-50"
      />
      {options && (
        <datalist id={listId}>
          {options.map((o) => <option key={o} value={o} />)}
        </datalist>
      )}
    </>
  )
}
