import { useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { remaining, setLogoutReason } from '@/lib/session'

/**
 * שומר הסשן — פעיל רק כשמחוברים. 12 שעות מרגע הכניסה — יציאה, והסיבה
 * מוצגת במסך הכניסה. אין ניתוק על חוסר פעילות. lib/session.ts.
 */
export default function SessionGuard() {
  const { session, signOut } = useAuth()

  useEffect(() => {
    if (!session) return
    let ending = false
    const check = () => {
      const r = remaining()
      if (r == null || r > 0 || ending) return
      ending = true
      setLogoutReason('max')
      void signOut()
    }
    check()
    // פעם בדקה מספיק לתקרה של 12 שעות; וחזרה ללשונית שהייתה ברקע — מיד
    const timer = window.setInterval(check, 60_000)
    const onVisible = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session, signOut])

  return null
}
