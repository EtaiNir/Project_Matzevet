import { useEffect, useState } from 'react'
import {
  createExtraColumn,
  extraFieldKey,
  deleteExtraColumn,
  fetchTrashedColumns,
  renameExtraColumn,
  restoreExtraColumn,
  type ExtraColumn,
  type ExtraColumnType,
  type TrashedColumn,
} from '@/lib/extraColumns'

interface Props {
  code: string
  authorityName: string
  columns: ExtraColumn[]
  /** כמה תלמידים מחזיקים ערך בכל עמודה — מחושב מהנתונים שכבר בזיכרון */
  usage: Record<string, number>
  /** האם המשתמש רשאי ליצור ולמחוק עמודות (מנהל רשות ומעלה) */
  canManage: boolean
  /** נקרא אחרי כל שינוי, כדי שהטבלה תיטען מחדש */
  onChanged: () => Promise<void> | void
  /** עמודה חדשה נוצרה — כדי שתופיע בטבלה מיד ולא רק בבורר השדות */
  onCreated?: (fieldKey: string) => void
  /** להיפתח ישר על טופס ההוספה — כשמגיעים מכפתור ה-+ שבכותרת הטבלה */
  startAdding?: boolean
  /** מזהה הטבלה הייעודית הפתוחה, אם נמצאים בתוך אחת */
  viewId?: string | null
  viewName?: string
  onClose: () => void
}

function he(date: string) {
  return new Date(date).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })
}

/**
 * ניהול העמודות שהמשתמש מוסיף.
 *
 * זה המסך **היחיד** שבו עמודה שנמחקה מופיעה בכלל. בכל שאר המערכת —
 * בטבלה, בבורר השדות, בייצוא, בפיבוט — עמודה או שקיימת או שלא, ואין
 * מצב ביניים. ראה docs/extra-fields-design.md.
 */
