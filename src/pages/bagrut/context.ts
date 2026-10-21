import { createContext, useContext } from 'react'
import type { ActionCounts, BagrutRound, RoundData, RoundIndex, StatusOverride, Tracking } from '@/lib/bagrut'

export interface BagrutContextValue {
  authorityCode: string
  round: BagrutRound
  data: RoundData
  index: RoundIndex
  /** מותר לערוך מעקב — כולם חוץ מהמועצה. ה-RLS הוא הקובע; זה רק לתצוגה. */
  canEditTracking: boolean
  /** מחיל על המסך את השורה כפי שהשרת שמר אותה (מלכודת 26) */
  applyTracking: (t: Tracking) => void
  /** ספירות התוכנית של תלמיד אחרי שינוי בלשונית המעקב — לרשימה ולסרגל */
  applyActionCounts: (studentId: string, counts: ActionCounts) => void
  /**
   * שינוי ידני של הסטטוס שנשמר (043) — כפי שהמסד החזיר (מלכודת 26). null =
   * חזרה לניתוח הזכאות. תמונת המצב, המצטיינת/טק והרשימות נספרות מחדש מעצמן.
   */
  applyStatusOverride: (studentId: string, override: StatusOverride | null) => void
  /** רשאי לשנות סטטוס — מנהל־על ורכז/ת בגרויות (תצוגה; האכיפה במסד) */
  canOverrideStatus: boolean
  /** נתיב בסיס למסכי המודול: /bagrut/:code */
  base: string
}

export const BagrutContext = createContext<BagrutContextValue | null>(null)

export function useBagrut(): BagrutContextValue {
  const v = useContext(BagrutContext)
  if (!v) throw new Error('useBagrut מחוץ ל-BagrutShell')
  return v
}

/**
 * מה שמסך רשימה מעביר לכרטיס התלמיד: סדר הת"ז כפי שהמשתמש ראה אותו, כדי
 * שהקודם/הבא ידפדפו *באותה רשימה* — לא בכל בית הספר (מלכודת 23: פקד
 * שעובר מקום חייב לשאת איתו את מה שהיה על המסך).
 */
export interface CardNavState {
  ids: string[]
  fromLabel: string
  backTo: string
}
