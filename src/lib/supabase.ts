import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // אזהרה ברורה בזמן פיתוח אם ה-.env לא הוגדר
  console.error(
    'חסרים משתני סביבה של Supabase. ודא ש-.env מכיל VITE_SUPABASE_URL ו-VITE_SUPABASE_ANON_KEY',
  )
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

/** שם הטבלה הראשית של רשות לפי הקוד שלה, למשל students_1400000 (אפיון §3). */
export function studentsTable(authorityCode: string): string {
  return `students_${authorityCode}`
}
