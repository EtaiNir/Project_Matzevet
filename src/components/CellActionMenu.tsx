import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  /** שם התלמיד שבשורה — כדי שיהיה ברור על מי לוחצים */
  studentName: string
  /** תווית העמודה שנלחצה */
  columnLabel: string
  /** הערך בתא, לתצוגה בכותרת התפריט */
  cellValue: string
  anchor: DOMRect
  onOpenCard: () => void
  onOpenFilter: () => void
  /** הסרת העמודה מהתצוגה. אינה מוחקת דבר — רק מורידה אותה מהטבלה. */
  onHideColumn?: () => void
  /** הסרת התלמיד מהטבלה הייעודית הפתוחה. מוצג רק במצב הזה. */
  onRemoveFromView?: () => void
  onClose: () => void
}

const PANEL_WIDTH = 232

/**
 * תפריט הפעולות של תא — נפתח ב**לחיצה ימנית** על כל תא בטבלה.
 *
 * שתי הפעולות שסבא ביקש: לפתוח את כרטיס התלמיד של השורה, או לסנן את
 * העמודה שבה לחץ — בלי לעבור לכותרת ובלי לזכור איפה יושב הסינון.
 *
 * הגרסה הראשונה נפתחה בלחיצה שמאלית, וזה הפריע: כל מגע בטבלה פתח תפריט.
 * לחיצה שמאלית חזרה לפתוח את הכרטיס, והתפריט עבר ללחיצה ימנית — המקום
 * שבו משתמש אקסס מחפש אותו ממילא.
 */
export default function CellActionMenu({
  studentName,
  columnLabel,
  cellValue,
  anchor,
  onOpenCard,
  onOpenFilter,
  onHideColumn,
  onRemoveFromView,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // נפתח מתחת לנקודת הלחיצה, ונצמד פנימה אם חורג מהמסך
  const left = Math.min(
    Math.max(8, anchor.left),
    Math.max(8, window.innerWidth - PANEL_WIDTH - 8),
  )
  const top = Math.min(anchor.bottom + 2, window.innerHeight - 130)

  return createPortal(
    <div
      ref={panelRef}
      dir="rtl"
      style={{ position: 'fixed', top, left, width: PANEL_WIDTH }}
      className="z-50 overflow-hidden rounded-xl border border-slate-300 bg-white py-1 shadow-2xl"
    >
      <div className="flex items-start gap-2 border-b border-slate-100 px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-slate-700" title={studentName}>
            {studentName || 'תלמיד'}
          </div>
          <div className="truncate text-xs text-slate-400" title={`${columnLabel}: ${cellValue}`}>
            {columnLabel}
            {cellValue ? `: ${cellValue}` : ''}
          </div>
        </div>
        {/* סגירה — ב-RTL הכפתור נופל לפינה השמאלית העליונה */}
        <button
          onClick={onClose}
          title="סגירה"
          aria-label="סגירת התפריט"
          className="-mt-0.5 shrink-0 rounded px-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <button
        onClick={onOpenCard}
        className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-sky-50 hover:text-sky-800"
      >
        <span>🗂</span>
        <span>כרטיס תלמיד</span>
      </button>

      <button
        onClick={onOpenFilter}
        className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-sky-50 hover:text-sky-800"
      >
        <span>▼</span>
        <span className="truncate">סינון לפי {columnLabel}</span>
      </button>

      {onRemoveFromView && (
        <button
          onClick={onRemoveFromView}
          title="התלמיד יוסר מהרשימה הזו בלבד. הנתונים שלו אינם נמחקים."
          className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-red-50 hover:text-red-700"
        >
          <span>➖</span>
          <span className="truncate">הסרה מהטבלה הייעודית</span>
        </button>
      )}

      {/* הסתרה ולא מחיקה: העמודה יורדת מהתצוגה בלבד, וחוזרת מבורר השדות */}
      {onHideColumn && (
        <button
          onClick={onHideColumn}
          title="העמודה תרד מהתצוגה. אפשר להחזיר אותה מבורר השדות."
          className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-sky-50 hover:text-sky-800"
        >
          <span>🚫</span>
          <span className="truncate">הסתרת עמודת {columnLabel}</span>
        </button>
      )}
    </div>,
    document.body,
  )
}
