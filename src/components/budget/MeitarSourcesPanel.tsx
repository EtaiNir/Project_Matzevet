import { useEffect, useState } from 'react'
import { deleteMeitarEntity, fetchMeitarEntities, saveMeitarEntity, type EntityKind, type MeitarEntity } from '@/lib/meitar'

/**
 * מקורות המיתר של רשות (החלטה 024) — המועצה (סמל מוטב) ובתי הספר (סמל מוסד)
 * שהסוכן מוריד להם את קובצי המיתר מאתר המשרד. עורך: מנהל־על (RLS).
 *
 * ה-ZIP של בית ספר הוא תת-קבוצה של ה-ZIP של המועצה: כשהמועצה רשומה, ממנו
 * נשמר רק הסיכום הרשמי. בית ספר בלי מועצה רשומה — נקלט במלואו.
 */
export default function MeitarSourcesPanel({ code }: { code: string }) {
  const [list, setList] = useState<MeitarEntity[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ code: '', kind: 'mosad' as EntityKind, name: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchMeitarEntities(code).then(setList).catch((e: Error) => setError(e.message))
  }, [code])

  const apply = (saved: MeitarEntity) =>
    setList((l) => [...(l ?? []).filter((x) => x.entity_code !== saved.entity_code), saved]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'he')))

  async function update(e: MeitarEntity, patch: Partial<MeitarEntity>) {
    setError(null)
    try {
      apply(await saveMeitarEntity(code, e.entity_code, { kind: e.kind, name: e.name, auto_download: e.auto_download,
        sort_order: e.sort_order, active: e.active, ...patch }))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function add() {
    setBusy(true)
    setError(null)
    try {
      apply(await saveMeitarEntity(code, form.code, { kind: form.kind, name: form.name.trim(), auto_download: true,
        sort_order: form.kind === 'moteb' ? 0 : 100, active: true }))
      setForm({ code: '', kind: 'mosad', name: '' })
      setAdding(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(e: MeitarEntity) {
    if (!confirm(`להסיר את «${e.name}» ממקורות המיתר? הנתונים שכבר נקלטו נשארים.`)) return
    setError(null)
    try {
      await deleteMeitarEntity(code, e.entity_code)
      setList((l) => (l ?? []).filter((x) => x.entity_code !== e.entity_code))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const codeOk = form.kind === 'moteb' ? /^\d{5,9}$/.test(form.code) : /^\d{6}$/.test(form.code)
  const input = 'rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none'

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-1 font-bold text-emerald-800">מקורות המיתר</h3>
      <p className="mb-3 text-sm text-slate-500">
        הסוכן מוריד כל חודש מאתר המיתר של המשרד את הקובץ של כל מקור עם הורדה אוטומטית. המועצה — לפי סמל מוטב;
        בית ספר — לפי סמל מוסד (מהקובץ שלו נשמר הסיכום הרשמי, השורות כבר בקובץ המועצה).
      </p>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {list == null ? <p className="text-sm text-slate-400">טוען…</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-right text-slate-500">
              <th className="py-1 font-semibold">שם</th>
              <th className="py-1 font-semibold">סוג</th>
              <th className="py-1 font-semibold">סמל</th>
              <th className="py-1 font-semibold">הורדה אוטומטית</th>
              <th className="py-1 font-semibold">פעיל</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.entity_code} className={`border-b border-slate-100 ${e.active ? '' : 'opacity-50'}`}>
                <td className="py-1.5 font-medium text-slate-800">{e.name}</td>
                <td className="py-1.5 text-slate-600">{e.kind === 'moteb' ? 'מועצה (מוטב)' : 'בית ספר (מוסד)'}</td>
                <td className="py-1.5 font-mono text-xs text-slate-500" dir="ltr">{e.entity_code}</td>
                <td className="py-1.5"><input type="checkbox" checked={e.auto_download} onChange={(x) => update(e, { auto_download: x.target.checked })} className="accent-emerald-600" /></td>
                <td className="py-1.5"><input type="checkbox" checked={e.active} onChange={(x) => update(e, { active: x.target.checked })} className="accent-emerald-600" /></td>
                <td className="py-1.5 text-left"><button onClick={() => remove(e)} className="rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="הסרה">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {adding ? (
        <form onSubmit={(e) => { e.preventDefault(); if (codeOk && form.name.trim()) add() }}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border-2 border-dashed border-emerald-300 p-3">
          <label className="text-xs font-semibold text-slate-600">סוג
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as EntityKind })} className={`${input} mt-1 block`}>
              <option value="mosad">בית ספר (סמל מוסד)</option>
              <option value="moteb">מועצה (סמל מוטב)</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">סמל
            <input dir="ltr" inputMode="numeric" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })}
              placeholder={form.kind === 'moteb' ? '12300141' : '360123'} className={`${input} mt-1 block w-28 font-mono`} />
          </label>
          <label className="text-xs font-semibold text-slate-600">שם
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${input} mt-1 block w-48`} />
          </label>
          <button disabled={busy || !codeOk || !form.name.trim()} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">הוספה</button>
          <button type="button" onClick={() => setAdding(false)} className="px-2 py-1.5 text-sm text-slate-500">ביטול</button>
          {form.code && !codeOk && <span className="w-full text-xs text-amber-700">{form.kind === 'moteb' ? 'סמל מוטב — ספרות בלבד' : 'סמל מוסד הוא 6 ספרות'}</span>}
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-3 rounded-lg border border-dashed border-emerald-400 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50">+ מקור</button>
      )}
    </section>
  )
}
