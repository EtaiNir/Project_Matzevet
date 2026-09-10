import { useMemo } from 'react'
import {
  ALL_FIELDS,
  FIELD_ORDER,
  PARENT_ID_FIELDS,
  useFieldsVersion,
  type FieldGroup,
} from '@/config/fields'
import { isChecked } from '@/lib/filters'

type Row = Record<string, unknown>

interface Props {
  rows: Row[]
  index: number
  onNavigate: (index: number) => void
  onClose: () => void
  /** זיהוי אחים — לחיצה על ת.ז. הורה (אפיון §5, תצורה 2) */
  onFindSiblings: (parentId: string) => void
}

/**
 * כרטיס תלמיד מפורט (אפיון §6.4). פונט גדול, שדות בקבוצות לוגיות,
 * ניווט הבא/הקודם בתוך תוצאות הסינון הנוכחיות, וזיהוי אחים.
 */
export default function StudentCard({
  rows,
  index,
  onNavigate,
  onClose,
  onFindSiblings,
}: Props) {
  const student = rows[index]
  const fieldsVersion = useFieldsVersion()

  // כל השדות עם ערך, מקובצים לפי קבוצה לוגית
  const groups = useMemo(() => {
    const map = new Map<FieldGroup, { label: string; key: string; value: string }[]>()
    for (const f of ALL_FIELDS) {
      const value = student[f.key]
      if (value === null || value === undefined || String(value).trim() === '') continue
      // תיבת סימון: "מסומן" ולא "true". תא שאינו מסומן פשוט אינו מוצג,
      // כמו כל שדה ריק אחר בכרטיס.
      if (f.type === 'boolean' && !isChecked(value)) continue
      const shown = f.type === 'boolean' ? '✓ מסומן' : String(value)
      const arr = map.get(f.group) ?? []
      arr.push({ label: f.label, key: f.key, value: shown })
      map.set(f.group, arr)
    }
    return map
    // ALL_FIELDS הוא binding חי שמשתנה ברישום עמודות תוספתיות;
    // ה-linter מניח שייצוא הוא קבוע ולכן חושב שהתלות מיותרת.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, fieldsVersion])

  const fullName = `${student['SHEM_PRATI'] ?? ''} ${student['SHEM_MISHPACHA'] ?? ''}`.trim()

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="thin-scrollbar flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* כותרת + ניווט */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{fullName || 'תלמיד'}</h2>
            <p className="text-sm text-slate-500">
              ת.ז. {String(student['MISPAR_ZEHUT'] ?? '')} · תלמיד {index + 1} מתוך {rows.length}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate(index - 1)}
              disabled={index === 0}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
            >
              → הקודם
            </button>
            <button
              onClick={() => onNavigate(index + 1)}
              disabled={index >= rows.length - 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
            >
              הבא ←
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-2 py-1.5 text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
        </div>

        {/* גוף — קבוצות שדות */}
        <div className="thin-scrollbar grid gap-6 overflow-y-auto p-6 md:grid-cols-2">
          {FIELD_ORDER.map((group) => {
            const items = groups.get(group)
            if (!items || items.length === 0) return null
            return (
              <section key={group} className="rounded-xl border border-slate-200 p-4">
                <h3 className="mb-3 border-b border-slate-100 pb-1 text-base font-bold text-brand-700">
                  {group}
                </h3>
                <dl className="space-y-2">
                  {items.map((item) => {
                    const isParentId = PARENT_ID_FIELDS.includes(
                      item.key as (typeof PARENT_ID_FIELDS)[number],
                    )
                    return (
                      <div key={item.key} className="flex justify-between gap-3 text-base">
                        <dt className="text-slate-500">{item.label}</dt>
                        {isParentId ? (
                          <dd>
                            <button
                              onClick={() => onFindSiblings(item.value)}
                              className="font-medium text-brand-600 underline hover:text-brand-800"
                              title="הצג את כל ילדי ההורה"
                            >
                              {item.value} · אחים
                            </button>
                          </dd>
                        ) : (
                          <dd className="font-medium text-slate-800">{item.value}</dd>
                        )}
                      </div>
                    )
                  })}
                </dl>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
