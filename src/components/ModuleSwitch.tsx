import { NavLink } from 'react-router-dom'
import { productAccess, useAuth } from '@/context/AuthContext'
import { PRODUCTS, productPath } from '@/config/products'

/**
 * מחליף המודולים של הפורטל — "מצבת | זכאות לבגרות | תקציב".
 *
 * יושב בשורה הראשונה של הכותרת בכל מודול, ומוצג רק למי שיש לו שני מוצרים
 * לפחות (מי שיש לו אחד — עובר דרך האזור האישי). נוחות בלבד: הגישה לנתונים
 * עצמם נאכפת ב-RLS (מלכודת 16 — הסתרה בתצוגה אינה הרשאה).
 */
export default function ModuleSwitch({ authorityCode }: { authorityCode: string }) {
  const { profile } = useAuth()
  const access = productAccess(profile)
  const mine = PRODUCTS.filter((p) => access[p.key])
  if (mine.length < 2) return null

  const item = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-md px-3 py-1 text-sm font-semibold transition ${
      isActive ? 'bg-white text-sky-800 shadow-sm' : 'text-slate-500 hover:text-sky-700'
    }`

  return (
    <nav className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5" aria-label="מודולים">
      {mine.map((p) => (
        <NavLink key={p.key} to={productPath(p.key, authorityCode || undefined)} className={item}>
          {p.short}
        </NavLink>
      ))}
    </nav>
  )
}
