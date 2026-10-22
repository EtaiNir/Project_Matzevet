import { Fragment, useEffect, useMemo, useState } from 'react'
import { money } from '@/lib/budgetCalc'
import {
  applyScenario,
  BASE_SOURCE_LABELS,
  CARD_SIDE_LABELS,
  cardSide,
  parseCardInput,
  scenarioBase,
  type ScenarioCard,
  type ScenarioInputs,
} from '@/lib/budgetInsights'
import { useBudget } from './context'

const EMPTY: ScenarioInputs = { categories: {}, cards: {} }

/**
 * תרחישים לשנה הבאה (024, רעיון 6): "מה אם" — ומיד רואים את הגרעון או העודף.
 *   · לכל קטגוריה 1, ולכולן יחד — שינוי באחוזים להכנסות ולהוצאות.
 *   · לחיצה על קטגוריה פותחת את הכרטיסים שבה — הבסיס של כל אחד ומאיפה הוא נלקח,
 *     ולכל כרטיס אפשר להקליד שינוי משלו: אחוז ("+20%", נוסף על הקטגוריה), או
 *     סכום שמחליף את הבסיס ("150,000"; 0 — הכרטיס נסגר).
 * **לא נשמר בתכנית** — רק בדפדפן של מי שבודק; התכנית האמיתית לא נוגעת.
 * החישוב — applyScenario ב-lib/budgetInsights.
 */
