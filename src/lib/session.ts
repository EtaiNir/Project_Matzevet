// הסשן אינו לנצח: נגמר כשסוגרים את הכרטיסייה, אחרי זמן ללא פעילות, ואחרי
// תקרה מרגע הכניסה — גם עם פעילות.
//
// למה: הנתונים הם ת"ז, כתובות וטלפונים של קטינים, והמערכת פתוחה על מחשבים
// משותפים ברשויות. עד היום הכניסה נשמרה ב-localStorage והטוקן התחדש מעצמו —
// מי שנכנס פעם אחת נשאר מחובר לתמיד, גם אחרי סגירת הדפדפן.
//
// איך:
//   · הטוקן ב-sessionStorage (authStorage) — נמחק כשהכרטיסייה נסגרת. כל כרטיסייה
//     מתחברת בנפרד; קישור שנפתח בכרטיסייה חדשה מבקש כניסה. זה המחיר.
//   · ⚠️ כרום משחזר sessionStorage עם "פתיחה מחדש של כרטיסייה סגורה" (Ctrl+Shift+T).
//     לכן בטעינה נבדק גם הזמן מהפעילות האחרונה — sessionExpired().
//   · הזמנים — לפי חותמות זמן ולא לפי טיימר: לשונית ברקע מאטה טיימרים, אבל
//     בחזרה אליה החישוב נכון.

export const IDLE_MINUTES = 30
export const WARN_SECONDS = 60
export const MAX_HOURS = 12

const LAST = 'auth:last-activity'
const STARTED = 'auth:started-at'
const REASON = 'auth:logout-reason'

export type LogoutReason = 'idle' | 'max'

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

/** כניסה שנשמרה ב-localStorage לפני השינוי — לא להשאיר אותה על הדיסק */
export function purgeLegacyAuth() {
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) window.localStorage.removeItem(k)
    }
  } catch {
    /* localStorage חסום — אין מה לנקות */
  }
}

const read = (k: string) => {
  const v = Number(authStorage.getItem(k))
  return Number.isFinite(v) && v > 0 ? v : null
}

/** פעילות של המשתמש — מאריכה את הסשן (לא מעבר לתקרה) */
export function touchActivity(now = Date.now()) {
  authStorage.setItem(LAST, String(now))
}

/** תחילת סשן חדש — בכניסה */
export function startSession(now = Date.now()) {
  authStorage.setItem(STARTED, String(now))
  touchActivity(now)
}

export function clearSessionClock() {
  authStorage.removeItem(LAST)
  authStorage.removeItem(STARTED)
}

/**
 * כמה זמן נשאר — במילישניות, עד הסיבה הקרובה. null = אין שעון (סשן שקדם
 * לשינוי): מתחילים אותו עכשיו, לא מנתקים.
 */
export function remaining(now = Date.now()): { ms: number; reason: LogoutReason } | null {
  const last = read(LAST)
  const started = read(STARTED)
  if (!last || !started) return null
  const idle = last + IDLE_MINUTES * 60_000 - now
  const max = started + MAX_HOURS * 3_600_000 - now
  return idle <= max ? { ms: idle, reason: 'idle' } : { ms: max, reason: 'max' }
}

export function sessionExpired(now = Date.now()): LogoutReason | null {
  const r = remaining(now)
  return r && r.ms <= 0 ? r.reason : null
}

// ── למה נותקת — עובר למסך הכניסה
export function setLogoutReason(r: LogoutReason) {
  authStorage.setItem(REASON, r)
}
export function takeLogoutReason(): LogoutReason | null {
  const r = authStorage.getItem(REASON) as LogoutReason | null
  authStorage.removeItem(REASON)
  return r === 'idle' || r === 'max' ? r : null
}

export const LOGOUT_MESSAGES: Record<LogoutReason, string> = {
  idle: `נותקת אוטומטית אחרי ${IDLE_MINUTES} דקות ללא פעילות. אפשר להיכנס מחדש.`,
  max: `נותקת אוטומטית — חלפו ${MAX_HOURS} שעות מהכניסה. אפשר להיכנס מחדש.`,
}
