import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { productAccess, useAuth } from '@/context/AuthContext'
import { PRODUCTS, PRODUCT_LABELS, type ProductKey } from '@/config/products'
import { IconLock } from '@/components/brand/Icons'

/**
 * מי שמגיע למוצר בלי גישה (קישור שהועבר, כתובת ישנה) — דף ברור במקום מסך
 * ריק, ודרך למוצרים שכן פתוחים לו. **נוחות בלבד**: הנתונים עצמם חסומים ב-RLS
 * בכל מקרה (מלכודת 16 — הסתרה בתצוגה אינה הרשאה).
 */
export default function RequireProduct({ product, children }: { product: ProductKey; children: ReactNode }) {
  const { profile } = useAuth()
  const access = productAccess(profile)
  if (access[product]) return <>{children}</>
  const others = PRODUCTS.filter((p) => p.key !== product && access[p.key])
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <IconLock className="h-7 w-7" />
        </span>
        <h1 className="mt-3 text-xl font-bold text-slate-800">אין לך גישה ל{PRODUCT_LABELS[product]}</h1>
        <p className="mt-2 text-slate-600">לבקשת גישה — מנהל המערכת ברשות שלך.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="/home" className="rounded-xl bg-sky-600 px-4 py-2 font-bold text-white hover:bg-sky-700">לאזור האישי</Link>
          {others.map((p) => (
            <Link key={p.key} to={p.path} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">
              ל{p.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