export default function BudgetScenarios() {
  const b = useBudget()
  const storeKey = `budget-scenario-v2:${b.code}:${b.year}`
  const [inputs, setInputs] = useState<ScenarioInputs>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as ScenarioInputs | null
      return saved?.categories && saved?.cards ? saved : EMPTY
    } catch {
      return EMPTY
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(inputs))
    } catch {
      /* מצב פרטי — התרחיש פשוט לא יישמר */
    }
  }, [inputs, storeKey])
  const [open, setOpen] = useState<Set<string>>(new Set())

  const { groups, fromPlan, fromForecast } = useMemo(() => scenarioBase(b.rows), [b.rows])
  const result = useMemo(() => applyScenario(groups, inputs), [groups, inputs])
  const base = groups.reduce((s, g) => ({ inc: s.inc + g.income, exp: s.exp + g.expense }), { inc: 0, exp: 0 })
  const changedCards = [...result.groups.values()].reduce((n, g) => n + g.changedCards, 0)
  const changed = changedCards > 0 || Object.values(inputs.categories).some((v) => v.inc || v.exp)

  const setPct = (key: string, side: 'inc' | 'exp', v: string) =>
    setInputs((s) => ({ ...s, categories: { ...s.categories, [key]: { inc: s.categories[key]?.inc ?? 0, exp: s.categories[key]?.exp ?? 0, [side]: Number(v) || 0 } } }))
  const setCard = (code: string, side: 'inc' | 'exp', v: string) =>
    setInputs((s) => {
      const cur = { ...s.cards[code], [side]: v }
      const cards = { ...s.cards }
      if (!cur.inc && !cur.exp) delete cards[code]
      else cards[code] = cur
      return { ...s, cards }
    })
  const toggle = (key: string) => setOpen((o) => {
    const n = new Set(o)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    return n
  })

  const pctInput = (key: string, side: 'inc' | 'exp') => (
    <input type="number" step={1} value={inputs.categories[key]?.[side] || ''} placeholder="0" onChange={(e) => setPct(key, side, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-center tabular-nums focus:border-emerald-400 focus:outline-none" dir="ltr" />
  )
  const cardInput = (c: ScenarioCard, side: 'inc' | 'exp') => {
    const ok = side === 'inc' ? c.isIncome : c.isExpense
    if (!ok) return <span className="text-slate-300">—</span>
    const raw = inputs.cards[c.code]?.[side] ?? ''
    const parsed = parseCardInput(raw)
    const bad = parsed != null && 'invalid' in parsed
    return (
      <input value={raw} placeholder="% או סכום" onChange={(e) => setCard(c.code, side, e.target.value)} dir="ltr"
        title='אחוז — "+20%" או "-5%" (נוסף על הקטגוריה); סכום — "150,000" (מחליף את הבסיס); 0 — הכרטיס נסגר'
        className={`w-24 rounded border px-1.5 py-0.5 text-center text-xs tabular-nums focus:outline-none ${bad ? 'border-red-400 bg-red-50' : raw ? 'border-violet-400 bg-violet-50' : 'border-slate-200'} focus:border-emerald-400`} />
    )
  }
  // אפס מוצג כאפס — לא תא ריק שנראה כמו נתון חסר
  const amt = (n: number, tone: string) => <span className={`tabular-nums ${Math.round(n) ? tone : 'text-slate-300'}`}>{money(n)}</span>
  const balance = (inc: number, exp: number) => {
    const g = inc - exp
    return <span className={`tabular-nums font-bold ${g < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{g < 0 ? 'גרעון ' : 'עודף '}{money(Math.abs(g))}</span>
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold text-slate-800">🧪 תרחישים לשנה הבאה — {b.year + 1}</h1>
        <span className="text-xs text-slate-500">לא נשמר בתכנית · רק לבדיקה</span>
        <span className="mr-auto" />
        {changed && (
          <button onClick={() => setInputs(EMPTY)} className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50">
            איפוס התרחיש{changedCards ? ` (${changedCards} כרטיסים שונו)` : ''}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        הבסיס לכל כרטיס: התכנית ל-{b.year + 1} כשהוזנה ({fromPlan} כרטיסים), אחרת הצפי לסוף השנה או התקציב ({fromForecast}).
        שינוי באחוזים — לכל קטגוריה, ובשורה הראשונה לכולן יחד. <b>לחיצה על קטגוריה</b> פותחת את הכרטיסים שבה: לכל כרטיס
        אחוז משלו ("+20%", נוסף על הקטגוריה) או סכום שמחליף את הבסיס ("150,000"; 0 — הכרטיס נסגר).
        כרטיס שאינו מסומן "הכנסה" ולא "הוצאה" בתוספתיים — נספר לפי הנתונים שלו, ומסומן.
        0 = אין בקטגוריה תקציב, צפי או תכנית בצד הזה. קטגוריה קטנה עם שם דומה לאחרת (למשל "חינוך קדם יסודי" ליד "קדם יסודי")
        — כנראה כתיב שונה בקובץ התוספתיים; כדאי לאחד אותן בקטגוריה 1.
      </p>

      <div className="flex flex-wrap gap-2 text-sm">
        <div className="rounded-xl bg-white px-4 py-2 shadow-sm ring-1 ring-slate-200">
          <div>{balance(base.inc, base.exp)}</div><div className="text-xs text-slate-500">בבסיס</div>
        </div>
        <div className={`rounded-xl px-4 py-2 shadow-sm ring-1 ${changed ? 'bg-violet-50 ring-violet-200' : 'bg-white ring-slate-200'}`}>
          <div>{balance(result.income, result.expense)}</div><div className="text-xs text-slate-500">בתרחיש</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-right font-semibold">קטגוריה 1 / כרטיס</th>
              <th className="px-3 py-2 font-semibold">כרטיסים</th>
              <th className="px-3 py-2 text-left font-semibold">הכנסות בבסיס</th>
              <th className="px-3 py-2 font-semibold">שינוי</th>
              <th className="px-3 py-2 text-left font-semibold">הכנסות בתרחיש</th>
              <th className="px-3 py-2 text-left font-semibold">הוצאות בבסיס</th>
              <th className="px-3 py-2 font-semibold">שינוי</th>
              <th className="px-3 py-2 text-left font-semibold">הוצאות בתרחיש</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100 bg-violet-50/40 font-semibold">
              <td className="px-3 py-1.5">כל הקטגוריות</td>
              <td className="px-3 py-1.5 text-center tabular-nums text-slate-500">{groups.reduce((n, g) => n + g.cards, 0)}</td>
              <td /><td className="px-3 py-1.5 text-center">{pctInput('*', 'inc')}<span className="mr-0.5 text-xs text-slate-400">%</span></td><td />
              <td /><td className="px-3 py-1.5 text-center">{pctInput('*', 'exp')}<span className="mr-0.5 text-xs text-slate-400">%</span></td><td />
            </tr>
            {groups.map((g) => {
              const r = result.groups.get(g.key)!
              const isOpen = open.has(g.key)
              return (
                <Fragment key={g.key}>
                  <tr onClick={() => toggle(g.key)} className={`cursor-pointer border-t border-slate-100 hover:bg-emerald-50/40 ${isOpen ? 'bg-emerald-50/30' : ''}`}>
                    <td className="px-3 py-1.5 text-slate-800">
                      <span className="ml-1 inline-block w-3 text-slate-400">{isOpen ? '▾' : '▸'}</span>
                      {g.label}
                      {r.changedCards > 0 && <span className="mr-2 rounded-full bg-violet-100 px-1.5 text-[11px] font-bold text-violet-800">{r.changedCards} שונו</span>}
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-slate-500">{g.cards}</td>
                    <td className="px-3 py-1.5 text-left">{amt(g.income, 'text-teal-800')}</td>
                    <td className="px-3 py-1.5 text-center">{pctInput(g.key, 'inc')}<span className="mr-0.5 text-xs text-slate-400">%</span></td>
                    <td className="px-3 py-1.5 text-left font-semibold">{amt(r.income, 'text-teal-800')}</td>
                    <td className="px-3 py-1.5 text-left">{amt(g.expense, 'text-rose-800')}</td>
                    <td className="px-3 py-1.5 text-center">{pctInput(g.key, 'exp')}<span className="mr-0.5 text-xs text-slate-400">%</span></td>
                    <td className="px-3 py-1.5 text-left font-semibold">{amt(r.expense, 'text-rose-800')}</td>
                  </tr>
                  {isOpen && g.items.map((c, i) => {
                    const cr = result.cards.get(c.code)!
                    const touched = Boolean(inputs.cards[c.code])
                    const side = cardSide(c)
                    // כותרת קטנה בתחילת כל צד — הכנסה / שני הצדדים / הוצאה
                    const head = i === 0 || cardSide(g.items[i - 1]) !== side
                    const count = g.items.filter((x) => cardSide(x) === side).length
                    return (
                      <Fragment key={c.code}>
                      {head && (
                        <tr className="bg-slate-100/70 text-[11px] font-bold text-slate-500">
                          <td colSpan={8} className="py-0.5 pr-8">
                            {CARD_SIDE_LABELS[side]} ({count})
                            {side === 'income' && <span className="mr-2 font-normal">— השינוי בעמודות ההכנסות</span>}
                            {side === 'expense' && <span className="mr-2 font-normal">— השינוי בעמודות ההוצאות</span>}
                          </td>
                        </tr>
                      )}
                      <tr className={`border-t border-slate-50 text-xs ${touched ? 'bg-violet-50/50' : 'bg-slate-50/40'}`}>
                        <td className="py-1 pl-3 pr-8">
                          <span className="font-mono text-slate-400" dir="ltr">{c.code}</span> <span className="text-slate-700">{c.name}</span>
                          {c.unflagged && (c.isIncome || c.isExpense) && (
                            <span className="mr-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700" title='בתוספתיים אינו מסומן "הכנסה" ולא "הוצאה" — הצד נקבע לפי התקציב / התכנית / הביצוע'>לא מסומן — לפי הנתונים</span>
                          )}
                          {c.unflagged && !c.isIncome && !c.isExpense && (
                            <span className="mr-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500" title='לא מסומן "הכנסה" ולא "הוצאה", ואין בו נתונים'>לא מסומן, בלי נתונים</span>
                          )}
                          {c.onlyExtras && (
                            <span className="mr-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500" title="אין לסעיף שורה בדוח הכרטיסים של הנהלת החשבונות — ייתכן שמספר הסעיף בתוספתיים שגוי">רק בתוספתיים</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-center text-[11px] text-slate-400" title="הצד, ומאיפה נלקח הבסיס">
                          {[c.isIncome && `הכנסה · ${BASE_SOURCE_LABELS[c.incomeFrom]}`, c.isExpense && `הוצאה · ${BASE_SOURCE_LABELS[c.expenseFrom]}`].filter(Boolean).join(' / ')}
                        </td>
                        <td className="px-3 py-1 text-left">{c.isIncome ? amt(c.income, 'text-teal-700') : ''}</td>
                        <td className="px-2 py-1 text-center">{cardInput(c, 'inc')}</td>
                        <td className="px-3 py-1 text-left">{c.isIncome ? amt(cr.income, 'text-teal-800') : ''}</td>
                        <td className="px-3 py-1 text-left">{c.isExpense ? amt(c.expense, 'text-rose-700') : ''}</td>
                        <td className="px-2 py-1 text-center">{cardInput(c, 'exp')}</td>
                        <td className="px-3 py-1 text-left">{c.isExpense ? amt(cr.expense, 'text-rose-800') : ''}</td>
                      </tr>
                      </Fragment>
                    )
                  })}
                </Fragment>
              )
            })}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
              <td className="px-3 py-2">סה"כ</td>
              <td />
              <td className="px-3 py-2 text-left tabular-nums">{money(base.inc)}</td><td />
              <td className="px-3 py-2 text-left tabular-nums">{money(result.income)}</td>
              <td className="px-3 py-2 text-left tabular-nums">{money(base.exp)}</td><td />
              <td className="px-3 py-2 text-left tabular-nums">{money(result.expense)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
