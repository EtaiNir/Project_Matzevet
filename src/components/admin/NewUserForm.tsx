import { useState } from 'react'
import { createUser, type BagrutScopeOptions, type ScopeOption } from '@/lib/admin'
import { BagrutFields, BudgetFields, MatzevetFields, type BagrutValue, type BudgetValue, type MatzevetValue } from './ProductFields'

interface Props {
  authorityCode: string
  /** לרשות בלי מצבת (למשל לקוח בגרות בלבד) — אין מה להעניק */
  hasMatzevet: boolean
  bagrutOptions: BagrutScopeOptions | null
  /** עמודות התקציב קיימות במסד (מיגרציה 042) */
  hasBudget: boolean
  budgetCategories: ScopeOption[] | null
  onCreated: () => void
  onCancel: () => void
}

/** סיסמה זמנית קריאה — סבא מוסר אותה למשתמש והוא יכול לשנותה בהמשך. */
export function suggestPassword() {
  const words = ['shomron', 'menashe', 'talmid', 'mosad', 'kita', 'rashut']
  const word = words[Math.floor(Math.random() * words.length)]
  return `${word}${Math.floor(1000 + Math.random() * 9000)}`
}

/**
 * משתמש חדש: פרטים משותפים, ואז **סימון מפורש של כל מוצר** (אייל, 11.10).
 * בלי סימון — אין גישה. מוצר אחד לפחות נדרש (נאכף גם ב-admin-users).
 */
export default function NewUserForm({ authorityCode, hasMatzevet, bagrutOptions, hasBudget, budgetCategories, onCreated, onCancel }: Props) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState(suggestPassword)
  const [withMatzevet, setWithMatzevet] = useState(false)
  const [withBagrut, setWithBagrut] = useState(false)
  const [withBudget, setWithBudget] = useState(false)
  const [budget, setBudget] = useState<BudgetValue>({ budget_role: 'manager', budget_categories: [] })
  const [matzevet, setMatzevet] = useState<MatzevetValue>({ role: 'viewer', scope_level: 'council', scope_values: [] })
  const [bagrut, setBagrut] = useState<BagrutValue>({
    bagrut_role: 'coordinator', bagrut_schools: [], bagrut_grades: [], bagrut_classes: [], bagrut_subject_keys: [], bagrut_title: null,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const superAdmin = withMatzevet && matzevet.role === 'super_admin'
  const budgetOn = withBudget && hasBudget && !superAdmin
  const ready = email.trim() && password.length >= 8 && (withMatzevet || withBagrut || budgetOn)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const b = withBagrut && !superAdmin ? bagrut : null
      await createUser({
        email: email.trim(),
        password,
        display_name: displayName.trim(),
        // בלי מצבת — צפייה בלבד: "מנהל רשות" נותן גם פעולות מצבת (העלאת קבצים)
        role: withMatzevet ? matzevet.role : 'viewer',
        authority_codes: [authorityCode],
        scope_level: withMatzevet ? matzevet.scope_level : 'none',
        scope_values: withMatzevet && matzevet.scope_level !== 'council' ? matzevet.scope_values : [],
        bagrut_role: b?.bagrut_role ?? null,
        bagrut_schools: b?.bagrut_schools ?? [],
        bagrut_grades: b?.bagrut_grades ?? [],
        bagrut_classes: b?.bagrut_classes ?? [],
        bagrut_subject_keys: b?.bagrut_subject_keys ?? [],
        bagrut_title: b?.bagrut_role === 'coordinator' ? b.bagrut_title ?? null : null,
        // תקציב (042) — נשלח רק כשסומן, כך שיצירה בלי תקציב עובדת גם לפני המיגרציה
        ...(budgetOn
          ? { budget_role: budget.budget_role, budget_categories: budget.budget_role === 'owner' ? budget.budget_categories : [] }
          : {}),
      })
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300'

  return (
    <div className="rounded-xl border-2 border-sky-200 bg-sky-50/50 p-5">
      <h4 className="mb-4 font-bold text-sky-800">משתמש חדש</h4>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">כתובת מייל</span>
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">שם לתצוגה</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">סיסמה <span className="text-xs text-slate-400">(8 תווים לפחות)</span></span>
          <div className="flex gap-2">
            <input dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass + ' font-mono'} />
            <button type="button" onClick={() => setPassword(suggestPassword())} title="הצע סיסמה אחרת"
              className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm transition hover:bg-white">🎲</button>
          </div>
        </label>
      </div>

      <div className="mt-5 text-sm font-bold text-slate-700">גישה למוצרים <span className="font-normal text-slate-500">— בלי סימון אין גישה</span></div>
      <div className="mt-2 grid gap-3 lg:grid-cols-3">
        <ProductBox title="מצבת תלמידים" checked={withMatzevet} onToggle={setWithMatzevet}
          disabledReason={hasMatzevet ? null : 'לרשות הזו אין מצבת'}>
          <MatzevetFields code={authorityCode} value={matzevet} onChange={setMatzevet} />
        </ProductBox>
        <ProductBox title="זכאות לבגרות" checked={withBagrut && !superAdmin} onToggle={setWithBagrut}
          disabledReason={superAdmin ? 'מנהל־על רואה ממילא את כל המוצרים' : bagrutOptions && !bagrutOptions.schools.length ? 'לרשות הזו אין עדיין סבב בגרות' : null}>
          <BagrutFields options={bagrutOptions} value={bagrut} onChange={setBagrut} />
        </ProductBox>
        <ProductBox title="ניהול תקציב" checked={budgetOn} onToggle={setWithBudget}
          disabledReason={superAdmin ? 'מנהל־על רואה ממילא את כל המוצרים' : !hasBudget ? 'מודול התקציב עוד לא הותקן במסד' : null}>
          <BudgetFields categories={budgetCategories} value={budget} onChange={setBudget} />
        </ProductBox>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={submit} disabled={busy || !ready}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50">
          {busy ? 'יוצר…' : 'יצירת משתמש'}
        </button>
        <button onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100">ביטול</button>
        <span className="mr-auto text-xs text-slate-500">
          {!withMatzevet && !withBagrut && !budgetOn ? 'יש לסמן מוצר אחד לפחות' : 'רשום את הסיסמה — היא לא תוצג שוב'}
        </span>
      </div>
    </div>
  )
}

/** קופסת מוצר: תיבת סימון בכותרת, והשדות נפתחים רק כשמסומנת */
export function ProductBox({ title, checked, onToggle, disabledReason, children }: {
  title: string
  checked: boolean
  onToggle: (v: boolean) => void
  disabledReason: string | null
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${checked ? 'border-sky-300 ring-1 ring-sky-200' : 'border-slate-200'}`}>
      <label className={`flex items-center gap-2 font-semibold ${disabledReason ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-800'}`}>
        <input type="checkbox" checked={checked && !disabledReason} disabled={Boolean(disabledReason)} onChange={(e) => onToggle(e.target.checked)} className="accent-sky-600" />
        {title}
        {disabledReason && <span className="text-xs font-normal">· {disabledReason}</span>}
      </label>
      {checked && !disabledReason && <div className="mt-3 border-t border-slate-100 pt-3">{children}</div>}
    </div>
  )
}
