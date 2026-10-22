// "הסעיף האחרון" במודול התקציב — חזרה לכרטיס הסעיף שעבדו עליו, מכל מסך. אותו
// דפוס כמו "התלמיד האחרון" בבגרות (lib/lastStudent.ts, משימה 2 של 14.10).
//
// 🔒 **בזיכרון הדף בלבד** — לא ב-localStorage ולא ב-sessionStorage, כמו התלמיד
// האחרון: מחשבים משותפים ברשויות. רענון הדף או יציאה מהמערכת מוחקים אותו.

import { useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import type { CardNavState } from '@/pages/budget/context'

export interface LastBudgetCard {
  /** הרשות */
  code: string
  card: string
  name: string
  /** הנתיב של הכרטיס — כולל השנה והתקופה (search) */
  href: string
  /** הרשימה שממנה הגיעו — כדי שהקודם/הבא ידפדפו שוב באותה רשימה */
  nav: CardNavState | null
}

let current: LastBudgetCard | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function setLastBudgetCard(c: LastBudgetCard) {
  if (current && current.card === c.card && current.href === c.href && current.nav === c.nav) return
  current = c
  emit()
}

export function useLastBudgetCard(): LastBudgetCard | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && current) {
    current = null
    emit()
  }
})
