import { createContext, useContext } from 'react'
import type { InstitutionTotal, InvoiceMonth, MeitarEntity, MeitarRun, MeitarTopic, MonthTopic, TopicPlan } from '@/lib/meitar'
import type { MeitarPeriod } from '@/lib/meitarCalc'

/** מה שמעטפת המיתר טוענת למקור ולשנה שנבחרו, ומעבירה לכל המסכים */
export interface MeitarContextValue {
  code: string
  authorityName: string
  canManage: boolean
  /** `/budget/{code}/meitar` */
  base: string
  entities: MeitarEntity[]
  /** המקור שנבחר (null — עוד אין מקורות רשומים) */
  entity: MeitarEntity | null
  /**
   * תצוגת בית ספר: השורות של המוסד מה-run של המועצה (ה-ZIP שלו הוא תת-קבוצה
   * של ה-ZIP של המועצה). null — תצוגת המקור עצמו.
   */
  institution: string | null
  /** המקור שה-runs שלו מזינים את התצוגה (המועצה, בתצוגת בית ספר) */
  dataEntity: string
  runs: MeitarRun[]
  /** מהבורר בכותרת המודול: שנת התקציב, ותקופה — ינואר–דצמבר או שנה"ל (ספט׳ של השנה הקודמת–אוג׳) */
  year: number
  period: MeitarPeriod
  /** שנה"ל של התכנון: בתצוגת שנה"ל — השנה שנבחרה; בקלנדרית אין תכנון (התכנון לשנה"ל) */
  schoolYear: number
  /** 12 החודשים של התקופה */
  months12: string[]
  /** חודשי החישוב שנקלטו בתקופה, מהישן לחדש */
  months: string[]
  /** החודש שנבחר ("YYYY-MM-01") — ברירת מחדל: האחרון */
  month: string | null
  topics: Map<string, MeitarTopic>
  monthTopics: MonthTopic[]
  invoiceMonths: InvoiceMonth[]
  plans: Map<string, TopicPlan>
  booked: Map<string, { booked: number; count: number }>
  instTotals: InstitutionTotal[]
  applyPlan: (p: TopicPlan) => void
  setParam: (k: string, v: string | null) => void
  /** קישור בתוך המיתר ששומר את המקור, השנה והחודש */
  to: (path: string, extra?: Record<string, string>) => string
}

export const MeitarContext = createContext<MeitarContextValue | null>(null)

export function useMeitar(): MeitarContextValue {
  const ctx = useContext(MeitarContext)
  if (!ctx) throw new Error('useMeitar חייב להיות בתוך MeitarShell')
  return ctx
}

/** המסכים של המיתר — בסרגל הצד, בתפריט שנפתח מתחת ל"מיתר" (BudgetShell) */
export const MEITAR_PAGES: [string, string][] = [
  ['', 'סקירה'],
  ['topics', 'נושאים'],
  ['institutions', 'מוסדות'],
  ['invoice', 'חשבונית והתאמה'],
  ['downloads', 'הורדות'],
]

/** מה שמעטפת התקציב מעבירה למסכים שאינם תלויים בכרטסת (מיתר, קליטה) */
export interface BudgetBase {
  authorityName: string
  canManage: boolean
  isOwner: boolean
  year: number
  period: MeitarPeriod
}
