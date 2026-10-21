// הסשן אינו לנצח: נגמר כשסוגרים את הכרטיסייה, ואחרי 12 שעות מרגע הכניסה —
// קשיח, גם עם פעילות. אין ניתוק על חוסר פעילות (הוסר 20.10, לבקשת המפתח:
// ניתוק באמצע יום עבודה מפריע יותר משהוא מגן, כשהכרטיסייה ממילא נסגרת).
//
// למה בכלל: הנתונים הם ת"ז, כתובות וטלפונים של קטינים, והמערכת פתוחה על
// מחשבים משותפים ברשויות. עד 18.10 הכניסה נשמרה ב-localStorage והטוקן התחדש
// מעצמו — מי שנכנס פעם אחת נשאר מחובר לתמיד, גם אחרי סגירת הדפדפן.
//
// איך:
//   · הטוקן ב-sessionStorage (authStorage) — נמחק כשהכרטיסייה נסגרת. כל כרטיסייה
//     מתחברת בנפרד; קישור שנפתח בכרטיסייה חדשה מבקש כניסה. זה המחיר.
//   · ⚠️ כרום משחזר sessionStorage עם "פתיחה מחדש של כרטיסייה סגורה" (Ctrl+Shift+T).
//     לכן בטעינה נבדק גם הזמן מהכניסה — sessionExpired(). מלכודת 35.
//   · לפי חותמת זמן ולא לפי טיימר: לשונית ברקע מאטה טיימרים.

export const MAX_HOURS = 12

const STARTED = 'auth:started-at'
const REASON = 'auth:logout-reason'

export type LogoutReason = 'max'

// ── אחסון הטוקן: sessionStorage, ובמצב שבו אינו זמין — זיכרון הדף בלבד
const memory = new Map<string, string>()
function ss(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
export const authStorage = {
  getItem: (k: string) => {
    try {
      return ss()?.getItem(k) ?? memory.get(k) ?? null
    } catch {
      return memory.get(k) ?? null
    }
  },
  setItem: (k: string, v: string) => {
    try {
      ss()?.setItem(k, v)
    } catch {
      memory.set(k, v)
    }
  },
  removeItem: (k: string) => {
    memory.delete(k)
    try {
      ss()?.removeItem(k)
    } catch {
      /* אין מה למחוק */
    }
  },
}

/** כניסה שנשמרה ב-localStorage לפני 18.10 — לא להשאיר אותה על הדיסק */
export function purgeLegacyAuth() {
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) window.localStorage.removeItem(k)
    }
  } catch {
    /* localStorage חסום — אין מה לנקות */
  }
}

/** תחילת סשן חדש — בכניסה */
export function startSession(now = Date.now()) {
  authStorage.setItem(STARTED, String(now))
}

export function clearSessionClock() {
  authStorage.removeItem(STARTED)
  // מפתח מגרסת 18.10 (ניתוק על חוסר פעילות) — לא לשאיר שאריות
  authStorage.removeItem('auth:last-activity')
}

/** כמה מילישניות נשארו עד התקרה. null = אין שעון (סשן שקדם לשינוי): מתחילים אותו עכשיו */
export function remaining(now = Date.now()): number | null {
  const v = Number(authStorage.getItem(STARTED))
  if (!Number.isFinite(v) || v <= 0) return null
  return v + MAX_HOURS * 3_600_000 - now
}

export function sessionExpired(now = Date.now()): LogoutReason | null {
  const r = remaining(now)
  return r != null && r <= 0 ? 'max' : null
}

// ── למה נותקת — עובר למסך הכניסה
export function setLogoutReason(r: LogoutReason) {
  authStorage.setItem(REASON, r)
}
export function takeLogoutReason(): LogoutReason | null {
  const r = authStorage.getItem(REASON)
  authStorage.removeItem(REASON)
  return r === 'max' ? r : null
}

export const LOGOUT_MESSAGES: Record<LogoutReason, string> = {
  max: `נותקת אוטומטית — חלפו ${MAX_HOURS} שעות מהכניסה. אפשר להיכנס מחדש.`,
}