export default function ExtraColumnsManager({
  code,
  authorityName,
  columns,
  usage,
  canManage,
  onChanged,
  onCreated,
  startAdding = false,
  viewId = null,
  viewName,
  onClose,
}: Props) {
  const [trash, setTrash] = useState<TrashedColumn[]>([])
  const [trashOpen, setTrashOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // טופס הוספה
  const [adding, setAdding] = useState(startAdding)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<ExtraColumnType>('checkbox')
  /**
   * היכן העמודה תופיע. בתוך טבלה ייעודית ברירת המחדל היא "רק כאן":
   * עמודה כמו "קו הסעה" חסרת משמעות אצל 7,900 תלמידים שאינם ברשימה,
   * והוספתה לכולם רק מנפחת את בורר השדות ואת הייצוא.
   */
  const [newScope, setNewScope] = useState<'view' | 'authority'>('view')

  // שינוי שם
  const [editing, setEditing] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')

  // אישור מחיקה — נפתח רק אחרי לחיצה, ומציג את מספר הערכים
  const [confirming, setConfirming] = useState<ExtraColumn | null>(null)
  const [typed, setTyped] = useState('')

  /** פס הביטול שמופיע מיד אחרי מחיקה — התיקון המהיר ללחיצה בטעות */
  const [undo, setUndo] = useState<{ id: string; label: string; values: number } | null>(null)

  async function reloadTrash() {
    setTrash(await fetchTrashedColumns(code))
  }

  useEffect(() => {
    reloadTrash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    run(async () => {
      const created = await createExtraColumn(
        code,
        newLabel,
        newType,
        viewId && newScope === 'view' ? viewId : null,
      )
      setNewLabel('')
      setAdding(false)
      await onChanged()
      onCreated?.(extraFieldKey(created.id))
    })

  const rename = (id: string) =>
    run(async () => {
      await renameExtraColumn(id, draftLabel)
      setEditing(null)
      await onChanged()
    })

  const confirmDelete = () =>
    run(async () => {
      const col = confirming!
      const res = await deleteExtraColumn(col.id)
      setConfirming(null)
      setTyped('')
      setUndo({ id: col.id, label: res.label, values: res.values })
      await Promise.all([onChanged(), reloadTrash()])
    })

  const restore = (id: string) =>
    run(async () => {
      await restoreExtraColumn(id)
      setUndo(null)
      await Promise.all([onChanged(), reloadTrash()])
    })

  const inputClass =
    'rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300'

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="thin-scrollbar flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-sky-800">העמודות שלי</h2>
            <p className="text-sm text-slate-500">
              {authorityName || `רשות ${code}`} · נשמרות בעדכון החודשי ואינן נדרסות
            </p>
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="space-y-4 p-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">שגיאה: {error}</p>
          )}

          {/* ביטול מיידי — מי שלחץ בטעות מתקן תוך שתי שניות, בלי להגיע לסל */}
          {undo && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
              <span>
                «{undo.label}» נמחקה
                {undo.values > 0 && ` — ${undo.values.toLocaleString('he-IL')} ערכים`}
              </span>
              <button
                onClick={() => restore(undo.id)}
                disabled={busy}
                className="rounded border border-amber-400 bg-white px-3 py-0.5 font-medium hover:bg-amber-100"
              >
                שחזור
              </button>
            </div>
          )}

          {/* ── רשימת העמודות ── */}
          {columns.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
              עדיין לא הוספת עמודות.
              <br />
              עמודת סימון מסמנת תלמידים לרשימה; עמודת טקסט מוסיפה הערה.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {columns.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    title={c.type === 'checkbox' ? 'תיבת סימון' : 'טקסט'}
                    className="w-6 shrink-0 text-center text-slate-400"
                  >
                    {c.type === 'checkbox' ? '☑' : 'Aa'}
                  </span>

                  {editing === c.id ? (
                    <input
                      autoFocus
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rename(c.id)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      onBlur={() => rename(c.id)}
                      className={inputClass + ' flex-1'}
                    />
                  ) : (
                    <span className="flex-1 font-medium text-slate-800">
                      {c.label}
                      {c.view_id && (
                        <span
                          title={`מופיעה רק בטבלה הייעודית${viewName ? ` «${viewName}»` : ''}`}
                          className="mr-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-normal text-sky-700"
                        >
                          רק כאן
                        </span>
                      )}
                    </span>
                  )}

                  <span className="shrink-0 text-sm text-slate-400">
                    {(usage[c.id] ?? 0).toLocaleString('he-IL')} ערכים
                  </span>

                  {canManage && editing !== c.id && (
                    <>
                      <button
                        onClick={() => {
                          setEditing(c.id)
                          setDraftLabel(c.label)
                        }}
                        title="שינוי שם"
                        className="rounded px-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-700"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => {
                          setConfirming(c)
                          setTyped('')
                        }}
                        title="מחיקה"
                        className="rounded px-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        🗑
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* ── אישור מחיקה: החיכוך משתנה לפי מה שעומד על הפרק ── */}
          {confirming && (
            <div className="rounded-xl border border-red-300 bg-red-50/60 p-4 text-sm">
              <p className="font-bold text-red-800">מחיקת «{confirming.label}»</p>
              {(usage[confirming.id] ?? 0) === 0 ? (
                <p className="mt-1 text-slate-700">העמודה ריקה — אין בה ערכים.</p>
              ) : (
                <>
                  <p className="mt-1 text-slate-700">
                    העמודה מכילה ערכים ל־
                    <strong>{(usage[confirming.id] ?? 0).toLocaleString('he-IL')} תלמידים</strong>.
                    היא תיעלם מהטבלה, מהייצוא ומהמסכים שמשתמשים בה.
                  </p>
                  <label className="mt-3 block">
                    <span className="text-slate-600">
                      לאישור, הקלד את שם העמודה: <strong>{confirming.label}</strong>
                    </span>
                    <input
                      autoFocus
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      className={inputClass + ' mt-1 w-full max-w-xs'}
                    />
                  </label>
                </>
              )}
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={confirmDelete}
                  disabled={
                    busy ||
                    ((usage[confirming.id] ?? 0) > 0 && typed.trim() !== confirming.label)
                  }
                  className="rounded-lg bg-red-600 px-4 py-1.5 font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
                >
                  מחיקה
                </button>
                <button onClick={() => setConfirming(null)} className="text-slate-500 hover:text-slate-800">
                  ביטול
                </button>
                <span className="mr-auto text-xs text-slate-500">ניתן יהיה לשחזר במשך 90 יום</span>
              </div>
            </div>
          )}

          {/* ── הוספה ── */}
          {canManage &&
            (adding ? (
              <div className="flex flex-wrap items-end gap-3 rounded-xl border-2 border-sky-200 bg-sky-50/50 p-4">
                <label className="block">
                  <span className="mb-1 block text-sm text-slate-600">שם העמודה</span>
                  <input
                    autoFocus
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && newLabel.trim() && add()}
                    placeholder="זכאי הסעה"
                    className={inputClass + ' w-56'}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-slate-600">סוג</span>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as ExtraColumnType)}
                    className={inputClass}
                  >
                    <option value="checkbox">תיבת סימון</option>
                    <option value="text">טקסט</option>
                  </select>
                </label>
                {viewId && (
                  <label className="block">
                    <span className="mb-1 block text-sm text-slate-600">היכן תופיע</span>
                    <select
                      value={newScope}
                      onChange={(e) => setNewScope(e.target.value as 'view' | 'authority')}
                      className={inputClass}
                    >
                      <option value="view">
                        רק בטבלה הזו{viewName ? ` — ${viewName}` : ''}
                      </option>
                      <option value="authority">בכל המערכת</option>
                    </select>
                  </label>
                )}
                <button
                  onClick={add}
                  disabled={busy || !newLabel.trim()}
                  className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-40"
                >
                  הוספה
                </button>
                <button onClick={() => setAdding(false)} className="py-1.5 text-sm text-slate-500">
                  ביטול
                </button>
                {viewId && (
                  <p className="w-full text-xs text-slate-500">
                    {newScope === 'view'
                      ? 'העמודה תופיע רק כאן — לא בטבלה הראשית ולא בטבלאות ייעודיות אחרות.'
                      : 'העמודה תופיע אצל כל תלמידי הרשות, בכל המסכים ובייצוא.'}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setAdding(true)}
                  className="rounded-lg border border-dashed border-sky-400 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
                >
                  + עמודה חדשה
                </button>
                <span className="text-xs text-slate-400">
                  {columns.length === 0
                    ? ''
                    : `${columns.length.toLocaleString('he-IL')} עמודות`}
                </span>
              </div>
            ))}

          {/* ── סל הגריעה ── */}
          {trash.length > 0 && (
            <div className="rounded-xl border border-slate-200">
              <button
                onClick={() => setTrashOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-right text-sm"
              >
                <span className="font-medium text-slate-600">עמודות שנמחקו ({trash.length})</span>
                <span className="text-xs text-slate-400">{trashOpen ? '▲' : '▼'}</span>
              </button>
              {trashOpen && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {trash.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="w-6 shrink-0 text-center text-slate-400">
                        {t.type === 'checkbox' ? '☑' : 'Aa'}
                      </span>
                      <span className="flex-1 text-slate-700">{t.label}</span>
                      <span className="text-slate-400">
                        {t.values.toLocaleString('he-IL')} ערכים · נמחקה {he(t.deleted_at)} ·
                        ניתנת לשחזור עד {he(t.restore_until)}
                      </span>
                      {canManage && (
                        <button
                          onClick={() => restore(t.id)}
                          disabled={busy}
                          className="shrink-0 rounded-lg border border-slate-300 px-3 py-0.5 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
                        >
                          שחזור
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
