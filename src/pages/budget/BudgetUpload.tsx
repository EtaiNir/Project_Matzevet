import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import BudgetUploadPanel from '@/components/budget/BudgetUploadPanel'

/**
 * קליטת קבצים מתוך המודול — למנהל התקציב (גם מי שאינו מנהל־על ולכן אין לו
 * את כרטיס הלקוח). ההרשאה עצמה ב-RLS: budget_uploads ו-budget-uploads דורשים
 * budget_manage_codes; הבדיקה כאן היא נוחות בלבד.
 */
export default function BudgetUpload() {
  const { profile } = useAuth()
  const { code = '' } = useParams()
  const allowed = profile?.role === 'super_admin' || profile?.budget_role === 'manager'
  if (profile && !allowed) return <Navigate to={`/budget/${code}`} replace />
  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <h1 className="mb-3 text-lg font-bold text-slate-800">קליטת קובצי תקציב</h1>
      <BudgetUploadPanel code={code} />
    </div>
  )
}
