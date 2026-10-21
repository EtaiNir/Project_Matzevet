import { createContext, useContext } from 'react'
import type { ActionCounts, BagrutFlag, BagrutRound, EditRef, ManualEdit, RoundData, RoundIndex, StudentRows, Tracking } from '@/lib/bagrut'

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
  /** עריכה ידנית שנשמרה (037) — מחילים את תשובת השרת על המסך (מלכודת 26) */
  applyDataEdit: (ref: EditRef, value: string | null, edit: ManualEdit | null) => void
  /**
   * אחרי עדכון ציון: כל השורות של התלמיד כפי שהמסד חישב אותן מחדש (041) —
   * המקצועות, הזכאות, המצטיינת/טק והדגלים. תמונת המצב והרשימות נספרות מהן.
   */
  applyStudentRows: (rows: StudentRows) => void
  /** דגל אדום אחרי "נבדק" / הערה */
  applyFlag: (flag: BagrutFlag) => void
  /** רשאי לעדכן ציונים ולטפל בדגלים — מנהל־על ורכז/ת בגרויות (תצוגה; האכיפה במסד) */
  canEditGrades: boolean
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
