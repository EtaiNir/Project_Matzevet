import { useEffect, useMemo, useRef, useState } from 'react'
import { ALL_FIELDS, fieldLabel, useFieldsVersion } from '@/config/fields'

interface Props {
  value: string
  onChange: (key: string) => void
}

/**
 * בורר שדה משולב — הקלדה לחיפוש + רשימה נפתחת.
 * עם ~160 שדות, גלילה ברשימה רגילה איטית; ההקלדה מצמצמת מיידית.
 * החיפוש חל גם על התווית בעברית וגם על שם העמודה באנגלית.
 */
export default function FieldCombobox({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // הרשימה משתנה כשנטענות העמודות התוספתיות של הרשות
  const fieldsVersion = useFieldsVersion()

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ALL_FIELDS
    return ALL_FIELDS.filter(
      (f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q),
    )
    // ALL_FIELDS הוא binding חי שמשתנה ברישום עמודות תוספתיות
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, fieldsVersion])

  // סגירה בלחיצה מחוץ לרכיב
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // שמירת הפריט המסומן בתוך התצוגה בניווט במקלדת
  useEffect(() => {
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  function pick(key: string) {
    onChange(key)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(matches.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (matches[highlight]) pick(matches[highlight].key)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={open ? query : fieldLabel(value)}
        placeholder="חפש שדה…"
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setHighlight(0)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onKeyDown={onKeyDown}
        className="w-40 cursor-pointer truncate rounded-md bg-transparent px-1.5 py-0.5 text-right font-medium text-sky-700 hover:bg-sky-50 focus:cursor-text focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-400"
      />

      {open && (
        <ul
          ref={listRef}
          className="thin-scrollbar absolute right-0 z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-400">לא נמצא שדה מתאים</li>
          )}
          {matches.map((f, i) => (
            <li key={f.key}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(f.key)}
                className={
                  'flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-right text-sm ' +
                  (i === highlight ? 'bg-sky-50 ' : '') +
                  (f.key === value ? 'font-bold text-sky-700' : 'text-slate-700')
                }
              >
                <span className="truncate">{f.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400" dir="ltr">
                  {f.type === 'date' ? 'תאריך' : f.type === 'number' ? 'מספר' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
