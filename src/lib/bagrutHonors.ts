import { eligibilityKind, ELIGIBILITY_META, fmt, isEligible, type BagrutStudent, type RoundIndex } from './bagrut'

/**
 * בגרות מצטיינת ובגרות טק — **מחושבות אצלנו**, לא מגיעות מ-T1 או מ-T2
 * (אייל, 19.10). החריג היחיד לכלל "זכאות רק לפי T2" (decisions/019):
 * הבסיס עדיין T2 — רק תלמיד שניתוח הזכאות קבע שהוא זכאי יכול להיות מצטיין
 * או טק. מעליו נבדקים התנאים הנוספים, לפי מדדי המקצועות שב-T1.
 *
 * ההגדרות — מדדי משרד החינוך (הטקסט המלא ב-decisions/019):
 *   מצטיינת — 5 יח"ל אנגלית, לפחות 4 יח"ל מתמטיקה, ממוצע משוקלל 90 לפחות
 *             (ההגדרה מתשע"ז). "הצלחה מרובה במעורבות חברתית" אינה בנתונים.
 *   טק      — מתמטיקה 5 יח"ל, פיזיקה או מדעי המחשב 5 יח"ל, אנגלית 5 יח"ל.
 *   טק ללא אנגלית — אותו דבר בלי האנגלית (המדד מוצג לצדו).
 *
 * מקצוע "עבר" = יש לו ציון סופי 55 ומעלה. המקצוע מזוהה לפי **השם** בסבב,
 * לא לפי המפתח — המפתח תלוי במבנה הקלט ("Anglit5" באקסס, "אנגלית 5 יח"ל"
 * ב-T1 המאוחד).
 */

export type HonorKey = 'excellence' | 'tech' | 'tech_no_english'
export const HONOR_KEYS: HonorKey[] = ['excellence', 'tech', 'tech_no_english']

export const HONOR_META: Record<HonorKey, { label: string; short: string }> = {
  excellence: { label: 'בגרות מצטיינת', short: 'מצטיינת' },
  tech: { label: 'בגרות טק', short: 'טק' },
  tech_no_english: { label: 'בגרות טק ללא אנגלית', short: 'טק ללא אנגלית' },
}

export const EXCELLENCE_AVERAGE = 90
const PASS = 55

export interface HonorCondition {
  label: string
  ok: boolean
  detail: string
}

export interface HonorResult {
  ok: boolean
  conditions: HonorCondition[]
  /** כמה תנאים חסרים — 1 = "חסר תנאי אחד" */
  missing: number
}

export interface Honors {
  /** הרמה הגבוהה ביותר שעבר באנגלית / במתמטיקה (יח"ל) */
  english: number | null
  math: number | null
  /** פיזיקה או מדעי המחשב ב-5 יח"ל שעבר — שם המקצוע */
  sciTech: string | null
  /** ממוצע משוקלל לפי יח"ל, של המקצועות שעבר */
  average: number | null
  averageUnits: number
  /** מקצועות שעבר אבל אין להם יח"ל — לא נכנסו לממוצע */
  noUnits: string[]
  results: Record<HonorKey, HonorResult>
}

const isEnglish = (name: string) => name.startsWith('אנגלית')
const isMath = (name: string) => name.startsWith('מתמטיקה')
const isSciTech = (name: string) => /^(פיסיקה|פיזיקה|מדעי המחשב)/.test(name)

function result(conditions: HonorCondition[]): HonorResult {
  const missing = conditions.filter((c) => !c.ok).length
  return { ok: missing === 0, conditions, missing }
}

/** null — התלמיד אינו בשכבה המסיימת (אין לו ניתוח זכאות), ואין מה לבדוק */
export function computeHonors(index: RoundIndex, s: BagrutStudent): Honors | null {
  if (!s.in_t2) return null
  const kind = eligibilityKind(s)
  let english: number | null = null
  let math: number | null = null
  let sciTech: string | null = null
  let sum = 0
  let units = 0
  const noUnits: string[] = []

  for (const [key, m] of index.metrics.get(s.student_id) ?? []) {
    if (m.final_grade == null || m.final_grade < PASS) continue
    const sub = index.subjectByKey.get(key)
    const name = sub?.subject_name ?? key
    const u = m.units ?? sub?.units ?? null
    if (u == null) {
      noUnits.push(name)
      continue
    }
    sum += m.final_grade * u
    units += u
    if (isEnglish(name)) english = Math.max(english ?? 0, u)
    if (isMath(name)) math = Math.max(math ?? 0, u)
    if (isSciTech(name) && u >= 5) sciTech ??= name
  }
  const average = units ? sum / units : null

  const eligible: HonorCondition = {
    label: 'זכאות לבגרות',
    ok: isEligible(kind),
    detail: ELIGIBILITY_META[kind].label,
  }
  const level = (label: string, have: number | null, need: number): HonorCondition => ({
    label: `${label} ${need === 4 ? 'לפחות 4' : need} יח״ל`,
    ok: have != null && have >= need,
    detail: have != null ? `עבר ${label} ${have} יח״ל` : `לא עבר ${label}`,
  })
  const sci: HonorCondition = {
    label: 'פיזיקה או מדעי המחשב 5 יח״ל',
    ok: sciTech != null,
    detail: sciTech ? `עבר ${sciTech}` : 'לא עבר פיזיקה או מדעי המחשב ב-5 יח״ל',
  }
  const avg: HonorCondition = {
    label: `ממוצע משוקלל ${EXCELLENCE_AVERAGE} לפחות`,
    ok: average != null && average >= EXCELLENCE_AVERAGE,
    detail: average != null ? `ממוצע ${fmt(average, 1)} (${units} יח״ל)` : 'אין מקצועות עם ציון סופי',
  }

  return {
    english, math, sciTech, average, averageUnits: units, noUnits,
    results: {
      excellence: result([eligible, level('אנגלית', english, 5), level('מתמטיקה', math, 4), avg]),
      tech: result([eligible, level('מתמטיקה', math, 5), sci, level('אנגלית', english, 5)]),
      tech_no_english: result([eligible, level('מתמטיקה', math, 5), sci]),
    },
  }
}

export function honorsMap(index: RoundIndex, students: BagrutStudent[]): Map<string, Honors | null> {
  return new Map(students.map((s) => [s.student_id, computeHonors(index, s)]))
}

/** "מה חסר" בשורה אחת — לטבלאות ולייצוא */
export function missingText(r: HonorResult): string {
  return r.conditions.filter((c) => !c.ok).map((c) => c.label).join(' · ')
}
