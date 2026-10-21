import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { TextCell } from '@/components/budget/InlineCells'
import { Empty, ErrorBox, Kpi, Loading } from '@/components/bagrut/ui'
import { fetchOrderNotes, fetchOrders, saveOrderNote, type BudgetOrder, type OrderNote } from '@/lib/budget'
import { money } from '@/lib/budgetCalc'
import { useBudget } from './context'

interface OrderRow {
  order: BudgetOrder
  note: OrderNote | null
}

/**
 * הרכש — הזמנות מ-EPR (המקבילה של "רכש – טופס ניהול פעולות רכש" באקסס).
 * הזמנה מאושרת היא כסף תפוס: היא יורדת מיתרת הכרטיס כ"שריון" עוד לפני
 * שהחשבונית הגיעה. ההזמנה עצמה באה מהקובץ; החשבונית, גפ"ן, תב"ר וההערות
 * הם שכבת המשתמש — נערכים כאן ואינם נדרסים בקליטה.
 */
export default function BudgetOrders() {
  const b = useBudget()
  const { search } = useLocation()
  const [orders, setOrders] = useState<BudgetOrder[] | null>(null)
  const [notes, setNotes] = useState<Map<string, OrderNote>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setOrders(null)
    Promise.all([fetchOrders(b.code), fetchOrderNotes(b.code)])
      .then(([o, n]) => {
        setOrders(o)
        setNotes(new Map(n.map((x) => [x.order_no, x])))
      })
      .catch((e: Error) => setError(e.message))
  }, [b.code])

  const cardName = useMemo(() => new Map(b.rows.map((r) => [r.code, r.name])), [b.rows])
  const rows: OrderRow[] = useMemo(() => (orders ?? []).map((order) => ({ order, note: notes.get(order.order_no) ?? null })), [orders, notes])

  if (error) return <ErrorBox message={error} />
  if (orders == null) return <Loading label="טוען את הזמנות הרכש…" />
  if (orders.length === 0) {
    return (
      <Empty title="דוח הזמנות הרכש עוד לא נקלט">
        מפיקים מ-EPR את דוח ההזמנות ומעלים אותו במסך הקליטה, יחד עם שני דוחות הכרטסת או בנפרד.
        עד אז, ה"שריון" בכרטסת מראה את סכום ההזמנות המאושרות בכל כרטיס.
      </Empty>
    )
  }

  const save = (r: OrderRow, patch: Partial<OrderNote>, label: string) => async () => {
    setSaveError(null)
    try {
      const saved = await saveOrderNote(b.code, r.order.order_no, patch, r.note)
      setNotes((m) => new Map(m).set(saved.order_no, saved))
    } catch (e) {
      setSaveError(`${label} בהזמנה ${r.order.order_no}: ${(e as Error).message}`)
      throw e
    }
  }
  const check = (r: OrderRow, key: 'invoice_received' | 'in_gefen' | 'in_tabar', label: string) => (
    <input type="checkbox" disabled={!b.canManage} checked={Boolean(r.note?.[key])} className="accent-emerald-600"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => save(r, { [key]: e.target.checked }, label)().catch(() => undefined)} />
  )
  const date = (d: string | null) => (d ? new Date(d).toLocaleDateString('he-IL') : '')

  const columns: Column<OrderRow>[] = [
    { key: 'no', header: 'הזמנה', width: 100, sticky: true, render: (r) => <span className="font-mono text-xs" dir="ltr">{r.order.order_no}</span>, sortValue: (r) => r.order.order_no, exportValue: (r) => r.order.order_no },
    { key: 'date', header: 'תאריך', width: 90, render: (r) => date(r.order.order_date), sortValue: (r) => r.order.order_date, exportValue: (r) => date(r.order.order_date) },
    { key: 'supplier', header: 'ספק', width: 170, render: (r) => <span className="truncate">{r.order.supplier_name}</span>, sortValue: (r) => r.order.supplier_name },
    { key: 'details', header: 'פרטים', width: 220, render: (r) => <span className="truncate text-slate-600">{r.order.details}</span>, sortValue: (r) => r.order.details },
    { key: 'amount', header: 'סכום', width: 100, render: (r) => <span className="tabular-nums">{money(r.order.amount)}</span>, sortValue: (r) => r.order.amount, exportValue: (r) => r.order.amount, filter: false },
    { key: 'open', header: 'לא סופק', width: 90, render: (r) => <span className="tabular-nums text-slate-500">{money(r.order.not_supplied)}</span>, sortValue: (r) => r.order.not_supplied, exportValue: (r) => r.order.not_supplied, filter: false },
    { key: 'status', header: 'מצב', width: 110, render: (r) => <span className="truncate">{r.order.status}</span>, sortValue: (r) => r.order.status },
    { key: 'approver', header: 'מאשר הבא', width: 120, render: (r) => <span className="truncate text-slate-600">{r.order.next_approver}</span>, sortValue: (r) => r.order.next_approver },
    {
      key: 'card', header: 'כרטיס', width: 170,
      render: (r) => r.order.card_code ? (
        <Link to={`${b.base}/card/${r.order.card_code}${search}`} onClick={(e) => e.stopPropagation()} className="truncate text-emerald-700 hover:underline">
          {cardName.get(r.order.card_code) ?? r.order.card_name ?? r.order.card_code}
        </Link>
      ) : '',
      sortValue: (r) => r.order.card_code, exportValue: (r) => r.order.card_code,
    },
    { key: 'inv', header: 'חשבונית', width: 70, render: (r) => check(r, 'invoice_received', 'חשבונית'), sortValue: (r) => (r.note?.invoice_received ? 1 : 0), exportValue: (r) => (r.note?.invoice_received ? 'כן' : '') },
    { key: 'gefen', header: 'גפ"ן', width: 56, render: (r) => check(r, 'in_gefen', 'גפ"ן'), sortValue: (r) => (r.note?.in_gefen ? 1 : 0), exportValue: (r) => (r.note?.in_gefen ? 'כן' : '') },
    { key: 'tabar', header: 'תב"ר', width: 56, render: (r) => check(r, 'in_tabar', 'תב"ר'), sortValue: (r) => (r.note?.in_tabar ? 1 : 0), exportValue: (r) => (r.note?.in_tabar ? 'כן' : '') },
    {
      key: 'notes', header: 'הערות פנימיות', width: 200, filter: false,
      render: (r) => <TextCell value={r.note?.notes ?? null} listId="budget-order-notes" disabled={!b.canManage}
        onSave={(v) => save(r, { notes: v }, 'הערות')()} />,
      sortValue: (r) => r.note?.notes ?? null,
    },
  ]

  const open = orders.reduce((s, o) => s + (o.not_supplied ?? 0), 0)
  const noInvoice = rows.filter((r) => !r.note?.invoice_received).length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <h1 className="text-lg font-bold text-slate-800">רכש — הזמנות</h1>
      <div className="flex flex-wrap gap-3">
        <Kpi value={orders.length.toLocaleString('he-IL')} label="הזמנות" sub={`${money(orders.reduce((s, o) => s + (o.amount ?? 0), 0))} ₪ סה"כ`} />
        <Kpi value={money(open)} label="טרם סופק" tone="amber" sub="סכום 'לא סופק' — כסף תפוס" />
        <Kpi value={noInvoice.toLocaleString('he-IL')} label="בלי חשבונית" tone={noInvoice ? 'amber' : 'green'} sub="לפי הסימון כאן" />
      </div>
      {saveError && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{saveError}</p>}
      <BagrutTable rows={rows} columns={columns} rowKey={(r) => r.order.order_no} exportName={`רכש_${b.authorityName || b.code}`}
        sheetName="הזמנות" countLabel="הזמנות" initialSort={{ key: 'date', dir: 'desc' }} storageKey="budget-orders" />
    </div>
  )
}
