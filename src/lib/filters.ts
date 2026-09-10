// מנוע הסינון — אפיון §6.3. כל אופרטור, שילוב מספר סינונים ב-AND.
// "מכיל" (contains/substring) הוא הכלי הכי חשוב.

import type { FieldType } from '@/config/fields'
import { getField } from '@/config/fields'

export type FilterOperator =
  | 'equals' // שווה
  | 'not_equals' // שונה
  | 'contains' // מכיל ⭐
  | 'not_contains' // אינו מכיל
  | 'starts_with' // מתחיל ב
  | 'ends_with' // מסתיים ב
  | 'gt' // גדול מ
  | 'lt' // קטן מ
  | 'between' // בין...ל
  | 'empty' // ריק
  | 'not_empty' // לא ריק
  | 'one_of' // אחד מתוך רשימה
  | 'is_checked' // מסומן        (תיבת סימון בלבד)
  | 'not_checked' // אינו מסומן  (תיבת סימון בלבד)

export interface FilterCondition {
  id: string
  field: string
  operator: FilterOperator
  /** ערך יחיד (לרוב האופרטורים) */
  value?: string
  /** ערך שני (עבור between) */
  value2?: string
  /** ערכים מרובים (עבור one_of) */
  values?: string[]
}

export interface OperatorDef {
  op: FilterOperator
  label: string
  /** לאילו סוגי שדות האופרטור רלוונטי */
  types: FieldType[]
}

// סדר התצוגה בבורר האופרטורים
export const OPERATORS: OperatorDef[] = [
  // תיבת סימון בראש: הם היחידים שתקפים לה, ולכן גם ברירת המחדל שלה
  { op: 'is_checked', label: 'מסומן', types: ['boolean'] },
  { op: 'not_checked', label: 'אינו מסומן', types: ['boolean'] },
  { op: 'contains', label: 'מכיל', types: ['text'] },
  { op: 'not_contains', label: 'אינו מכיל', types: ['text'] },
  { op: 'equals', label: 'שווה', types: ['text', 'number', 'date'] },
  { op: 'not_equals', label: 'שונה', types: ['text', 'number', 'date'] },
  { op: 'starts_with', label: 'מתחיל ב', types: ['text'] },
  { op: 'ends_with', label: 'מסתיים ב', types: ['text'] },
  { op: 'gt', label: 'גדול מ', types: ['number', 'date'] },
  { op: 'lt', label: 'קטן מ', types: ['number', 'date'] },
  { op: 'between', label: 'בין...ל', types: ['number', 'date'] },
  { op: 'one_of', label: 'אחד מתוך', types: ['text', 'number', 'date', 'boolean'] },
  { op: 'empty', label: 'ריק', types: ['text', 'number', 'date'] },
  { op: 'not_empty', label: 'לא ריק', types: ['text', 'number', 'date'] },
]

/**
 * האם ערך של תיבת סימון נחשב מסומן.
 *
 * הערך מגיע מ-jsonb ולכן הוא בוליאני אמיתי, אבל תא שמעולם לא נגעו בו
 * פשוט אינו קיים במפתח — ומגיע כ-undefined. שניהם "אינו מסומן".
 */
export function isChecked(value: unknown): boolean {
  return value === true || value === 'true'
}

export function operatorsForType(type: FieldType): OperatorDef[] {
  return OPERATORS.filter((o) => o.types.includes(type))
}

export function operatorLabel(op: FilterOperator): string {
  return OPERATORS.find((o) => o.op === op)?.label ?? op
}

type Row = Record<string, unknown>

function asString(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === ''
}

/** השוואה מספרית או תאריכית; נופל להשוואת מחרוזות אם לא ניתן להמיר. */
function compare(a: unknown, b: string, type: FieldType): number {
  if (type === 'number') {
    return Number(a) - Number(b)
  }
  if (type === 'date') {
    return new Date(asString(a)).getTime() - new Date(b).getTime()
  }
  return asString(a).localeCompare(b, 'he')
}

/** בודק אם שורה בודדת עומדת בתנאי סינון יחיד (סינון בצד לקוח). */
export function matchesCondition(row: Row, cond: FilterCondition): boolean {
  const field = getField(cond.field)
  const type: FieldType = field?.type ?? 'text'
  const raw = row[cond.field]
  const val = asString(raw)
  const needle = asString(cond.value)

  switch (cond.operator) {
    case 'equals':
      return val === needle
    case 'not_equals':
      return val !== needle
    case 'contains':
      return val.includes(needle)
    case 'not_contains':
      return !val.includes(needle)
    case 'starts_with':
      return val.startsWith(needle)
    case 'ends_with':
      return val.endsWith(needle)
    case 'gt':
      return compare(raw, needle, type) > 0
    case 'lt':
      return compare(raw, needle, type) < 0
    case 'between':
      return (
        compare(raw, asString(cond.value), type) >= 0 &&
        compare(raw, asString(cond.value2), type) <= 0
      )
    case 'empty':
      return isEmpty(raw)
    case 'not_empty':
      return !isEmpty(raw)
    case 'one_of':
      return (cond.values ?? []).includes(val)
    case 'is_checked':
      return isChecked(raw)
    case 'not_checked':
      return !isChecked(raw)
    default:
      return true
  }
}

/** מחיל את כל תנאי הסינון (AND) על מערך שורות. */
export function applyFilters(rows: Row[], conditions: FilterCondition[]): Row[] {
  if (conditions.length === 0) return rows
  return rows.filter((row) => conditions.every((c) => matchesCondition(row, c)))
}

/** האם התנאי מוכן להפעלה (יש לו את הערכים הדרושים). */
export function isConditionReady(cond: FilterCondition): boolean {
  switch (cond.operator) {
    case 'empty':
    case 'not_empty':
    case 'is_checked':
    case 'not_checked':
      return true
    case 'between':
      return !!cond.value && !!cond.value2
    case 'one_of':
      return !!cond.values && cond.values.length > 0
    default:
      return cond.value !== undefined && cond.value !== ''
  }
}
