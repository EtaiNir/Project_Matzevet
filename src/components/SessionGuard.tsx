import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { remaining, setLogoutReason, touchActivity, WARN_SECONDS } from '@/lib/session'

/**
 * שומר הסשן — פעיל רק כשמחוברים. כל פעולה של המשתמש (לחיצה, מקלדת, גלילה,
 * תנועת עכבר) מאריכה את הזמן; דקה לפני הניתוק מופיע פס עם ספירה לאחור
 * ו"המשך עבודה"; בסוף — יציאה, והסיבה מוצגת במסך הכניסה. lib/session.ts.
 */
export default function SessionGuard() {
  const { session, signOut } = useAuth()
  const [left, setLeft] = useState<number | null>(null) // שניות, כשבתוך חלון האזהרה

  useEffect(() => {
    if (!session) return
    let lastTouch = 0
    // תנועת עכבר יורה עשרות פעמים בשנייה — מספיק לרשום פעם ב-15 שניות
    const onActivity = () => {
      const now = Date.now()
      if (now - lastTouch < 15_000) return
      lastTouch = now
      touchActivity(now)
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'] as const
    for (const e of events) window.addEventListener(e, onActivity, { passive: true, capture: true })

    let ending = false
    const check = () => {
      const r = remaining()
      if (!r) return setLeft(null)
      if (r.ms <= 0) {
        if (ending) return
        ending = true
        setLogoutReason(r.reason)
        void signOut()
        return
      }
      // אזהרה רק על חוסר פעילות — לתקרה של 12 שעות אין "המשך" שיעזור
      setLeft(r.reason === 'idle' && r.ms <= WARN_SECONDS * 1000 ? Math.ceil(r.ms / 1000) : null)
    }
    check()
    const timer = window.setInterval(check, 1000)
    // חזרה ללשונית שהייתה ברקע: הטיימרים שם מואטים — בודקים מיד
    const onVisible = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      for (const e of events) window.removeEventListener(e, onActivity, { capture: true })
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session, signOut])

  if (left == null) return null
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed inset-x-0 bottom-0 z-[100] flex flex-wrap items-center justify-center gap-3 border-t border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <span>
        לא זוהתה פעילות. הניתוק האוטומטי בעוד <strong className="tabular-nums">{left}</strong> שניות.
      </span>
      <button
        onClick={() => {
          touchActivity()
          setLeft(null)
        }}
        className="rounded-lg bg-amber-600 px-4 py-1.5 font-bold text-white hover:bg-amber-700"
      >
        המשך עבודה
      </button>
    </div>
  )
}
