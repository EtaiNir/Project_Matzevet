import { createContext, useContext } from 'react'
import type { CardMeta, CardPlan, MonthlyRow } from '@/lib/budget'
import type { PlanReview } from '@/lib/budgetTracking'
import type { CardRow, Period } from '@/lib/budgetCalc'

/** מה שהמעטפת טוענת פעם אחת ומעבירה לכל מסכי התקציב */
export interface BudgetContextValue {
  code: string
  authorityName: string
  /** שנת התקציב (קלנדרית) — זו של דוח הכרטיסים */
  year: number
  period: Period
  /** תחילת התקופה (ISO) — ינואר או ספטמבר של השנה הקודמת */
  periodFrom: string
  rows: CardRow[]
  monthly: MonthlyRow[]
  /** תאריך הנתונים — עד מתי הדוח (מהשם של דוח ה-EPR) */
  asOf: string | null
  /** חודשים שחלפו בתקופה — לקצב ולהצעת הצפי */
  elapsed: number
  /** מנהל תקציב או מנהל־על — עורך קטגוריות, מיתר, רכש ומעלה קבצים */
  canManage: boolean
  /** רשאי לערוך צפי, תכנית והערות (מנהל, או אחראי בכרטיסים שלו — רק אותם הוא רואה) */
  canPlan: boolean
  /** אחראי תקציב — רואה רק את הכרטיסים שבקטגוריות שלו, ולא את המיתר */
  isOwner: boolean
  applyMeta: (m: CardMeta) => void
  applyPlan: (p: CardPlan) => void
  /** 024 — ההצעה לצפי עונתית (לפי השנה שעברה) או לפי הקצב */
  seasonal: boolean
  /** 024 — מצב אישור התכנית לשנה הבאה, לכל כרטיס; אין = בעבודה */
  planReviews: Map<string, PlanReview>
  applyPlanReview: (r: PlanReview) => void
  /** `/budget/{code}` */
  base: string
}

export const BudgetContext = createContext<BudgetContextValue | null>(null)

export function useBudget(): BudgetContextValue {
  const ctx = useContext(BudgetContext)
  if (!ctx) throw new Error('useBudget חייב להיות בתוך BudgetShell')
  return ctx
}

/** ניווט קודם/הבא בין כרטיסים מתוך הרשימה המסוננת (כמו בבגרות — מלכודת 23) */
export interface CardNavState {
  codes: string[]
  fromLabel: string
  backTo: string
}
