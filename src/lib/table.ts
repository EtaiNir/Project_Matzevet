// כלי עזר לטבלה — מיון (אפיון §6.1), וסדר ידני בגרירה.
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

/**
 * זהות השורה — תעודת זהות, ולדרג ב' גם הקבוצה.
 *
 * ילד יכול להופיע **פעמיים** ובצדק: הוא היה בקובץ הגנים ובינתיים שובץ
 * לכיתה א', ולכן יש לו רשומה בטבלה הראשית וגם בדרג ב'. לפי
 * `tier-b-template.md` שתי הרשומות נשמרות — "עדיף להשאיר תלמיד
 * במערכת מאשר למחוק אותו".
 *
 * אבל ת"ז לבדה כמפתח הייתה נותנת לשתיהן **אותו** `key` ב-React ואותה
 * זהות בקיבוע ובסדר הידני: הנעץ היה מקבע את שתיהן, ורשימה מווירטואלית
 * הייתה ממחזרת שורה אחת לתוך השנייה ([החלטה 010](../../docs/decisions/010-students-rail-and-pinning.md)).
 *
 * `source_group` קיים רק בשורות דרג ב', ולכן שורות המצב"ת שומרות על
 * הזהות שהייתה להן — ואין כאן שינוי התנהגות לרשות שלא קלטה גנים.
 */
export function rowId(row: Row | undefined): string {
  const zehut = String(row?.['MISPAR_ZEHUT'] ?? '')
  const group = row?.['source_group']
  return group ? `${zehut}@${String(group)}` : zehut
}

/**
 * מזיז פריט ברשימה אל צד אחד של פריט אחר — לגרירת עמודה או שורה.
 * מחזיר רשימה חדשה; אם אחד מהשניים אינו ברשימה, מחזיר אותה כמו שהיא.
 */
export function moveItem<T>(list: T[], item: T, target: T, after: boolean): T[] {
  if (item === target || !list.includes(item) || !list.includes(target)) return list
  const rest = list.filter((x) => x !== item)
  const at = rest.indexOf(target) + (after ? 1 : 0)
  return [...rest.slice(0, at), item, ...rest.slice(at)]
}

/**
 * מסדר מפתחות לפי רשימת סדר שמורה. מפתח שאינו בה (שדה שנוסף אחרי
 * הגרירה) יורד לסוף, בסדר שבו הוא מופיע.
 */
export function orderByList(items: string[], order: string[]): string[] {
  const pos = new Map(order.map((k, i) => [k, i]))
  return items
    .map((k, i) => ({ k, p: pos.get(k) ?? order.length + i }))
    .sort((a, b) => a.p - b.p)
    .map((x) => x.k)
}

/**
 * סדר ידני — השורות לפי הסדר שהמשתמש גרר אליו.
 *
 * הסדר נשמר כרשימת זהויות ולא כמיקומים, כדי שיחזיק גם כשהסינון משתנה:
 * שורה שיצאה מהסינון וחזרה חוזרת למקומה. שורה שאינה ברשימה (לא הייתה
 * על המסך בזמן הגרירה) יורדת לסוף, בסדר הטבעי שלה.
 */
export function orderByIds(rows: Row[], order: string[]): Row[] {
  const pos = new Map(order.map((id, i) => [id, i]))
  return rows
    .map((row, i) => ({ row, key: pos.get(rowId(row)) ?? order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.row)
}
