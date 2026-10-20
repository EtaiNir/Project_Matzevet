// חשיפת תעודות זהות לפי רמת הרשאה (מיגרציה 040, 20.10).
//
// מנהל־על בוחר לכל רמה אם היא רואה ת"ז — של התלמיד ושל ההורים, במצבת
// ובבגרות. רמה מוסתרת רואה •••••1234 בכרטיס, ואינה רואה ת"ז בטבלאות,
// בסינון, בבורר השדות, בפיבוטים, בגרפים ובייצוא.
//
// ⚠️ **הסתרה במסך ובייצוא, לא הרשאה במסד** — ה-API עדיין מחזיר ת"ז (ת"ז היא
// מפתח כל טבלאות הרשות). מלכודת 16. האכיפה במסד — שלב נפרד.
//
// משתמש עם כמה רמות (בבגרות: מחנך שהוא גם רכז מקצוע) — אם **אחת** מהן
// מוסתרת, ת"ז מוסתרת. זהירות קודם. מנהל־על רואה תמיד.
//
// הטבלה חסרה (לפני 040) או לא נטענה — הכול גלוי, כמו עד היום.

import { useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth, type UserProfile } from '@/context/AuthContext'

export type IdLevel =
  | 'm_admin' | 'm_council' | 'm_locality' | 'm_school'
  | 'b_council' | 'b_coordinator' | 'b_principal' | 'b_grade' | 'b_subject' | 'b_homeroom'

export const ID_LEVELS: { level: IdLevel; product: 'matzevet' | 'bagrut'; label: string }[] = [
  { level: 'm_admin', product: 'matzevet', label: 'מנהל רשות' },
  { level: 'm_council', product: 'matzevet', label: 'צפייה — מועצתית' },
  { level: 'm_locality', product: 'matzevet', label: 'צפייה — יישובית' },
  { level: 'm_school', product: 'matzevet', label: 'צפייה — בית-ספרית' },
  { level: 'b_council', product: 'bagrut', label: 'צפייה מועצתית' },
  { level: 'b_coordinator', product: 'bagrut', label: 'רכז/ת בגרויות' },
  { level: 'b_principal', product: 'bagrut', label: 'מנהל/ת בית ספר' },
  { level: 'b_grade', product: 'bagrut', label: 'רכז/ת שכבה' },
  { level: 'b_subject', product: 'bagrut', label: 'רכז/ת מקצוע' },
  { level: 'b_homeroom', product: 'bagrut', label: 'מחנך/ת' },
]

type Settings = Map<IdLevel, boolean>

let settings: Settings = new Map()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** הגדרות החשיפה. נכשל בשקט: טבלה חסרה = הכול גלוי */
export async function loadIdVisibility(): Promise<Settings> {
  const { data, error } = await supabase.from('id_visibility').select('level, visible')
  settings = error ? new Map() : new Map((data ?? []).map((r) => [r.level as IdLevel, r.visible as boolean]))
  emit()
  return settings
}

export function resetIdVisibility() {
  settings = new Map()
  emit()
}

/** מנהל־על בלבד — האכיפה במדיניות של 040 */
export async function saveIdVisibility(level: IdLevel, visible: boolean): Promise<void> {
  const { data, error } = await supabase.from('id_visibility').update({ visible }).eq('level', level).select('level')
  if (error) {
    throw new Error(/id_visibility/.test(error.message) ? 'ההגדרה עדיין לא הופעלה במסד (מיגרציה 040)' : `השמירה נכשלה: ${error.message}`)
  }
  // RLS שחוסם עדכון מחזיר 0 שורות, לא שגיאה (מלכודת 21)
  if (!data?.length) throw new Error('השמירה נחסמה — רק מנהל־על משנה את ההגדרה')
  settings = new Map(settings).set(level, visible)
  emit()
}

export function useIdSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => settings,
  )
}

const allowed = (s: Settings, level: IdLevel) => s.get(level) ?? true

/** רמות המצבת של המשתמש — אחת: מנהל רשות, או צפייה לפי ההיקף */
function matzevetLevels(p: UserProfile): IdLevel[] {
  if (p.role === 'admin') return ['m_admin']
  if (p.scope_level === 'locality') return ['m_locality']
  if (p.scope_level === 'school') return ['m_school']
  if (p.scope_level === 'council') return ['m_council']
  return []
}

/** רמות הבגרות — יכולות להיות כמה (037: מסמנים שכבות, כיתות, מקצועות) */
function bagrutLevels(p: UserProfile & { bagrut_grades?: string[]; bagrut_classes?: string[]; bagrut_title?: string | null }): IdLevel[] {
  if (p.bagrut_role === 'council') return ['b_council']
  if (p.bagrut_role === 'coordinator') return [p.bagrut_title === 'principal' ? 'b_principal' : 'b_coordinator']
  const out: IdLevel[] = []
  if (p.bagrut_grades?.length) out.push('b_grade')
  if (p.bagrut_subject_keys?.length) out.push('b_subject')
  if (p.bagrut_classes?.length) out.push('b_homeroom')
  // תפקיד בלי סימון (נתון ישן) — לפי התפקיד עצמו
  if (!out.length && p.bagrut_role) {
    out.push(p.bagrut_role === 'grade_coordinator' ? 'b_grade' : p.bagrut_role === 'subject_coordinator' ? 'b_subject' : 'b_homeroom')
  }
  return out
}

export function canSeeIds(profile: UserProfile | null, product: 'matzevet' | 'bagrut', s: Settings = settings): boolean {
  if (!profile) return false
  if (profile.role === 'super_admin') return true
  const levels = product === 'matzevet' ? matzevetLevels(profile) : bagrutLevels(profile)
  return levels.every((l) => allowed(s, l))
}

/** האם המשתמש המחובר רואה ת"ז במוצר — למסכים */
export function useCanSeeIds(product: 'matzevet' | 'bagrut'): boolean {
  const { profile } = useAuth()
  return canSeeIds(profile, product, useIdSettings())
}

// בידוד כיוון (Unicode): LRI … PDI. מקודדים במספר — תו בלתי נראה בקוד המקור אינו קריא
const LRI = String.fromCharCode(0x2066)
const PDI = String.fromCharCode(0x2069)

/** •••••1234 — ארבע הספרות האחרונות, כדי שאפשר יהיה להבחין בין שני תלמידים */
export function maskId(v: unknown): string {
  const s = v == null ? '' : String(v).trim()
  if (!s) return ''
  // בידוד LTR (U+2066 … U+2069): בתוך טקסט עברי הנקודות היו עוברות לצד השני — "1234•••••"
  return `${LRI}•••••${s.slice(-4)}${PDI}`
}
