// שדות מחושבים — נגזרים מהנתונים בצד הלקוח, בלי לגעת ב-pipeline או במסד.
//
// למה בצד הלקוח: הכללים כאן הם *הגדרה עסקית* שסבא עוד מלטש (מה נחשב כיתת
// חינוך מיוחד, מי נחשב תלמיד חוץ). שינוי כלל בצד הלקוח הוא פריסה של האתר;
// שינוי ב-pipeline מחייב ריצה מחדש על השרת וטעינה מחדש של כל הרשויות.
// כשההגדרה תתייצב אפשר להעביר אותה למודול 7 ולחסוך את החישוב בכל טעינה.

import type { StudentRow } from './students'

// ─────────────────── חינוך מיוחד — משבצת ───────────────────
//
// סבא הדגים את הכלל על נתוני אמת בפגישת 13.8:
//   1. "סוג חינוך מוסד ≠ רגיל"  → תלמידי מוסדות חינוך מיוחד.
//   2. "סוג כיתה ≠ רגילה"       → תלמידי כיתות חינוך מיוחד בבית ספר רגיל.
//      מתוכם יש להוציא ערכים שאינם חינוך מיוחד כלל (מגמות לימוד), שאותם
//      זיהה בתצוגה והוציא בסינון "אינו מכיל".
//
// מי שלומד במוסד חינוך מיוחד לומד ממילא בכיתת חינוך מיוחד, ולכן קבוצה 2
// מכילה את קבוצה 1 — שתיהן נבדקות כדי לא לפספס רישום חלקי.

/** ערכי "סוג חינוך מוסד" שאינם חינוך מיוחד. */
export const REGULAR_EDUCATION_VALUES = ['רגיל']

/** ערכי "סוג כיתה" שאינם חינוך מיוחד. */
export const REGULAR_CLASS_VALUES = ['רגילה', 'רגיל', 'ריק']

/**
 * ביטויים בתוך "סוג כיתה" שמסמנים מסלול לימוד ולא חינוך מיוחד.
 * סבא זיהה אותם בתצוגה ("זה לא חינוך מיוחד") והוציא אותם בסינון.
 *
 * הערכים במצב"ת כתובים `ל"ב טכנולוגי` ו-`ל"ב עיוני`. ההשוואה נעשית אחרי
 * הסרת גרשיים, כי אותו ערך מופיע גם כ-`לב עיוני` וגם עם גרש עברי (״).
 */
export const NON_SPECIAL_CLASS_PATTERNS = ['לב טכנולוגי', 'לב עיוני']

/** מסיר גרשיים/גרשים ומכווץ רווחים, כדי שההשוואה לא תישבר על צורת הכתיב */
function normalizeClass(value: string): string {
  return value.replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim()
}

export const SPECIAL_ED_PLACEMENT = 'משבצת'

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

/** האם ערך "סוג חינוך מוסד" מסמן מוסד חינוך מיוחד. */
export function isSpecialEdInstitution(value: unknown): boolean {
  const v = text(value)
  return v !== '' && !REGULAR_EDUCATION_VALUES.includes(v)
}

/** האם ערך "סוג כיתה" מסמן כיתת חינוך מיוחד. */
export function isSpecialEdClass(value: unknown): boolean {
  const v = normalizeClass(text(value))
  if (v === '' || REGULAR_CLASS_VALUES.includes(v)) return false
  return !NON_SPECIAL_CLASS_PATTERNS.some((p) => v.includes(p))
}

/**
 * סטטוס חינוך מיוחד לשורה.
 *
 * כרגע מזוהה **משבצת** בלבד. "שילוב" (תלמיד עם זכאות שלומד בכיתה רגילה)
 * אינו ניתן לזיהוי מקבצי משרד החינוך — הרשימה מגיעה מהשירות הפסיכולוגי
 * ועדיין לא בידינו. כשתגיע, הערך יתווסף כאן.
 */
