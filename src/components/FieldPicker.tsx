import { useMemo, useState } from 'react'
import { ALL_FIELDS, FIELD_ORDER, useFieldsVersion, type FieldGroup } from '@/config/fields'

interface Props {
  selected: string[]
  onToggle: (key: string) => void
  /** קביעת כל הבחירה בבת אחת — "בחר הכל" / "בטל הכל" */
  onSetSelected: (keys: string[]) => void
  /** חזרה לתמהיל ברירת המחדל של התצורה הנוכחית */
  onReset: () => void
  onClose: () => void
}

/** בורר שדות — הוספה/הסרה של שדות מתוך כל ~160 השדות (אפיון §6.1). */
export default function FieldPicker({
  selected,
  onToggle,
  onSetSelected,
  onReset,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const fieldsVersion = useFieldsVersion()
  const selectedSet = useMemo(() => new Set(selected), [selected])

  /** השדות שעוברים את החיפוש — לפי התווית בעברית או שם העמודה באנגלית */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ALL_FIELDS
    return ALL_FIELDS.filter(
      (f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q),
    )
    // ALL_FIELDS הוא binding חי שמשתנה ברישום עמודות תוספתיות;
    // ה-linter מניח שייצוא הוא קבוע ולכן חושב שהתלות מיותרת.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, fieldsVersion])

  const grouped = useMemo(() => {
    const map = new Map<FieldGroup, typeof ALL_FIELDS>()
    for (const f of visible) {
      const arr = map.get(f.group) ?? []
      arr.push(f)
      map.set(f.group, arr)
    }
    return map
  }, [visible])

  return (
    <div className="fixed inset-0 z-40 flex justify-start bg-black/30" onClick={onClose}>
      <div
        className="thin-scrollbar h-full w-80 overflow-y-auto bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">בורר שדות</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <input
          type="search"
          placeholder="חיפוש שדה…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        />

        {/*
          בחירה גורפת (הערה 8): "בחר הכל" נועד לייצא אקסל של כל מסד הנתונים,
          "בטל הכל" נועד לבנות תמהיל מאפס — במקום לנעוץ 160 צ'קבוקסים ידנית.
          כשיש חיפוש פעיל הפעולה חלה על התוצאות המוצגות בלבד.
        */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          <button
            onClick={() => {
              const keys = visible.map((f) => f.key)
              onSetSelected(
                query.trim() ? [...new Set([...selected, ...keys])] : keys,
              )
            }}
            className="rounded-md bg-sky-50 px-2 py-1 font-medium text-sky-700 transition hover:bg-sky-100"
          >
            בחר הכל{query.trim() ? ` (${visible.length})` : ''}
          </button>
          <button
            onClick={() => {
              if (!query.trim()) return onSetSelected([])
              const drop = new Set(visible.map((f) => f.key))
              onSetSelected(selected.filter((k) => !drop.has(k)))
            }}
            className="rounded-md bg-slate-100 px-2 py-1 text-slate-600 transition hover:bg-slate-200"
          >
            בטל הכל
          </button>
          <button
            onClick={onReset}
            title="חזרה לשדות ברירת המחדל של התצורה"
            className="rounded-md bg-slate-100 px-2 py-1 text-slate-600 transition hover:bg-slate-200"
          >
            ↺ ברירת מחדל
          </button>
          <span className="mr-auto text-slate-400">{selected.length} נבחרו</span>
        </div>

        {FIELD_ORDER.map((group) => {
          const fields = grouped.get(group)
          if (!fields || fields.length === 0) return null
          return (
            <div key={group} className="mb-4">
              <h3 className="mb-1 text-xs font-semibold uppercase text-slate-400">{group}</h3>
              <ul className="space-y-0.5">
                {fields.map((f) => (
                  <li key={f.key}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(f.key)}
                        onChange={() => onToggle(f.key)}
                        className="accent-brand-600"
                      />
                      <span className="text-slate-700">{f.label}</span>
                      {f.computed && (
                        <span className="text-[10px] text-amber-600">מחושב</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
