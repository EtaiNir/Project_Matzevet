// כלי עזר לטבלה — מיון (אפיון §6.1).
// דפדוף השדות האופקי הוסר לטובת גלילה אופקית; ראה Dashboard.
import type { FieldType } from '@/config/fields'
import { getField } from '@/config/fields'
import { isChecked } from './filters'

type Row = Record<string, unknown>

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  field: string
  direction: SortDirection
}

function compareValues(a: unknown, b: unknown, type: FieldType): number {
  // תיבת סימון נבדקת לפני בדיקת הריקים: תא שלא נגעו בו אינו "חסר ערך"
  // אלא "אינו מסומן", ולכן הוא חייב להשתתף במיון ולא ליפול לסוף.
  if (type === 'boolean') {
    return (isChecked(a) ? 1 : 0) - (isChecked(b) ? 1 : 0)
  }

  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1 // ריקים תמיד בסוף
  if (bEmpty) return -1

  if (type === 'number') return Number(a) - Number(b)
  if (type === 'date') return new Date(String(a)).getTime() - new Date(String(b)).getTime()
  return String(a).localeCompare(String(b), 'he')
}

/** ממיין שורות לפי שדה יחיד. לא משנה את המערך המקורי. */
export function sortRows(rows: Row[], sort: SortState | null): Row[] {
  if (!sort) return rows
  const type: FieldType = getField(sort.field)?.type ?? 'text'
  const factor = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => compareValues(a[sort.field], b[sort.field], type) * factor)
}
