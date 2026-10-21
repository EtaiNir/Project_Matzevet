import { useEffect, useMemo, useState } from 'react'
import { money } from '@/lib/budgetCalc'
import { scenarioBase } from '@/lib/budgetInsights'
import { useBudget } from './context'

type Adjust = Record<string, { inc: number; exp: number }>

/**
 * תרחישים לשנה הבאה (024, רעיון 6): "מה אם" — שינוי באחוזים להכנסות ולהוצאות
 * של כל קטגוריה 1, וגם לכולן יחד, ומיד רואים את הגרעון או העודף. **לא נשמר
 * בתכנית** — רק בדפדפן של מי שבודק (כדי לחזור לתרחיש), והתכנית האמיתית לא נוגעת.
 *
 * הבסיס לכל כרטיס: התכנית לשנה הבאה כשהוזנה, אחרת הצפי, אחרת התקציב.
 */
export default function BudgetScenarios() {
  const b = useBudget()
  const storeKey = `budget-scenario:${b.code}:${b.year}`
  const [adjust, setAdjust] = useState<Adjust>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Adjust
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(adjust))
    } catch {
      /* מצב פרטי — התרחיש פשוט לא יישמר */
    }
  }, [adjust, storeKey])

  const { groups, fromPlan, fromForecast } = useMemo(() => scenarioBase(b.rows), [b.rows])
  const all = adjust['*'] ?? { inc: 0, exp: 0 }
  const factor = (key: string, side: 'inc' | 'exp') => (1 + (adjust[key]?.[side] ?? 0) / 100) * (1 + all[side] / 100)
  const lines = groups.map((g) => ({ ...g, sInc: g.income * factor(g.key, 'inc'), sExp: g.expense * factor(g.key, 'exp') }))
  const t = lines.reduce((s, l) => ({ inc: s.inc + l.income, exp: s.exp + l.expense, sInc: s.sInc + l.sInc, sExp: s.sExp + l.sExp }), { inc: 0, exp: 0, sInc: 0, sExp: 0 })
  const set = (key: string, side: 'inc' | 'exp', v: string) =>
    setAdjust((a) => ({ ...a, [key]: { inc: a[key]?.inc ?? 0, exp: a[key]?.exp ?? 0, [side]: Number(v) || 0 } }))
  const changed = Object.values(adjust).some((v) => v.inc || v.exp)

  const pctInput = (key: string, side: 'inc' | 'exp') => (
    <input type="number" step={1} value={adjust[key]?.[side] || ''} placeholder="0" onChange={(e) => set(key, side, e.target.value)}
      className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-center tabular-nums focus:border-emerald-400 focus:outline-none" dir="ltr" />
  )
  const balance = (inc: number, exp: number) => {
    const g = inc - exp
    return <span className={`tabular-nums font-bold ${g < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{g < 0 ? 'גרעון ' : 'עודף '}{money(Math.abs(g))}</span>
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold text-slate-800">🧪 תרחישים לשנה הבאה — {b.year + 1}</h1>
        <span className="text-xs text-slate-500">לא נשמר בתכנית · רק לבדיקה</span>
        <span className="mr-auto" />
        {changed && <button onClick={() => setAdjust({})} className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50">איפוס התרחיש</button>}
      </div>
      <p className="text-xs text-slate-500">
        הבסיס לכל כרטיס: התכנית ל-{b.year + 1} כשהוזנה ({fromPlan} כרטיסים), אחרת הצפי לסוף השנה או התקציב ({fromForecast}).
        שינוי באחוזים — לכל קטגוריה, ובשורה הראשונה לכולן יחד (מצטבר לשינוי של הקטגוריה).
      </p>

      <div className="flex flex-wrap gap-2 text-sm">
        <div className="rounded-xl bg-white px-4 py-2 shadow-sm ring-1 ring-slate-200">
          <div>{balance(t.inc, t.exp)}</div><div className="text-xs text-slate-500">בבסיס</div>
        </div>
        <div className={`rounded-xl px-4 py-2 shadow-sm ring-1 ${changed ? 'bg-violet-50 ring-violet-200' : 'bg-white ring-slate-200'}`}>
          <div>{balance(t.sInc, t.sExp)}</div><div className="text-xs text-slate-500">בתרחיש</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-right font-semibold">קטגוריה 1</th>
              <th className="px-3 py-2 text-left font-semibold">הכנסות בבסיס</th>
              <th className="px-3 py-2 font-semibold">שינוי %</th>
              <th className="px-3 py-2 text-left font-semibold">הכנסות בתרחיש</th>
              <th className="px-3 py-2 text-left font-semibold">הוצאות בבסיס</th>
              <th className="px-3 py-2 font-semibold">שינוי %</th>
              <th className="px-3 py-2 text-left font-semibold">הוצאות בתרחיש</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100 bg-violet-50/40 font-semibold">
              <td className="px-3 py-1.5">כל הקטגוריות</td>
              <td /><td className="px-3 py-1.5 text-center">{pctInput('*', 'inc')}</td><td />
              <td /><td className="px-3 py-1.5 text-center">{pctInput('*', 'exp')}</td><td />
            </tr>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-slate-800">{l.label}</td>
                <td className="px-3 py-1.5 text-left tabular-nums text-teal-800">{money(l.income || null)}</td>
                <td className="px-3 py-1.5 text-center">{pctInput(l.key, 'inc')}</td>
                <td className="px-3 py-1.5 text-left tabular-nums font-semibold text-teal-800">{money(l.sInc || null)}</td>
                <td className="px-3 py-1.5 text-left tabular-nums text-rose-800">{money(l.expense || null)}</td>
                <td className="px-3 py-1.5 text-center">{pctInput(l.key, 'exp')}</td>
                <td className="px-3 py-1.5 text-left tabular-nums font-semibold text-rose-800">{money(l.sExp || null)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
              <td className="px-3 py-2">סה"כ</td>
              <td className="px-3 py-2 text-left tabular-nums">{money(t.inc)}</td><td />
              <td className="px-3 py-2 text-left tabular-nums">{money(t.sInc)}</td>
              <td className="px-3 py-2 text-left tabular-nums">{money(t.exp)}</td><td />
              <td className="px-3 py-2 text-left tabular-nums">{money(t.sExp)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
