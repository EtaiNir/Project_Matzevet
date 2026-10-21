import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { ErrorBox, Loading } from '@/components/bagrut/ui'
import { fetchAllTransactions, type BudgetTransaction } from '@/lib/budget'
import { money, periodRange, type CardRow } from '@/lib/budgetCalc'
import { useBudget, type CardNavState } from './context'

/** תנועה עם פרטי הכרטיס שלה — הדגלים והקטגוריות מהטבלה הראשית */
interface ActionRow {
  tx: BudgetTransaction
  card: CardRow | null
}

const Flag = ({ on, tone }: { on: boolean; tone: string }) => (
  <span className={on ? `font-bold ${tone}` : 'text-slate-200'}>{on ? '✓' : '·'}</span>
)

/**
 * "מעקב ובקרת תקציב ברמת הפעולה הבודדת" — כל התנועות מדוח הפעולות של EPR,
 * שורה לכל פעולה, עם הקטגוריות והדגלים של הכרטיס. ממנה נבנה כל כרטיס:
 * הכנסות מצטבר = Σ זכות, הוצאות מצטבר = Σ חובה. מגיעים לכאן גם מכרטיס
 * ("לפירוט הפעולות" — `?card=`).
 *
 * ברירת המחדל — התקופה שנבחרה בכותרת; "כל השנים" — כמו הטופס באקסס, שמציג
 * את כל מה שבדוח (כולל יתרות פתיחה ותנועות של שנים קודמות).
 */