export function specialEdStatus(row: StudentRow): string {
  if (isSpecialEdInstitution(row['SUG_CHINUCH_TEUR'])) return SPECIAL_ED_PLACEMENT
  if (isSpecialEdClass(row['TEUR_SUG_KITA'])) return SPECIAL_ED_PLACEMENT
  return ''
}

// ─────────────────── סמל מסלול ───────────────────
//
// סבא ביקש אותו פעמיים ואמר "מאוד מאוד חשוב". הבעיה: מודול 7 מחליף את
// `CODE_MASLUL` בתיאור טקסטואלי, כך שהסמל המספרי אינו מגיע למסד כלל.
//
// אבל המיפוי שם הוא חד-חד-ערכי — לכל תיאור יש קוד אחד בדיוק — ולכן אפשר
// להפוך אותו כאן ולהחזיר את הסמל בלי לגעת ב-pipeline, בלי מיגרציה,
// ובלי לטעון מחדש נתונים. המקור:
// Itay_Modules/python_modules/modules/Field_handling_module_7.py
const MASLUL_CODE_BY_LABEL: Record<string, string> = {
  'ריק': '0',
  'בגרות (עיוני,מסמ"ת)': '1',
  'הכוון': '4',
  'מרכז חינוך': '5',
  'השלמה לבגרות עיוני': '6',
  'חינוך מיוחד על יסודי': '7',
  'גמר  (רפורמה)': '8',
  'בוגר לטכנולוגיה בהנדסה': '9',
}

/**
 * סמל המסלול לשורה.
 *
 * קוד שמשרד החינוך הוסיף ואינו במילון של מודול 7 נשאר מספרי בעמודה
 * (ה-replace מדלג עליו) — ואז הערך *הוא* הסמל, ומוחזר כמו שהוא.
 */
export function maslulCode(row: StudentRow): string {
  const value = text(row['CODE_MASLUL'])
  if (value === '') return ''
  if (/^\d+$/.test(value)) return value
  return MASLUL_CODE_BY_LABEL[value] ?? ''
}

// ─────────────────── סטטוס תלמיד ברשות ───────────────────
//
// השוואה בין הרשות שבה התלמיד *גר* לרשות שבה הוא *לומד*. שני השדות
// מכילים את קוד הרשות של **משרד החינוך**, שאינו בהכרח הקוד שלנו
// (כפר = 120 אצלנו, 5108 שם) — ולכן ההשוואה היא מול authorities.moe_code.

export const RESIDENT_AND_STUDENT = 'גר ולומד ברשות'
export const RESIDENT_STUDIES_OUTSIDE = 'גר ולומד מחוץ לרשות'
export const OUTSIDE_STUDENT = 'תלמיד חוץ — לומד ברשות'

export function authorityStatus(row: StudentRow, moeCode: string): string {
  if (!moeCode) return ''
  const livesHere = text(row['RASHUT_TALMID']) === moeCode
  const studiesHere = text(row['RASHUT_CHINUCH_MOSAD']) === moeCode

  if (livesHere && studiesHere) return RESIDENT_AND_STUDENT
  if (livesHere && !studiesHere) return RESIDENT_STUDIES_OUTSIDE
  if (!livesHere && studiesHere) return OUTSIDE_STUDENT
  return ''
}

// ─────────────────── כפילות בין דרג ב' למצב"ת ───────────────────
//
// ילד יכול להופיע פעמיים ובצדק: הוא היה בקובץ הגנים ובינתיים שובץ
// לכיתה א', ולכן יש לו רשומה בטבלה הראשית וגם בדרג ב'. לפי
// tier-b-template.md שתי הרשומות נשמרות — "עדיף להשאיר תלמיד במערכת
// מאשר למחוק אותו" — אבל צריך **לראות** אותן, אחרת זו סתירה שקטה בין
// שני מקורות.
//
// השדה מקבל את שם הקבוצה שאיתה יש התנגשות ("גנים"), ולא "כן": כשיהיו
// ארבע קבוצות, השאלה הראשונה תהיה *עם מי* הכפילות.

export const DUPLICATE_FIELD = 'KFILUT_DRAG_B'

