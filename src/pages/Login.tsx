import { useState, type FormEvent } from 'react'
import { LOGOUT_MESSAGES, takeLogoutReason } from '@/lib/session'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { SITE } from '@/config/site'
import { configDiagnostics, describeAuthError } from '@/lib/diagnostics'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[] | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  // ניתוק אוטומטי (lib/session) — לומר למה, אחרת זה נראה כמו תקלה
  const [logoutReason] = useState(takeLogoutReason)
  // "במסך הלוג-אין, לאפשר גם את העין לצפייה בסיסמה" (הערה 15)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setDetails(null)
    setBusy(true)
    try {
      await signIn(email, password)
    } catch (err) {
      // הסבר בשפה פשוטה + פירוט טכני, כדי שתקלת הגדרה לא תיראה כמו סיסמה שגויה
      const { message, technical } = describeAuthError(err)
      setError(message)
      setDetails([...technical, ...configDiagnostics()])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm space-y-4">
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl bg-white p-8 shadow-lg"
        >
          <div className="text-center">
            <div className="text-3xl">🎓</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-800">{SITE.name}</h1>
            <p className="mt-1 text-sm text-slate-500">כניסה למערכת</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              כתובת מייל
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              סיסמה
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-10 text-right focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}
                aria-label={showPassword ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}
                className="absolute inset-y-0 left-0 flex w-10 items-center justify-center text-slate-400 transition hover:text-slate-700"
              >
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {logoutReason && !error && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">{LOGOUT_MESSAGES[logoutReason]}</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 py-2 font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'מתחבר…' : 'כניסה'}
          </button>

          <div className="flex justify-center gap-4 border-t border-slate-100 pt-4 text-sm">
            <Link to="/" className="text-slate-500 transition hover:text-sky-700">
              → חזרה לדף הבית
            </Link>
            <Link to="/about" className="text-slate-500 transition hover:text-sky-700">
              אודות האתר
            </Link>
          </div>
        </form>

        {/* פירוט טכני — נפתח רק כשיש תקלה, לאבחון מהיר בלי לפתוח כלי מפתחים */}
        {details && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="flex w-full items-center justify-between font-medium text-amber-900"
            >
              <span>פרטים טכניים</span>
              <span className="text-xs">{showDetails ? '▲ הסתר' : '▼ הצג'}</span>
            </button>

            {showDetails && (
              <ul className="mt-3 space-y-1 border-t border-amber-200 pt-3 text-amber-900">
                {details.map((line, i) => (
                  <li key={i} className="break-all font-mono text-xs" dir="ltr">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
