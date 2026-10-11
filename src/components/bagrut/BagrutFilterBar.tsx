import { useState } from 'react'
import ColumnFilterMenu from '@/components/ColumnFilterMenu'
import type { ColumnValue } from '@/lib/columnValues'
import { operatorsForType, type FilterCondition, type FilterOperator } from '@/lib/filters'

/** עמודה שאפשר לסנן לפיה — נגזרת מעמודות הטבלה, לא מרישום השדות של המצבת */
export interface FilterField {
  key: string
  label: string
  type: 'text' | 'number'
}

interface Props {
  fields: FilterField[]
  conditions: FilterCondition[]
  onChange: (conditions: FilterCondition[]) => void
  /** הערכים הזמינים לתנאי "אחד מתוך" — לבחירה מרובה בצ'קבוקסים */
  valuesFor: (cond: FilterCondition) => ColumnValue[]
}

function newId() {
  return Math.random().toString(36).slice(2, 9)
}

function isValueless(op: FilterOperator) {
  return op === 'empty' || op === 'not_empty'
}

/**
 * "+ הוסף סינון" של המצבת (FilterBar), מותאם לטבלאות הבגרות: אותם
 * אופרטורים ואותה שפה חזותית, אבל השדות הם עמודות הטבלה שעל המסך —
 * FilterBar עצמו קשור לרישום השדות הגלובלי (config/fields.ts), ועמודות
 * הבגרות אינן שם בכוונה (ראה BagrutTable). שילוב תנאים ב-AND.
 */
export default function BagrutFilterBar({ fields, conditions, onChange, valuesFor }: Props) {
  const [picking, setPicking] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const typeOf = (key: string) => fields.find((f) => f.key === key)?.type ?? 'text'

  const update = (id: string, patch: Partial<FilterCondition>) =>
    onChange(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  // אופרטור שאינו תקף לסוג העמודה החדשה מוחלף בפועל, לא רק בתצוגה —
  // אחרת התנאי נראה מופעל ואינו עושה דבר (אותה מלכודת כמו ב-FilterBar)
  const changeField = (cond: FilterCondition, key: string) => {
    const ops = operatorsForType(typeOf(key))
    if (ops.some((o) => o.op === cond.operator)) update(cond.id, { field: key, values: undefined })
    else update(cond.id, { field: key, operator: ops[0].op, value: '', value2: undefined, values: undefined })
  }

  const add = () => {
    const first = fields[0]
    if (!first) return
    onChange([...conditions, { id: newId(), field: first.key, operator: operatorsForType(first.type)[0].op, value: '' }])
  }

  const input = 'rounded-md border border-slate-200 px-2 py-0.5 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300'

  return (
    <>
      {conditions.map((c) => {
        const ops = operatorsForType(typeOf(c.field))
        const op = ops.some((o) => o.op === c.operator) ? c.operator : ops[0].op
        return (
          <div key={c.id} className="flex items-center gap-1 rounded-xl border border-sky-200 bg-white px-2 py-1 text-sm shadow-sm ring-1 ring-sky-50">
            <select
              value={c.field}
              onChange={(e) => changeField(c, e.target.value)}
              className="max-w-[11rem] cursor-pointer truncate rounded-md bg-transparent px-1 py-0.5 font-medium text-sky-700 hover:bg-sky-50 focus:outline-none focus:ring-1 focus:ring-sky-400"
            >
              {fields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>

            <select
              value={op}
              onChange={(e) => update(c.id, { operator: e.target.value as FilterOperator })}
              className="cursor-pointer rounded-md bg-slate-100 px-1 py-0.5 text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
            >
              {ops.map((o) => (
                <option key={o.op} value={o.op}>{o.label}</option>
              ))}
            </select>

            {!isValueless(op) && op !== 'between' && op !== 'one_of' && (
              <input value={c.value ?? ''} onChange={(e) => update(c.id, { value: e.target.value })} placeholder="ערך" className={`w-24 ${input}`} />
            )}

            {op === 'between' && (
              <>
                <input value={c.value ?? ''} onChange={(e) => update(c.id, { value: e.target.value })} placeholder="מ" className={`w-16 ${input}`} />
                <span className="text-slate-400">–</span>
                <input value={c.value2 ?? ''} onChange={(e) => update(c.id, { value2: e.target.value })} placeholder="עד" className={`w-16 ${input}`} />
              </>
            )}

            {op === 'one_of' && (
              <button
                onClick={(e) => setPicking({ id: c.id, anchor: e.currentTarget.getBoundingClientRect() })}
                className="min-w-[8rem] max-w-[14rem] truncate rounded-md border border-slate-200 px-2 py-0.5 text-right hover:border-sky-400 hover:bg-sky-50"
                title="בחירת ערכים מרשימה"
              >
                {(c.values?.length ?? 0) === 0
                  ? 'בחר ערכים…'
                  : c.values!.length <= 2
                    ? c.values!.map((v) => v || '(ריק)').join(', ')
                    : `${c.values!.length} ערכים נבחרו`}
              </button>
            )}

            <button onClick={() => onChange(conditions.filter((x) => x.id !== c.id))} className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="הסר סינון">
              ✕
            </button>
          </div>
        )
      })}

      {fields.length > 0 && (
        <button onClick={add} className="rounded-lg border border-dashed border-sky-400 px-3 py-1 text-xs font-medium text-sky-700 hover:border-sky-500 hover:bg-sky-50">
          + הוסף סינון
        </button>
      )}

      {picking && (() => {
        const cond = conditions.find((c) => c.id === picking.id)
        if (!cond) return null
        return (
          <ColumnFilterMenu
            title={fields.find((f) => f.key === cond.field)?.label ?? cond.field}
            values={valuesFor(cond)}
            // ריק = טרם נבחר דבר; בחירת הכל שקולה לביטול הסינון
            selected={cond.values ?? []}
            onChange={(next) => update(cond.id, { values: next ?? [] })}
            anchor={picking.anchor}
            onClose={() => setPicking(null)}
          />
        )
      })()}
    </>
  )
}
