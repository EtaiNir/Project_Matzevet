import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Logo from '@/components/brand/Logo'
import type { PivotNavState } from '@/lib/pivot'

interface Props {
  authorityCode: string
  authorityName: string
  /** הרשויות שהמשתמש רשאי לעבור ביניהן; פחות משתיים — אין בורר */
  authorities: string[]
  authorityLabel: (code: string) => string
  onAuthorityChange: (code: string) => void

  shown: number
  total: number
  filtered: boolean

  /** סרגל הסינון, מוטמע בשורת הפעולות */
  filterSlot: ReactNode

  /**
   * ההיקף שנשלח לפיבוט. בלעדיו הפיבוט פותח את כל הרשות — וזה בדיוק
   * הבאג שנוצר כשהכפתור עבר לכאן והפסיק להעביר את הסינון.
   */
  pivotState?: PivotNavState

  selectedFieldCount: number
  onOpenPicker: () => void
  onExport: () => void
  exporting: boolean
  onRefresh: () => void
  refreshing: boolean
  canUpdateMoe: boolean
  isSuperAdmin: boolean
  identity: string
  onSignOut: () => void
}

/** קו מפריד דק בין פריטי הזהות */
function Rule() {
  return (
    <span aria-hidden className="select-none text-slate-300">
      |
    </span>
  )
}

/**
 * הכותרת של מסך התלמידים — שתי שורות.
 *
 *   שורה 1   מי אני ואיזו מועצה
 *   שורה 2   מה אני עושה · לפי מה סיננתי · כמה יצא
 *
 * התצורות אינן כאן — הן בסרגל המסכים שמימין, יחד עם הטבלאות הייעודיות.
 * זה מה שפינה את השורות שהיו כאן קודם.
 *
 * הספירה בקצה השמאלי, בסוף שורת הפעולות: היא **התוצאה** של הסינון
 * שלצדה, ולכן היא סוגרת את השורה במקום לפתוח אותה.
 */
export default function RailTopBar({
  authorityCode,
  authorityName,
  authorities,
  authorityLabel,
  onAuthorityChange,
  shown,
  total,
  filtered,
  filterSlot,
  pivotState,
  selectedFieldCount,
  onOpenPicker,
  onExport,
  exporting,
  onRefresh,
  refreshing,
  canUpdateMoe,
  isSuperAdmin,
  identity,
  onSignOut,
}: Props) {
  const btn =
    'whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700'
  const ghost =
    'whitespace-nowrap rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:bg-sky-50 hover:text-sky-700'

  return (
    <header className="shrink-0 border-b border-slate-200 bg-white shadow-sm">
      {/* ── שורה 1: זהות ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 pt-2.5">
        <Logo className="h-7 w-7 shrink-0" />

        {authorities.length > 1 ? (
          <select
            value={authorityCode}
            onChange={(e) => onAuthorityChange(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium"
          >
            {authorities.map((a) => (
              <option key={a} value={a}>
                {authorityLabel(a)}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-lg bg-sky-50 px-3 py-1 text-sm font-bold text-sky-800">
            {authorityName || `רשות ${authorityCode || '—'}`}
          </span>
        )}

        <span className="mr-auto" />

        {/* זהות · ניהול · יציאה — מופרדים בקווים, אחרת הם נקראים כמילה אחת */}
        <div className="flex items-center gap-1 text-sm">
          <span className="truncate text-slate-500" title={identity}>
            {identity}
          </span>
          {isSuperAdmin && (
            <>
              <Rule />
              <Link
                to={authorityCode ? `/admin/client/${authorityCode}` : '/admin'}
                className={ghost}
              >
                ניהול
              </Link>
            </>
          )}
          <Rule />
          <button
            onClick={onSignOut}
            className="whitespace-nowrap rounded-lg px-2 py-1 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
          >
            יציאה
          </button>
        </div>
      </div>

      {/* ── שורה 2: פעולות · סינון · תוצאה ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5 pt-2">
        <button onClick={onOpenPicker} className={btn}>
          ⚙ תצוגה ({selectedFieldCount})
        </button>
        <button
          onClick={onExport}
          disabled={exporting}
          className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {exporting ? '⬇ מייצא…' : '⬇ ייצוא לאקסל'}
        </button>
        <Link
          to={`/pivot/${authorityCode}`}
          state={pivotState}
          title={
            pivotState?.fromLabel
              ? `סיכום על ${pivotState.fromLabel}`
              : 'סיכומים מוצלבים על כל תלמידי הרשות'
          }
          className={btn}
        >
          ▦ פיבוטים
        </Link>
        {canUpdateMoe && authorityCode && (
          <Link
            to={`/upload/${authorityCode}`}
            title="העלאת ששת קבצי המצב״ת ועדכון הנתונים"
            className={btn}
          >
            ⬆ מצב״ת
          </Link>
        )}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          title="טעינה מחדש מהמסד"
          className={ghost + ' disabled:opacity-40'}
        >
          {refreshing ? '⟳ מרענן…' : '⟳'}
        </button>

        <span aria-hidden className="select-none px-1 text-slate-300">
          │
        </span>

        {filterSlot}

        <span className="mr-auto" />

        {/* מידה אחת לכל השורה — המספר אינו כותרת, הוא חלק מהמשפט */}
        <span className="flex items-baseline gap-1.5 whitespace-nowrap rounded-lg bg-sky-50 px-3 py-1 text-sm">
          <strong className="font-bold tabular-nums text-sky-800">
            {shown.toLocaleString('he-IL')}
          </strong>
          <span className="font-medium text-sky-700">תלמידים</span>
          {filtered && (
            <span className="tabular-nums text-sky-600/70">
              מתוך {total.toLocaleString('he-IL')}
            </span>
          )}
        </span>
      </div>
    </header>
  )
}