export default function BudgetActions() {
  const b = useBudget()
  const navigate = useNavigate()
  const { search } = useLocation()
  const [params, setParams] = useSearchParams()
  const card = params.get('card')
  const all = params.get('span') === 'all'

  const [tx, setTx] = useState<BudgetTransaction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setTx(null)
    setError(null)
    // טוענים הכול פעם אחת (נשמר בזיכרון) ומסננים כאן — המעבר בין התקופות מיידי
    fetchAllTransactions(b.code, null, null)
      .then((t) => alive && setTx(t))
      .catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [b.code])

  const byCode = useMemo(() => new Map(b.rows.map((r) => [r.code, r])), [b.rows])
  const range = periodRange(b.year, b.period)
  const rows: ActionRow[] = useMemo(() => {
    if (!tx) return []
    return tx
      .filter((t) => (!card || t.card_code === card)
        && (all || (t.event_date != null && t.event_date >= range.from && t.event_date < range.to)))
      .map((t) => ({ tx: t, card: byCode.get(t.card_code) ?? null }))
  }, [tx, card, all, range.from, range.to, byCode])

  // הצלבה: ביצוע הכרטיס בדוח הכרטיסים = Σ(זכות − חובה) בתנועות של השנה הקלנדרית.
  // אותה בדיקה שהקליטה עושה — כאן היא מוצגת מול מה שבמסד.
  const check = useMemo(() => {
    if (!tx) return null
    const sums = new Map<string, number>()
    for (const t of tx) {
      if (!t.event_date || Number(t.event_date.slice(0, 4)) !== b.year) continue
      sums.set(t.card_code, (sums.get(t.card_code) ?? 0) + (t.credit ?? 0) - (t.debit ?? 0))
    }
    const withCard = b.rows.filter((r) => r.card && (!card || r.code === card))
    const off = withCard.filter((r) => Math.abs((r.card!.executed ?? 0) - (sums.get(r.code) ?? 0)) >= 1)
    return { checked: withCard.length, off }
  }, [tx, b.rows, b.year, card])

  const setParam = (k: string, v: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (v) next.set(k, v)
      else next.delete(k)
      return next
    }, { replace: true })

  const date = (d: string | null) => (d ? new Date(d).toLocaleDateString('he-IL') : '')
  const columns: Column<ActionRow>[] = [
    { key: 'code', header: 'מספר הסעיף', width: 108, sticky: true, render: (r) => <span className="font-mono text-xs text-slate-500" dir="ltr">{r.tx.card_code}</span>, sortValue: (r) => r.tx.card_code, exportValue: (r) => r.tx.card_code },
    { key: 'name', header: 'תאור סעיף', width: 190, render: (r) => <span className="truncate text-slate-800">{r.card?.name || r.tx.card_name}</span>, sortValue: (r) => r.card?.name || r.tx.card_name },
    { key: 'isExp', header: 'הוצאה', width: 50, align: 'center', render: (r) => <Flag on={Boolean(r.card?.isExpense)} tone="text-rose-700" />, sortValue: (r) => (r.card?.isExpense ? 1 : 0), exportValue: (r) => (r.card?.isExpense ? 'כן' : '') },
    { key: 'isInc', header: 'הכנסה', width: 50, align: 'center', render: (r) => <Flag on={Boolean(r.card?.isIncome)} tone="text-teal-700" />, sortValue: (r) => (r.card?.isIncome ? 1 : 0), exportValue: (r) => (r.card?.isIncome ? 'כן' : '') },
    {
      key: 'date', header: 'תאריך אירוע', width: 96,
      render: (r) => (r.tx.is_opening ? <span className="text-xs font-semibold text-slate-500">יתרת פתיחה</span> : date(r.tx.event_date)),
      sortValue: (r) => r.tx.event_date ?? '', exportValue: (r) => (r.tx.is_opening ? 'יתרת פתיחה' : date(r.tx.event_date)),
    },
    { key: 'credit', header: 'הכנסות (זכות)', width: 108, render: (r) => <span className="tabular-nums text-teal-800">{r.tx.credit ? money(r.tx.credit) : ''}</span>, sortValue: (r) => r.tx.credit, exportValue: (r) => r.tx.credit, filter: false },
    { key: 'debit', header: 'הוצאות (חובה)', width: 108, render: (r) => <span className="tabular-nums text-rose-800">{r.tx.debit ? money(r.tx.debit) : ''}</span>, sortValue: (r) => r.tx.debit, exportValue: (r) => r.tx.debit, filter: false },
    { key: 'details', header: 'פרטים', width: 250, render: (r) => <span className="truncate" title={r.tx.details ?? ''}>{r.tx.details}</span>, sortValue: (r) => r.tx.details },
    { key: 'counter', header: 'חשבון נגדי', width: 150, render: (r) => <span className="truncate text-slate-600">{r.tx.counter_name ?? r.tx.counter_account ?? ''}</span>, sortValue: (r) => r.tx.counter_name ?? r.tx.counter_account },
    { key: 'voucher', header: 'פקודה', width: 96, render: (r) => <span className="font-mono text-xs text-slate-500" dir="ltr">{r.tx.voucher}</span>, sortValue: (r) => r.tx.voucher },
    { key: 'ref1', header: 'אסמכתא', width: 96, render: (r) => <span className="font-mono text-xs text-slate-500" dir="ltr">{r.tx.ref1 === '0' ? '' : r.tx.ref1}</span>, sortValue: (r) => r.tx.ref1 },
    { key: 'cat1', header: 'קטגוריה 1', width: 120, render: (r) => <span className="truncate text-slate-600">{r.card?.meta?.category1 ?? ''}</span>, sortValue: (r) => r.card?.meta?.category1 ?? null },
    { key: 'cat2', header: 'קטגוריה 2', width: 110, render: (r) => <span className="truncate text-slate-600">{r.card?.meta?.category2 ?? ''}</span>, sortValue: (r) => r.card?.meta?.category2 ?? null },
    { key: 'cat3', header: 'קטגוריה 3', width: 110, render: (r) => <span className="truncate text-slate-600">{r.card?.meta?.category3 ?? ''}</span>, sortValue: (r) => r.card?.meta?.category3 ?? null },
    { key: 'topic', header: 'נושא במיתר', width: 76, render: (r) => <span className="font-mono text-xs text-violet-700">{r.tx.meitar_topic ?? ''}</span>, sortValue: (r) => r.tx.meitar_topic },
  ]

  const openCard = (r: ActionRow) => {
    if (!r.card) return
    const nav: CardNavState = { codes: [r.card.code], fromLabel: 'פירוט הפעולות', backTo: `${b.base}/actions${search}` }
    const keep = new URLSearchParams(search)
    keep.delete('card')
    keep.delete('span')
    navigate(`${b.base}/card/${r.card.code}${keep.size ? `?${keep}` : ''}`, { state: nav })
  }

  const cardRow = card ? byCode.get(card) : null
  const periodLabel = b.period === 'calendar' ? `ינואר–דצמבר ${b.year}` : `ספט׳ ${b.year - 1}–אוג׳ ${b.year}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h1 className="text-lg font-bold text-slate-800">מעקב ובקרה ברמת הפעולה הבודדת</h1>
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {([[null, periodLabel], ['all', 'כל השנים']] as [string | null, string][]).map(([k, label]) => (
            <button key={label} onClick={() => setParam('span', k)}
              className={`rounded-md px-2.5 py-0.5 font-semibold ${(k === 'all') === all ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>
          ))}
        </div>
        {card && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-600 py-0.5 pl-1 pr-2.5 text-xs font-semibold text-white">
            כרטיס {card}{cardRow?.name ? ` · ${cardRow.name}` : ''}
            <button onClick={() => setParam('card', null)} className="rounded-full px-1 hover:bg-emerald-700" title="כל הכרטיסים">✕</button>
          </span>
        )}
        {card && cardRow && (
          <Link to={`${b.base}/card/${card}?${new URLSearchParams([...params].filter(([k]) => k === 'year' || k === 'period'))}`}
            className="text-emerald-700 hover:underline">לכרטיס ←</Link>
        )}
        <span className="mr-auto" />
        {check && check.checked > 0 && (
          <span title={check.off.length ? `לא מתיישבים: ${check.off.slice(0, 10).map((r) => r.code).join(', ')}${check.off.length > 10 ? '…' : ''}` : undefined}
            className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${check.off.length ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
            {check.off.length
              ? `⚠ ${check.off.length} מתוך ${check.checked} כרטיסים: הפעולות אינן מסתכמות לביצוע בדוח הכרטיסים`
              : `✓ הפעולות מסתכמות לביצוע בדוח הכרטיסים (${check.checked} כרטיסים, ${b.year})`}
          </span>
        )}
      </div>
      {error ? <ErrorBox message={error} /> : tx == null ? <Loading label="טוען את כל התנועות…" /> : (
        <BagrutTable
          rows={rows}
          columns={columns}
          rowKey={(r) => String(r.tx.id)}
          onRowClick={openCard}
          exportName={`פעולות_${card ?? b.authorityName ?? b.code}_${all ? 'כל_השנים' : b.year}`}
          sheetName="פעולות"
          empty="אין פעולות בתקופה"
          countLabel="פעולות"
          rowTitle={(r) => `${r.tx.card_code} · ${r.tx.details ?? ''}`}
          initialSort={{ key: 'date', dir: 'asc' }}
          storageKey="budget-actions"
          summary={(shown) => <Summary rows={shown} />}
        />
      )}
    </div>
  )
}

/** הסיכום בתחתית — כמו בטופס באקסס: מספר הפעולות, Σ זכות, Σ חובה, ויתרה/גרעון */
function Summary({ rows }: { rows: ActionRow[] }) {
  let credit = 0
  let debit = 0
  for (const r of rows) {
    credit += r.tx.credit ?? 0
    debit += r.tx.debit ?? 0
  }
  const gap = credit - debit
  const cell = (label: string, value: string, tone = 'text-slate-800') => (
    <div className="min-w-[7.5rem] rounded-lg bg-white px-3 py-1.5 ring-1 ring-slate-200">
      <div className={`text-sm font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-bold text-slate-600">סה"כ · {rows.length.toLocaleString('he-IL')} פעולות</span>
      {cell('הכנסות (Σ זכות)', money(credit), 'text-teal-800')}
      {cell('הוצאות (Σ חובה)', money(debit), 'text-rose-800')}
      {cell(gap < 0 ? 'גרעון ביצוע' : 'יתרה בביצוע', money(Math.abs(gap)), gap < 0 ? 'text-red-700' : 'text-emerald-700')}
    </div>
  )
}
