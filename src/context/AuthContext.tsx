import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  role: 'viewer' | 'admin' | 'super_admin'
  /** קודי הרשויות שהמשתמש משויך אליהן (אפיון: "רשות = עולם") */
  authority_codes: string[]
  /** היקף במצבת; 'none' = אין גישה למצבת (מיגרציה 032) */
  scope_level: 'none' | 'council' | 'locality' | 'school'
  /** תפקיד בעברית — "מזכירת בית ספר", "מנהל אגף החינוך" (הערה 1) */
  job_title?: string | null
  /** שם המוסד, למשתמש שהוא בית-ספרי ולא רשותי (הערה 1) */
  institution_name?: string | null
  /** סמל המוסד — סבא ביקש "הכי טוב שניהם" */
  institution_code?: string | null
  /** רשאי למלא ערכים בעמודות שהמשתמש הוסיף (מיגרציה 016) */
  can_edit_extra?: boolean
  /** תפקיד במודול זכאות לבגרות (מיגרציות 026, 030). null = אין גישה למודול */
  bagrut_role?: 'council' | 'coordinator' | 'grade_coordinator' | 'subject_coordinator' | 'homeroom' | null
  /**
   * מה המשתמש רואה בבגרות — איחוד של השלושה (מיגרציה 037): שכבות, כיתות, ומקצועות
   * (subject_key של הסבב; רואה תלמידים עם ציון בהם — 036)
   */
  bagrut_grades?: string[]
  bagrut_classes?: string[]
  bagrut_subject_keys?: string[]
}

const BASE_COLUMNS = 'id, email, display_name, role, authority_codes, scope_level'

/**
 * לאיזה מוצר יש למשתמש גישה — לניתוב ולתצוגה בלבד. האכיפה עצמה ב-RLS
 * (מלכודת 16): מצבת — scope_level ≠ 'none'; בגרות — bagrut_role.
 */
export function productAccess(p: UserProfile | null) {
  const superAdmin = p?.role === 'super_admin'
  return {
    superAdmin,
    matzevet: Boolean(p) && (superAdmin || (p!.scope_level ?? 'council') !== 'none'),
    bagrut: Boolean(p) && (superAdmin || Boolean(p!.bagrut_role)),
  }
}
/**
 * שדות התפקיד והמוסד תלויים במיגרציה שטרם הורצה על המסד.
 * הבקשה מנסה אותם קודם, ואם העמודות אינן קיימות היא נופלת בחזרה לבסיסיות —
 * כך האתר עובד לפני ההרצה, ומציג את השדות מיד אחריה בלי פריסה מחדש.
 */
const EXTENDED_COLUMNS =
  `${BASE_COLUMNS}, job_title, institution_name, institution_code, can_edit_extra, bagrut_role, bagrut_grades, bagrut_classes, bagrut_subject_keys`

interface AuthContextValue {
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function loadProfile(userId: string): Promise<UserProfile | null> {
  const extended = await supabase
    .from('users')
    .select(EXTENDED_COLUMNS)
    .eq('id', userId)
    .single()

  if (!extended.error) return extended.data as unknown as UserProfile

  const { data, error } = await supabase
    .from('users')
    .select(BASE_COLUMNS)
    .eq('id', userId)
    .single()

  if (error) {
    console.error('שגיאה בטעינת פרופיל המשתמש:', error.message)
    return null
  }
  return data as unknown as UserProfile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  /**
   * המשתמש שהפרופיל שלו כבר נטען.
   *
   * Supabase משדר `onAuthStateChange` גם ברענון טוקן (בערך כל שעה). בלי
   * הבדיקה הזו כל רענון היה טוען את הפרופיל מחדש ומדליק את מסך "טוען…"
   * באמצע העבודה.
   */
  const loadedFor = useRef<string | null>(null)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) {
        loadedFor.current = data.session.user.id
        setProfile(await loadProfile(data.session.user.id))
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)

      const userId = newSession?.user.id ?? null
      if (!userId) {
        loadedFor.current = null
        setProfile(null)
        return
      }
      if (loadedFor.current === userId) return // רענון טוקן — הפרופיל כבר בידינו

      // הניתוב אחרי הכניסה תלוי בתפקיד, ולכן ממתינים לפרופיל לפני
      // שמציגים מסך — אחרת מנהל־על היה נוחת לרגע במסך של משתמש רגיל.
      loadedFor.current = userId
      setLoading(true)
      setProfile(await loadProfile(userId))
      setLoading(false)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signOut() {
        await supabase.auth.signOut()
      },
    }),
    [session, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth חייב להיות בתוך AuthProvider')
  return ctx
}
