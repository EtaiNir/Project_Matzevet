import { NavLink } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

/**
 * מחליף המודולים של הפורטל — "מצבת | זכאות לבגרות".
 *
 * יושב בשורה הראשונה של הכותרת בכל מודול. מודול שאין למשתמש תפקיד בו
 * אינו מוצג — אבל זו נוחות בלבד: הגישה לנתונים עצמם נאכפת ב-RLS
 * (מלכודת 16 — הסתרה בתצוגה אינה הרשאה).
 */
export default function ModuleSwitch({ authorityCode }: { authorityCode: string }) {
  const { profile } = useAuth()
  const hasBagrut = profile?.role === 'super_admin' || Boolean(profile?.bagrut_role)
  if (!hasBagrut) return null

  const item = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-md px-3 py-1 text-sm font-semibold transition ${
      isActive ? 'bg-white text-sky-800 shadow-sm' : 'text-slate-500 hover:text-sky-700'
    }`

  return (
    <nav className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5" aria-label="מודולים">
      <NavLink to={authorityCode ? `/students/${authorityCode}` : '/students'} className={item}>
        מצבת
      </NavLink>
      <NavLink to={authorityCode ? `/bagrut/${authorityCode}` : '/bagrut'} className={item}>
        זכאות לבגרות
      </NavLink>
    </nav>
  )
}