/** שם המקור לשורה שהגיעה ממשרד החינוך (אין לה `source_group`). */
const MOE_SOURCE = 'מצב״ת'

/**
 * ממפה ת"ז → **כל המקורות** שבהם הילד מופיע, כשיש יותר מאחד.
 *
 * מאז [מיגרציה 025](../../supabase/migrations/025_tier_b_composite_key.sql)
 * ילד יכול להימצא בשתי קבוצות של דרג ב' (בן 3 שנמצא גם ב«לידה עד 3»
 * וגם ב«גנים»), ולא רק במצב"ת ובדרג ב'. לכן הבדיקה אינה "מצב"ת מול דרג
 * ב'" אלא ספירה של כל המקורות לאותה ת"ז.
 *
 * הערך הוא **רשימת המקורות** ולא "כן", כי השאלה הראשונה על כפילות היא
 * תמיד *עם מי*: «מצב״ת + גנים» הוא ילד שעבר לכיתה א', ו«גנים + לידה עד 3»
 * הוא ילד בגבול הגיל — שני מצבים שונים לגמרי.
 */
function duplicateSources(rows: StudentRow[]): Map<string, string> {
  const sources = new Map<string, Set<string>>()

  for (const row of rows) {
    const id = row['MISPAR_ZEHUT']
    if (id === null || id === undefined || id === '') continue
    const key = String(id)
    const group = row['source_group']
    const source = group ? String(group) : MOE_SOURCE
    const set = sources.get(key)
    if (set) set.add(source)
    else sources.set(key, new Set([source]))
  }

  const duplicates = new Map<string, string>()
  for (const [id, set] of sources) {
    if (set.size < 2) continue
    // מצב"ת ראשון אם הוא שם — הוא המקור שהמשתמש מכיר; השאר לפי א"ב
    const list = [...set].sort((a, b) =>
      a === MOE_SOURCE ? -1 : b === MOE_SOURCE ? 1 : a.localeCompare(b, 'he'))
    duplicates.set(id, list.join(' + '))
  }
  return duplicates
}

/**
 * השדות ש-`withComputedFields` כותב. כל ערך שנטען אליהם נדרס בתצוגה,
 * ולכן אסור להציע אותם כיעד בקליטת קובץ — מיפוי אליהם נראה כאילו הצליח
 * ופשוט נעלם. מקור אמת אחד, כדי שהרשימה כאן ובמסך הקליטה לא יתפצלו.
 */
export const BROWSER_COMPUTED_FIELDS: readonly string[] = [
  'STATUS_CHINUCH_MEYUCHAD',
  'STATUS_TALMID_BARASHUT',
  'SEMEL_MASLUL',
  DUPLICATE_FIELD,
]

// ─────────────────── החלה על כל השורות ───────────────────

/**
 * מוסיף את השדות המחושבים לכל שורה. מחזיר מערך חדש; אינו נוגע במקור.
 *
 * העמודות `STATUS_CHINUCH_MEYUCHAD` ו-`STATUS_TALMID_BARASHUT` קיימות
 * בטבלה אך ריקות — כאן הן מתמלאות בתצוגה, כך שהסינון, הייצוא והפיבוטים
 * כולם רואים אותן כשדה רגיל לכל דבר.
 */
export function withComputedFields(
  rows: StudentRow[],
  moeCode: string,
): StudentRow[] {
  // מעבר מקדים: הכפילות אינה תכונה של שורה בודדת אלא של הצלבה בין כל
  // המקורות, ולכן היא מחושבת פעם אחת על המערך כולו ולא בתוך ה-map.
  const duplicates = duplicateSources(rows)

  return rows.map((row) => {
    const id = String(row['MISPAR_ZEHUT'] ?? '')
    return {
      ...row,
      STATUS_CHINUCH_MEYUCHAD: specialEdStatus(row),
      STATUS_TALMID_BARASHUT: authorityStatus(row, moeCode),
      SEMEL_MASLUL: maslulCode(row),
      [DUPLICATE_FIELD]: duplicates.get(id) ?? '',
    }
  })
}
