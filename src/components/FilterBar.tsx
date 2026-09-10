import { useState } from 'react'
import { ALL_FIELDS, fieldLabel, getField } from '@/config/fields'
import FieldCombobox from './FieldCombobox'
import ColumnFilterMenu from './ColumnFilterMenu'
import type { ColumnValue } from '@/lib/columnValues'
import {
  operatorsForType,
  type FilterCondition,
  type FilterOperator,
} from '@/lib/filters'

interface Props {
  conditions: FilterCondition[]
  onChange: (conditions: FilterCondition[]) => void
  /** הערכים הזמינים לשדה — לבחירה מרובה בצ'קבוקסים */
  valuesFor: (field: string) => ColumnValue[]
  /**
   * החזרת המסך למצב הפתיחה של התצורה — סינון, מיון וזיהוי אחים.
   *
   * סבא (19.8): "אם אני רוצה לבטל את כל הסינונים במכה אחת... פונקציה
   * מאוד חשובה, שבלחיצה אחת אני חוזר לנקודת האפס."
   */
  onReset: () => void
  /** מוטמע בתוך שורת הפעולות — בלי מסגרת, רקע וריפוד משלו */
  compact?: boolean
}

function newId() {
  return Math.random().toString(36).slice(2, 9)
}

/** האם האופרטור לא דורש ערך */
function isValueless(op: FilterOperator) {
  return (
    op === 'empty' || op === 'not_empty' ||
    op === 'is_checked' || op === 'not_checked'
  )
}

/** סרגל סינון — אפיון §6.3. שילוב מספר סינונים ב-AND. */
export default function FilterBar({
  conditions,
  onChange,
  valuesFor,
  onReset,
  compact = false,
}: Props) {
  // איזה תנאי "אחד מתוך" פתוח כרגע לבחירה, ומאיפה נפתח התפריט
  const [picking, setPicking] = useState<{ id: string; anchor: DOMRect } | null>(null)

  function update(id: string, patch: Partial<FilterCondition>) {
    onChange(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function remove(id: string) {
    onChange(conditions.filter((c) => c.id !== id))
  }

  /**
   * החלפת השדה בתנאי קיים.
   *
   * אם האופרטור הנוכחי אינו תקף לסוג השדה החדש — הוא מוחלף בפועל, ולא
   * רק בתצוגה. בלי זה נוצר מצב שקט ומסוכן: הבורר מציג "מסומן" בעוד
   * התנאי עדיין מחזיק `contains` עם ערך ריק, ולכן הוא נשמט מהסינון
   * ב-isConditionReady — הסינון נראה מופעל על המסך ואינו עושה דבר.
   */
  function changeField(cond: FilterCondition, key: string) {
    const ops = operatorsForType(getField(key)?.type ?? 'text')
    if (ops.some((o) => o.op === cond.operator)) {
      update(cond.id, { field: key })
      return
    }
    update(cond.id, {
      field: key,
      operator: ops[0].op,
      value: '',
      value2: undefined,
      values: undefined,
    })
  }

  function add() {
    const first = ALL_FIELDS[0]
    onChange([
      ...conditions,
      { id: newId(), field: first.key, operator: 'contains', value: '' },
    ])
  }

  return (
    <div
      className={
        'flex flex-wrap items-center gap-2 ' +
        (compact
          ? ''
          : 'border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-4 py-2.5')
      }
    >
      {conditions.map((c) => {
        const field = getField(c.field)
        const ops = operatorsForType(field?.type ?? 'text')
        // אם האופרטור הנוכחי לא תקף לסוג השדה, נופלים לראשון הזמין
        const op = ops.some((o) => o.op === c.operator) ? c.operator : ops[0].op
        return (
          <div
            key={c.id}
            className="flex items-center gap-1 rounded-xl border border-sky-200 bg-white px-2 py-1.5 text-sm shadow-sm ring-1 ring-sky-50 transition hover:border-sky-300 hover:shadow"
          >
            <FieldCombobox
              value={c.field}
              onChange={(key) => changeField(c, key)}
            />

            <select
              value={op}
              onChange={(e) =>
                update(c.id, { operator: e.target.value as FilterOperator })
              }
              className="cursor-pointer rounded-md bg-slate-100 px-1 py-0.5 text-slate-700 transition hover:bg-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
            >
              {ops.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>

            {!isValueless(op) && op !== 'between' && op !== 'one_of' && (
              <input
                type={field?.type === 'date' ? 'date' : 'text'}
                value={c.value ?? ''}
                onChange={(e) => update(c.id, { value: e.target.value })}
                placeholder="ערך"
                className="w-24 rounded-md border border-slate-200 px-2 py-0.5 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300"
              />
            )}

            {op === 'between' && (
              <>
                <input
                  type={field?.type === 'date' ? 'date' : 'text'}
                  value={c.value ?? ''}
                  onChange={(e) => update(c.id, { value: e.target.value })}
                  placeholder="מ"
                  className="w-20 rounded-md border border-slate-200 px-2 py-0.5 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300"
                />
                <span className="text-slate-400">–</span>
                <input
                  type={field?.type === 'date' ? 'date' : 'text'}
                  value={c.value2 ?? ''}
                  onChange={(e) => update(c.id, { value2: e.target.value })}
                  placeholder="עד"
                  className="w-20 rounded-md border border-slate-200 px-2 py-0.5 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300"
                />
              </>
            )}

            {/* בחירה מרובה — צ'קבוקסים במקום הקלדת ערכים מופרדים בפסיק.
                עם 269 יישובים ברשות אחת, הקלדה אינה אפשרות מעשית. */}
            {op === 'one_of' && (
              <button
                onClick={(e) =>
                  setPicking({ id: c.id, anchor: e.currentTarget.getBoundingClientRect() })
                }
                className="min-w-[9rem] max-w-[16rem] truncate rounded-md border border-slate-200 px-2 py-0.5 text-right transition hover:border-sky-400 hover:bg-sky-50"
                title="בחירת ערכים מרשימה"
              >
                {(c.values?.length ?? 0) === 0
                  ? 'בחר ערכים…'
                  : c.values!.length <= 2
                    ? c.values!.map((v) => v || '(ריק)').join(', ')
                    : `${c.values!.length} ערכים נבחרו`}
              </button>
            )}

            <button
              onClick={() => remove(c.id)}
              className="rounded px-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              title="הסר סינון"
            >
              ✕
            </button>
          </div>
        )
      })}

      <button
        onClick={add}
        className="rounded-lg border border-dashed border-sky-400 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:border-sky-500 hover:bg-sky-50"
      >
        + הוסף סינון
      </button>

      {/*
        מחזיר את המסך לנקודת האפס: הסינון של התצורה, בלי מיון ובלי
        זיהוי אחים. תנאי בודד עדיין ניתן להסרה ב-✕ שלו.
      */}
      <button
        onClick={onReset}
        title="חזרה לסינון ולמיון של ברירת המחדל"
        className="rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:bg-sky-50 hover:text-sky-700"
      >
        ↺ איפוס הכל
      </button>

      {picking &&
        (() => {
          const cond = conditions.find((c) => c.id === picking.id)
          if (!cond) return null
          return (
            <ColumnFilterMenu
              title={fieldLabel(cond.field)}
              values={valuesFor(cond.field)}
              // ריק = טרם נבחר דבר; בחירת הכל שקולה לביטול הסינון
              selected={cond.values ?? []}
              onChange={(next) => update(cond.id, { values: next ?? [] })}
              anchor={picking.anchor}
              onClose={() => setPicking(null)}
            />
          )
        })()}
    </div>
  )
}
