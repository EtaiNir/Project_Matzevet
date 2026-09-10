// ייצוא לאקסל — אפיון §6.5. "הדרך היחידה להפיק דוחות בשלב א'".
// מייצא את *כל* השדות שנבחרו (מכל הדפים), משקף את הסינון והמיון הנוכחיים.
//
// העיצוב לפי הערה 14 של סבא: שורת כותרת מוקפאת, מודגשת, צבועה וממורכזת,
// גלישת טקסט, גבולות לכל התאים, ורוחב עמודות אוטומטי. ראה lib/xlsx.ts.

import { fieldLabel, getField } from '@/config/fields'
import { isChecked } from './filters'
import { downloadWorkbook, type CellValue } from './xlsx'

type Row = Record<string, unknown>

interface ExportOptions {
  /** שם הגיליון בתוך הקובץ (ברירת מחדל: "תלמידים") */
  sheetName?: string
}

/**
 * מייצא שורות לקובץ אקסל.
 * @param rows השורות אחרי סינון ומיון
 * @param fields מפתחות השדות שנבחרו, לפי הסדר (כולל שדות מכל הדפים)
 * @param fileName שם הקובץ (בלי סיומת)
 */
export async function exportToExcel(
  rows: Row[],
  fields: string[],
  fileName: string,
  options: ExportOptions = {},
): Promise<void> {
  const headers = fields.map((key) => fieldLabel(key))

  // רק שדות שהוגדרו כמספריים נכתבים כמספר. תעודות זהות וסמלי מוסד הם
  // טקסט בהגדרה — אחרת אקסל מוחק אפסים מובילים ומציג כתיב מדעי.
  const numericColumns = new Set<number>()
  const checkboxColumns = new Set<number>()
  fields.forEach((key, i) => {
    const type = getField(key)?.type
    if (type === 'number') numericColumns.add(i)
    if (type === 'boolean') checkboxColumns.add(i)
  })

  const data: CellValue[][] = rows.map((row) =>
    fields.map((key, i) => {
      const value = row[key]
      // תיבת סימון: ✓ או תא ריק. לא TRUE/FALSE באנגלית באמצע גיליון עברי.
      if (checkboxColumns.has(i)) return isChecked(value) ? '✓' : ''
      if (value === null || value === undefined) return ''
      if (numericColumns.has(i)) {
        const num = Number(value)
        return Number.isFinite(num) ? num : String(value)
      }
      return String(value)
    }),
  )

  await downloadWorkbook(
    {
      sheetName: options.sheetName ?? 'תלמידים',
      headers,
      rows: data,
      numericColumns,
    },
    fileName,
  )
}
