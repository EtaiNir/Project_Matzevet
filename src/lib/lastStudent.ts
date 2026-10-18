// "התלמיד האחרון" — חזרה לכרטיס שעבדו עליו, מכל מסך (משימה 2, פגישת 14.10).
// סבא: "פיצ'ר ממש חשוב" — בפגישה יצאו מתלמיד ולא נמצאה דרך למצוא אותו שוב.
//
// 🔒 **בזיכרון הדף בלבד — לא ב-localStorage ולא ב-sessionStorage.** שם ות"ז
// של קטין לא נשארים על הדיסק של מחשב משותף ברשות; אותו נימוק כמו לסדר
// השורות במצבת (features.md, 7.10). רענון הדף או יציאה מהמערכת מוחקים אותו,
// והמעבר בין המסכים (גם לאזור האישי) — לא.

import { useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import type { CardNavState } from '@/pages/bagrut/context'

export interface LastStudent {
  studentId: string
  name: string
  className: string | null
  /** הנתיב של הכרטיס — כולל רשות ובית ספר */
  href: string
  /** הסבב שבו נפתח הכרטיס; המעטפת קוראת אותו מ-sessionStorage (bagrut:round) */
  roundId: string
  /** הרשימה שממנה הגיעו — כדי שהקודם/הבא ידפדפו שוב באותה רשימה */
  nav: CardNavState | null
}

let current: LastStudent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function setLastStudent(s: LastStudent) {
  if (current && current.studentId === s.studentId && current.href === s.href && current.nav === s.nav) return
  current = s
  emit()
}

export function useLastStudent(): LastStudent | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

// מחשב משותף: מי שנכנס אחרי היציאה לא יראה את התלמיד של הקודם
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && current) {
    current = null
    emit()
  }
})
