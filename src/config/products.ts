/**
 * המוצרים של הפורטל — מקום אחד לשם, לנתיב ולצבע של כל מוצר.
 *
 * עד מודול התקציב כל מסך החזיק זוג קבוע ("מצבת" / "זכאות לבגרות") ותנאים
 * בינאריים (`product === 'matzevet' ? 'bagrut' : 'matzevet'`). מוצר שלישי היה
 * מפרק כל אחד מהם בנפרד, ולכן מעכשיו כל מסך עובר על הרשימה הזו
 * (החלטה 023 — מוצר רביעי לא ידרוש שינוי מבנה).
 *
 * הגישה עצמה נקבעת ב-`productAccess` ונאכפת ב-RLS (מלכודת 16).
 */

export type ProductKey = 'matzevet' | 'bagrut' | 'budget'

export interface ProductDef {
  key: ProductKey
  /** השם המלא — "מצבת תלמידים" */
  label: string
  /** השם הקצר — למחליף המודולים */
  short: string
  /** נתיב הבסיס; לרשות מסוימת: `${path}/${code}` */
  path: string
}

export const PRODUCTS: ProductDef[] = [
  { key: 'matzevet', label: 'מצבת תלמידים', short: 'מצבת', path: '/students' },
  { key: 'bagrut', label: 'זכאות לבגרות', short: 'זכאות לבגרות', path: '/bagrut' },
  { key: 'budget', label: 'ניהול תקציב', short: 'תקציב', path: '/budget' },
]

export const PRODUCT_LABELS: Record<ProductKey, string> = Object.fromEntries(
  PRODUCTS.map((p) => [p.key, p.label]),
) as Record<ProductKey, string>

export function productPath(key: ProductKey, authorityCode?: string): string {
  const p = PRODUCTS.find((x) => x.key === key)!
  return authorityCode ? `${p.path}/${authorityCode}` : p.path
}
