import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  IconChevron,
  IconFolder,
  IconFolderPlus,
  IconSearch,
  IconShare,
} from '@/components/brand/Icons'
import type { Preset } from '@/config/presets'
import type { SavedView, SharedWithMe, ViewFolder } from '@/lib/savedViews'
import type { ShareTarget } from '@/components/ShareDialog'

interface Props {
  authorityCode: string
  presets: Preset[]
  activePreset: string
  onPresetChange: (id: string) => void
  /** כמה תלמידים בכל תצורה, לפי הסינון שנפתח איתה */
  presetCounts: Record<string, number>
  views: SavedView[]
  /** התיקיות של המשתמש, שטוחות. העץ נבנה כאן */
  folders: ViewFolder[]
  /** הטבלה הייעודית הפתוחה כרגע, אם יש */
  activeViewId?: string | null
  /** יצירת טבלה ייעודית מהסינון הנוכחי */
  onSaveToView: () => void
  canSaveToView: boolean
  /** מחיקת טבלה ייעודית. האישור עצמו נעשה במסך שמעל. */
  onDeleteView?: (view: SavedView) => void
  /** מיזוג: התלמידים של `source` מתווספים ל-`target`. האישור עצמו במסך שמעל. */
  onMergeView?: (source: SavedView, target: SavedView) => void
  /** מה שותף **איתי** ברשות הזו — כדי לסמן פריט של מישהו אחר */
  shares?: SharedWithMe[]
  /** המשתמש המחובר. בלעדיו הכול נחשב שלי, כמו לפני השיתוף */
  currentUserId?: string | null
  /** פתיחת חלון השיתוף. מוצג רק על פריטים שהמשתמש עצמו יצר. */
  onShare?: (target: ShareTarget) => void

  onCreateFolder?: (name: string, parentId: string | null) => void
  onRenameFolder?: (id: string, name: string) => void
  onDeleteFolder?: (folder: ViewFolder) => void
  onMoveView?: (viewId: string, folderId: string | null) => void
  onMoveFolder?: (folderId: string, parentId: string | null) => void
}

const WIDTH_KEY = 'matzevet:rail-width'
const OPEN_KEY = 'matzevet:view-folders-open'
const MIN_WIDTH = 150
const MAX_WIDTH = 420
const DEFAULT_WIDTH = 192
const ZOOM_KEY = 'matzevet:rail-zoom'
const MIN_ZOOM = 0.8
const MAX_ZOOM = 1.5
const ZOOM_STEP = 0.1
/**
 * הזחה לכל רמה בעץ, בפיקסלים. רחבה מספיק כדי שהקו האופקי ייכנס בין
 * קו העץ של ההורה לתחילת השורה של הילד.
 */
const INDENT = 22
/** חצי גובה שורה בסרגל — הנקודה שבה הקו האופקי פוגש את השורה */
const ROW_MID = 16
const MENU_WIDTH = 220
const MENU_MAX_HEIGHT = 340

/** הריפוד מתחילת השורה לרמה בעומק הזה */
const padStart = (depth: number) => 8 + depth * INDENT
/** מרכז החץ של תיקייה בעומק הזה — משם יורד הקו אל ילדיה */
const lineX = (depth: number) => padStart(depth) + 6

function readWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH) return raw
  } catch {
    /* אחסון חסום — ברירת המחדל */
  }
  return DEFAULT_WIDTH
}

function readOpen(code: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${OPEN_KEY}:${code}`)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* אחסון חסום או JSON פגום — מתחילים סגור */
  }
  return new Set()
}

function readZoom(): number {
  try {
    const raw = Number(localStorage.getItem(ZOOM_KEY))
    if (Number.isFinite(raw) && raw >= MIN_ZOOM && raw <= MAX_ZOOM) return raw
  } catch {
    /* אחסון חסום — גודל רגיל */
  }
  return 1
}

function saveOpen(code: string, open: Set<string>): void {
  try {
    localStorage.setItem(`${OPEN_KEY}:${code}`, JSON.stringify([...open]))
  } catch {
    /* אחסון חסום — הפתיחה תחזיק עד לרענון */
  }
}

/** התיקייה ואבותיה, מלמטה למעלה. השומר מגן מעץ פגום. */
function ancestorChain(folderId: string | null, folders: ViewFolder[]): string[] {
  const chain: string[] = []
  let cur = folderId
  for (let guard = 0; cur && guard < 20; guard++) {
    chain.push(cur)
    cur = folders.find((f) => f.id === cur)?.parent_id ?? null
  }
  return chain
}

/** מה נגרר כרגע. הקידומת מפרידה בין תיקייה לטבלה באותו dataTransfer. */
type DragPayload = { kind: 'view' | 'folder'; id: string }

function encodeDrag(p: DragPayload): string {
  return `${p.kind}:${p.id}`
}

function decodeDrag(raw: string): DragPayload | null {
  const [kind, id] = raw.split(':')
  if ((kind === 'view' || kind === 'folder') && id) return { kind, id }
  return null
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'he')

/** תפריט הלחיצה הימנית על טבלה ייעודית, והמסך הפנימי שמוצג בו */
type ViewMenu = {
  view: SavedView
  x: number
  y: number
  panel: 'actions' | 'move' | 'merge'
}

/**
 * סימון דק לפריט שהגיע בשיתוף.
 *
 * אייקון ולא תווית: הסרגל צר, ושם של טבלה הוא מה שצריך להיקרא. מי
 * שיתף ובאיזו הרשאה — ב-tooltip ובתפריט הלחיצה הימנית.
 */
function SharedMark({ by }: { by?: SharedWithMe }) {
  const who = by?.owner_name ?? by?.owner_email ?? 'משתמש אחר'
  const how = by?.can_edit ? 'עריכה' : 'צפייה'
  return (
    <span
      title={by ? `שותף איתך ע"י ${who} — ${how}` : 'שותף איתך'}
      aria-label="שותף איתך"
      className="shrink-0 text-emerald-600"
    >
      <IconShare className="h-3 w-3" />
    </span>
  )
}

/** מיקום תפריט צף ליד נקודת הלחיצה, בלי לחרוג מהחלון */
function menuPosition(x: number, y: number, height: number): CSSProperties {
  return {
    position: 'fixed',
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    left: Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 8),
    width: MENU_WIDTH,
  }
}

const menuItemBase =
  'flex w-full items-center gap-2 px-3 py-2 text-right text-sm text-slate-700 transition disabled:cursor-default disabled:opacity-40'
const menuItem = menuItemBase + ' enabled:hover:bg-sky-50 enabled:hover:text-sky-800'

/**
 * סרגל המסכים — יושב בצד ימין, לצד הטבלה.
 *
 * תצורה וטבלה ייעודית עונות על אותה שאלה: "על איזו קבוצת תלמידים אני
 * מסתכל". קודם הן ישבו בשני מקומות שאין ביניהם קשר — הראשונה בטאבים,
 * השנייה בקישור שנבלע בסרגל הכלים. כאן הן משפחה אחת, וכל אחת עם
 * הספירה שלה.
 *
 * ## עץ התיקיות
 *
 * הטבלאות הייעודיות מסודרות בעץ, בהתנהגות של סייר הקבצים:
 *
 *   לחיצה בודדת   בוחרת תיקייה — והיא היעד של כפתור "תיקייה חדשה"
 *   לחיצה כפולה   פותחת וסוגרת
 *   לחיצה על החץ  פותחת וסוגרת
 *   לחיצה ימנית   על תיקייה: שינוי שם · תיקייה בתוכה · מחיקה
 *                 על טבלה:   העברה לתיקייה · מיזוג לטבלה אחרת · מחיקה
 *   גרירה         טבלה או תיקייה אל תוך תיקייה, או אל שטח ריק = שורש
 *
 * לכל מחווה יש תפקיד. לחיצה בודדת שאינה עושה דבר הייתה נראית כתקלה,
 * ולחיצה בודדת שפותחת הייתה מבטלת את הלחיצה הכפולה שנתבקשה.
 *
 * תיקייה פתוחה מחוברת לתוכן שלה בקווי עץ: קו יורד מהחץ שלה, וקו אופקי
 * קצר לכל פריט. בלי הקווים, בעומק שתיים כבר לא ברור לאיזו תיקייה שייכת
 * טבלה — ההזחה לבדה נבלעת כשהשמות באורכים שונים.
 *
 * בחיפוש העץ **מתמוטט לרשימה שטוחה**, עם נתיב התיקייה מתחת לכל שם —
 * כמו שסייר הקבצים מתנהג בחיפוש. מי שמחפש אינו יודע איפה זה יושב; אם
 * היה יודע, לא היה מחפש.
 *
 * הרוחב נגרר ונשמר בדפדפן: שם של טבלה ייעודית יכול להיות ארוך, ואין
 * רוחב אחד שמתאים לכל המועצות.
 */
export default function StudentsRail({
  authorityCode,
  presets,
  activePreset,
  onPresetChange,
  presetCounts,
  views,
  folders,
  activeViewId,
  onSaveToView,
  canSaveToView,
  onDeleteView,
  onMergeView,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveView,
  onMoveFolder,
  shares,
  currentUserId,
  onShare,
}: Props) {
  const [width, setWidth] = useState(readWidth)
  /** הרוחב העדכני, כדי שסיום הגרירה לא יתלה ב-state שנסגר עליו */
  const widthRef = useRef(width)
  widthRef.current = width

  /** גודל התוכן בסרגל. נשמר בדפדפן, כמו הרוחב */
  const [zoom, setZoom] = useState(readZoom)

  function changeZoom(delta: number) {
    setZoom((prev) => {
      // עיגול לעשירית: חיבור שברים חוזר היה נותן 1.2000000000000002
      const next = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)) * 10) / 10
      try {
        localStorage.setItem(ZOOM_KEY, String(next))
      } catch {
        /* אחסון חסום — הגודל יחזיק עד לרענון */
      }
      return next
    })
  }

  /** תיבת החיפוש נפתחת בלחיצה על הזכוכית — היא אינה תופסת מקום כשלא צריך אותה */
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')

  const [open, setOpen] = useState<Set<string>>(() => readOpen(authorityCode))
  const [selected, setSelected] = useState<string | null>(null)
  /** תיבת שם לתיקייה חדשה, תחת ההורה הזה */
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ folder: ViewFolder; x: number; y: number } | null>(null)
  const [viewMenu, setViewMenu] = useState<ViewMenu | null>(null)
  /** מה מסומן כיעד נפילה כרגע: מזהה תיקייה, או 'root' */
  const [dropOn, setDropOn] = useState<string | null>(null)

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      saveOpen(authorityCode, next)
      return next
    })
  }

  /** פותח את התיקייה ואת כל אבותיה, כדי שמה שבתוכה יהיה גלוי */
  function reveal(folderId: string | null) {
    const chain = ancestorChain(folderId, folders)
    setOpen((prev) => {
      // החזרת אותו Set מונעת רינדור חוזר אינסופי
      if (chain.every((id) => prev.has(id))) return prev
      const next = new Set(prev)
      for (const id of chain) next.add(id)
      saveOpen(authorityCode, next)
      return next
    })
  }

  /**
   * טבלה שנפתחה מחוץ לסרגל (קישור, דף הטבלאות) חייבת להיראות בו.
   * בלי זה היא הייתה מסומנת כפעילה בתוך תיקייה סגורה — כלומר בלתי
   * נראית, והסרגל היה נראה כאילו איבד אותה.
   */
  useEffect(() => {
    const v = activeViewId ? views.find((x) => x.id === activeViewId) : undefined
    if (!v?.folder_id) return
    reveal(v.folder_id)
    // reveal נבנית מחדש בכל רינדור; התלויות האמיתיות הן אלה שלמטה
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewId, views, folders, authorityCode])

  function startResize(e: ReactMouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthRef.current

    function onMove(ev: MouseEvent) {
      // הסרגל בצד ימין: גרירה שמאלה מרחיבה אותו
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW - (ev.clientX - startX))))
    }
    function onUp() {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(widthRef.current)))
      } catch {
        /* אחסון חסום — הרוחב יחזיק עד לרענון */
      }
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function closeSearch() {
    setSearching(false)
    setQuery('')
  }

  const needle = query.trim().toLowerCase()
  const matching = needle ? views.filter((v) => v.name.toLowerCase().includes(needle)) : views

  /** הנתיב המלא לתיקייה, לתצוגה מתחת לתוצאת חיפוש */
  function pathOf(folderId: string | null): string {
    return ancestorChain(folderId, folders)
      .map((id) => folders.find((f) => f.id === id)?.name ?? '')
      .reverse()
      .join(' / ')
  }

  // ─────────────────────────── בעלוּת ───────────────────────────

  /** פריט שנוצר ע"י מישהו אחר הגיע אליי בשיתוף — ופעולות הבעלוּת עליו חסומות */
  const mine = (x: { created_by: string | null }) => !currentUserId || x.created_by === currentUserId

  const sharedView = new Map((shares ?? []).filter((s) => s.kind === 'view').map((s) => [s.item_id, s]))
  const sharedFolder = new Map(
    (shares ?? []).filter((s) => s.kind === 'folder').map((s) => [s.item_id, s]),
  )

  /** מי שיתף איתי את הפריט — ישירות, או דרך תיקייה שמעליו */
  function sharerOf(kind: 'view' | 'folder', id: string, folderId: string | null): SharedWithMe | undefined {
    const direct = kind === 'view' ? sharedView.get(id) : sharedFolder.get(id)
    if (direct) return direct
    for (const ancestor of ancestorChain(folderId, folders)) {
      const s = sharedFolder.get(ancestor)
      if (s) return s
    }
    return undefined
  }

  /**
   * ההורה **הגלוי** של פריט.
   *
   * תיקיית משנה ששותפה איתי מגיעה עם `parent_id` של תיקייה שאיני רשאי
   * לראות. בלי התרגום הזה היא לא הייתה מופיעה בשום מקום בעץ — לא
   * בשורש, כי ההורה אינו null, ולא תחת ההורה, כי הוא אינו קיים אצלי.
   */
  const visibleIds = new Set(folders.map((f) => f.id))
  const parentOf = (id: string | null) => (id && visibleIds.has(id) ? id : null)

  const foldersIn = (parent: string | null) =>
    folders.filter((f) => parentOf(f.parent_id) === parent).sort(byName)
  const viewsIn = (parent: string | null) =>
    matching.filter((v) => parentOf(v.folder_id) === parent).sort(byName)

  /** כל התיקיות כרשימה שטוחה לפי סדר העץ, עם העומק — לתפריט ההעברה */
  function folderOptions(): { folder: ViewFolder; depth: number }[] {
    const out: { folder: ViewFolder; depth: number }[] = []
    const walk = (parent: string | null, depth: number) => {
      if (depth > 20) return
      for (const f of foldersIn(parent)) {
        out.push({ folder: f, depth })
        walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }

  // ─────────────────────────── גרירה ───────────────────────────

  function onDragStartItem(e: ReactDragEvent, payload: DragPayload) {
    e.dataTransfer.setData('text/plain', encodeDrag(payload))
    e.dataTransfer.effectAllowed = 'move'
  }

  function allowDrop(e: ReactDragEvent, target: string) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropOn(target)
  }

  /** `folderId` ריק = השורש */
  function handleDrop(e: ReactDragEvent, folderId: string | null) {
    e.preventDefault()
    e.stopPropagation()
    setDropOn(null)
    const p = decodeDrag(e.dataTransfer.getData('text/plain'))
    if (!p) return
    if (p.kind === 'view') {
      onMoveView?.(p.id, folderId)
    } else if (p.id !== folderId) {
      // מעגלים נחסמים במסד; כאן רק מונעים את המקרה הגלוי לעין
      onMoveFolder?.(p.id, folderId)
    }
  }

  // ─────────────────────────── שורות ───────────────────────────

  const rowBase = 'group flex w-full items-center gap-1.5 py-1.5 pl-2 text-right text-sm transition'

  function nameInput(onCommit: (value: string) => void, onCancel: () => void, placeholder?: string) {
    return (
      <input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => {
          const name = draft.trim()
          if (name) onCommit(name)
          setDraft('')
          onCancel()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft('')
            onCancel()
          }
        }}
        className="w-full rounded border border-sky-400 bg-white px-1 py-0.5 text-sm focus:outline-none"
      />
    )
  }

  function folderRow(f: ViewFolder, depth: number): ReactNode {
    const pad = { paddingInlineStart: padStart(depth) }

    if (renaming === f.id) {
      return (
        <div key={`f-${f.id}`} style={pad} className={rowBase}>
          <IconFolder className="h-4 w-4 shrink-0 text-emerald-600" />
          {nameInput(
            (name) => onRenameFolder?.(f.id, name),
            () => setRenaming(null),
          )}
        </div>
      )
    }

    const isOpen = open.has(f.id)
    const isSelected = selected === f.id
    const isDropTarget = dropOn === f.id

    return (
      <div
        key={`f-${f.id}`}
        draggable={mine(f)}
        onDragStart={(e) => onDragStartItem(e, { kind: 'folder', id: f.id })}
        // תיקייה משותפת אינה יעד: עוצרים את הבעבוע, אחרת הסרגל מסמן
        // "שורש" ונפילה עליה הייתה מעבירה את הפריט לשורש בלי כוונה
        onDragOver={(e) => (mine(f) ? allowDrop(e, f.id) : e.stopPropagation())}
        onDragLeave={() => setDropOn((d) => (d === f.id ? null : d))}
        onDrop={(e) => {
          if (mine(f)) handleDrop(e, f.id)
          else e.stopPropagation()
        }}
        onClick={(e) => {
          e.stopPropagation()
          setSelected(isSelected ? null : f.id)
        }}
        onDoubleClick={() => toggleOpen(f.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          setSelected(f.id)
          setViewMenu(null)
          setMenu({ folder: f, x: e.clientX, y: e.clientY })
        }}
        title={f.name}
        style={pad}
        className={
          rowBase +
          ' cursor-pointer select-none text-slate-700 ' +
          (isDropTarget
            ? 'bg-emerald-100 ring-1 ring-inset ring-emerald-400'
            : isSelected
              ? 'bg-sky-100'
              : 'hover:bg-sky-50')
        }
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleOpen(f.id)
          }}
          aria-label={isOpen ? 'סגירת התיקייה' : 'פתיחת התיקייה'}
          className="shrink-0 text-slate-400 transition hover:text-sky-700"
        >
          <IconChevron className={'h-3 w-3 transition-transform ' + (isOpen ? '-rotate-90' : '')} />
        </button>
        <IconFolder className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="truncate">{f.name}</span>
        {!mine(f) && <SharedMark by={sharerOf('folder', f.id, f.parent_id)} />}
      </div>
    )
  }

  function openViewMenu(e: ReactMouseEvent, v: SavedView) {
    if (!onMoveView && !onMergeView && !onDeleteView) return
    e.preventDefault()
    e.stopPropagation()
    setMenu(null)
    setViewMenu({ view: v, x: e.clientX, y: e.clientY, panel: 'actions' })
  }

  function viewRow(v: SavedView, depth: number, path?: string): ReactNode {
    const on = activeViewId === v.id
    const menuOpen = viewMenu?.view.id === v.id
    return (
      <div
        key={`v-${v.id}`}
        draggable={mine(v)}
        onDragStart={(e) => onDragStartItem(e, { kind: 'view', id: v.id })}
        onContextMenu={(e) => openViewMenu(e, v)}
        className={
          'group flex items-center ' +
          (on ? 'bg-sky-600' : menuOpen ? 'bg-sky-100' : 'transition hover:bg-sky-50')
        }
      >
        <Link
          to={`/views/${authorityCode}/${v.id}`}
          title={v.description ?? v.name}
          style={{ paddingInlineStart: padStart(depth) }}
          className={
            'flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pl-2 text-right text-sm transition ' +
            (on ? 'font-bold text-white' : 'text-slate-600 group-hover:text-sky-800')
          }
        >
          <span className="min-w-0">
            <span className="flex items-center gap-1">
              <span className="truncate">{v.name}</span>
              {!mine(v) && <SharedMark by={sharerOf('view', v.id, v.folder_id)} />}
            </span>
            {path && (
              <span
                className={'block truncate text-[11px] ' + (on ? 'text-sky-100' : 'text-slate-400')}
              >
                {path}
              </span>
            )}
          </span>
          <span
            className={'shrink-0 text-xs tabular-nums ' + (on ? 'text-sky-100' : 'text-slate-400')}
          >
            {(v.member_count ?? 0).toLocaleString('he-IL')}
          </span>
        </Link>
        {onDeleteView && (
          <button
            onClick={() => onDeleteView(v)}
            title={`מחיקת «${v.name}»`}
            aria-label={`מחיקת «${v.name}»`}
            className={
              'shrink-0 px-2 py-1.5 text-xs opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 ' +
              (on ? 'text-sky-100 hover:text-white' : 'text-slate-400 hover:text-red-600')
            }
          >
            🗑
          </button>
        )}
      </div>
    )
  }

  /** תיבת השם לתיקייה חדשה, מוצגת במקום שבו התיקייה תיווצר */
  function newFolderRow(depth: number): ReactNode {
    const parentId = creating?.parentId ?? null
    return (
      <div
        key="new-folder"
        style={{ paddingInlineStart: padStart(depth) }}
        className={rowBase}
      >
        <IconFolder className="h-4 w-4 shrink-0 text-emerald-600" />
        {nameInput(
          (name) => {
            onCreateFolder?.(name, parentId)
            if (parentId && !open.has(parentId)) toggleOpen(parentId)
          },
          () => setCreating(null),
          'שם התיקייה',
        )}
      </div>
    )
  }

  /**
   * פריט בתוך תיקייה, עם קווי העץ שמחברים אותו להורה.
   *
   * הקו האנכי יורד מהחץ של ההורה. אצל כל פריט חוץ מהאחרון הוא נמשך לכל
   * גובה הבלוק — כולל תת-העץ של תיקייה פתוחה — כדי להגיע לאח הבא. אצל
   * האחרון הוא נעצר בקו האופקי, וכך רואים איפה התיקייה נגמרת.
   */
  function guided(node: ReactNode, key: string, depth: number, first: boolean, last: boolean) {
    if (depth === 0) return <Fragment key={key}>{node}</Fragment>
    const x = lineX(depth - 1)
    // הפריט הראשון מושך את הקו מעט למעלה, עד מתחת לחץ של התיקייה
    const top = first ? -8 : 0
    return (
      <div key={key} className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute w-px bg-slate-300"
          style={{
            insetInlineStart: x,
            top,
            ...(last ? { height: ROW_MID - top } : { bottom: 0 }),
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute h-px bg-slate-300"
          style={{ insetInlineStart: x, top: ROW_MID, width: padStart(depth) - 3 - x }}
        />
        {node}
      </div>
    )
  }

  function renderTree(parentId: string | null, depth: number): ReactNode[] {
    const blocks: { key: string; node: ReactNode }[] = []
    if (creating && creating.parentId === parentId) {
      blocks.push({ key: 'new-folder', node: newFolderRow(depth) })
    }
    for (const f of foldersIn(parentId)) {
      blocks.push({
        key: `f-${f.id}`,
        node: (
          <>
            {folderRow(f, depth)}
            {open.has(f.id) && renderTree(f.id, depth + 1)}
          </>
        ),
      })
    }
    for (const v of viewsIn(parentId)) {
      blocks.push({ key: `v-${v.id}`, node: viewRow(v, depth) })
    }
    return blocks.map((b, i) => guided(b.node, b.key, depth, i === 0, i === blocks.length - 1))
  }

  // ─────────────────────── תפריט טבלה ייעודית ───────────────────────

  function viewMenuBody(m: ViewMenu): ReactNode {
    const v = m.view
    const back = (
      <button
        onClick={() => setViewMenu({ ...m, panel: 'actions' })}
        className="flex w-full items-center gap-1 border-b border-slate-100 px-3 py-1.5 text-right text-xs text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
      >
        → חזרה
      </button>
    )

    if (m.panel === 'move') {
      const here = v.folder_id ?? null
      const moveTo = (folderId: string | null) => {
        onMoveView?.(v.id, folderId)
        // שהטבלה תיראה במקומה החדש, ולא תיעלם לתוך תיקייה סגורה
        if (folderId) reveal(folderId)
        setViewMenu(null)
      }
      return (
        <>
          {back}
          <button disabled={here === null} onClick={() => moveTo(null)} className={menuItem}>
            <span className="w-4 shrink-0 text-center text-slate-400">⌂</span>
            <span className="truncate">ללא תיקייה</span>
            {here === null && <span className="mr-auto shrink-0 text-xs">כאן</span>}
          </button>
          {folderOptions().map(({ folder, depth }) => (
            <button
              key={folder.id}
              disabled={here === folder.id}
              onClick={() => moveTo(folder.id)}
              style={{ paddingInlineStart: 12 + depth * 14 }}
              className={menuItem}
            >
              <IconFolder className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="truncate">{folder.name}</span>
              {here === folder.id && <span className="mr-auto shrink-0 text-xs">כאן</span>}
            </button>
          ))}
          {folders.length === 0 && (
            <p className="px-3 py-2 text-xs leading-relaxed text-slate-400">
              אין עדיין תיקיות. יוצרים אחת בכפתור התיקייה שליד הכותרת.
            </p>
          )}
        </>
      )
    }

    if (m.panel === 'merge') {
      const targets = views.filter((t) => t.id !== v.id).sort(byName)
      return (
        <>
          {back}
          <p className="px-3 pb-1 pt-2 text-xs leading-relaxed text-slate-500">
            התלמידים של «{v.name}» יתווספו לטבלה שתבחר:
          </p>
          {targets.map((t) => {
            const path = pathOf(t.folder_id)
            return (
              <button
                key={t.id}
                onClick={() => {
                  onMergeView?.(v, t)
                  setViewMenu(null)
                }}
                className={menuItem}
              >
                <span className="min-w-0">
                  <span className="block truncate">{t.name}</span>
                  {path && <span className="block truncate text-[11px] text-slate-400">{path}</span>}
                </span>
                <span className="mr-auto shrink-0 text-xs tabular-nums text-slate-400">
                  {(t.member_count ?? 0).toLocaleString('he-IL')}
                </span>
              </button>
            )
          })}
        </>
      )
    }

    // טבלה ששותפה איתי אינה שלי: העברה, מיזוג, מחיקה ושיתוף־משנה
    // כולם חסומים ב-RLS, ואין טעם להציע אותם.
    if (!mine(v)) {
      const by = sharerOf('view', v.id, v.folder_id)
      return (
        <p className="px-3 py-2 text-xs leading-relaxed text-slate-400">
          הטבלה שותפה איתך ע"י{' '}
          <span className="text-emerald-700">{by?.owner_name ?? by?.owner_email ?? 'משתמש אחר'}</span>
          {by?.can_edit ? ' להרשאת עריכה' : ' לצפייה בלבד'}. מחיקה, שינוי שם ושיתוף שמורים
          למי שיצר אותה.
        </p>
      )
    }

    return (
      <>
        {onMoveView && (
          <button onClick={() => setViewMenu({ ...m, panel: 'move' })} className={menuItem}>
            <IconFolder className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>העברה לתיקייה</span>
            <span className="mr-auto text-slate-400">‹</span>
          </button>
        )}
        {onMergeView && (
          <button
            onClick={() => setViewMenu({ ...m, panel: 'merge' })}
            disabled={views.length < 2}
            title={views.length < 2 ? 'אין טבלה נוספת למזג אליה' : undefined}
            className={menuItem}
          >
            <span className="w-4 shrink-0 text-center text-sky-600">⇆</span>
            <span>מיזוג לטבלה אחרת</span>
            <span className="mr-auto text-slate-400">‹</span>
          </button>
        )}
        {onShare && (
          <button
            onClick={() => {
              onShare({ kind: 'view', id: v.id, name: v.name })
              setViewMenu(null)
            }}
            className={menuItem}
          >
            <IconShare className="h-4 w-4 shrink-0 text-sky-600" />
            <span>שיתוף…</span>
          </button>
        )}
        {onDeleteView && (
          <button
            onClick={() => {
              onDeleteView(v)
              setViewMenu(null)
            }}
            className={
              menuItemBase + ' border-t border-slate-100 hover:bg-red-50 hover:text-red-700'
            }
          >
            <span className="w-4 shrink-0 text-center">🗑</span>
            <span>מחיקת הטבלה</span>
          </button>
        )}
      </>
    )
  }

  const item =
    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-right text-sm transition'

  return (
    <aside
      style={{ width }}
      // נפילה בכל מקום בסרגל שאינו תיקייה = העברה לשורש. קודם זה היה
      // רצועה בגובה קבוע, ומי שגרר אל השטח הריק שמתחתיה לא קיבל דבר.
      onDragOver={(e) => allowDrop(e, 'root')}
      onDragLeave={() => setDropOn((d) => (d === 'root' ? null : d))}
      onDrop={(e) => handleDrop(e, null)}
      className={
        'relative flex shrink-0 flex-col border-l border-slate-200 bg-slate-50/70 ' +
        (dropOn === 'root' ? 'ring-2 ring-inset ring-emerald-400' : '')
      }
    >
      {/* ידית שינוי רוחב — על הגבול שפונה לטבלה. מחוץ לאזור הגלילה, כדי
          שתכסה את כל הגובה ולא תיגלל יחד עם התוכן */}
      <div
        onMouseDown={startResize}
        title="גרירה לשינוי רוחב הסרגל"
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize bg-transparent transition hover:bg-sky-400"
      />

      {/*
        פס הגלילה בצד ימין, בקצה המסך. בדף RTL הדפדפן מצייר אותו משמאל —
        בדיוק על הגבול עם הטבלה, צמוד לפס הגלילה שלה ולידית הרוחב. לכן
        מיכל הגלילה עצמו LTR, והתוכן שבתוכו חוזר ל-RTL.
      */}
      <div dir="ltr" className="thin-scrollbar relative min-h-0 flex-1 overflow-y-scroll">
        {/*
          הגדלה והקטנה של התוכן. הכפתורים עצמם מחוץ לאזור המוגדל — אחרת
          הם היו גדלים יחד איתו ובורחים מהפינה. הם יושבים בתוך אזור
          הגלילה, ולכן נגללים עם הכותרת ולא מכסים את הספירות שמתחתיה.
        */}
        <div
          className="absolute left-2 z-[1] flex items-center gap-0.5"
          // ממורכז מול כותרת "מסכים", שגובהה משתנה עם ההגדלה
          style={{ top: Math.round(16 * zoom) - 9 }}
        >
          <button
            onClick={() => changeZoom(-ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            title={`הקטנת התצוגה בסרגל (${Math.round(zoom * 100)}%)`}
            aria-label="הקטנת התצוגה בסרגל"
            className="flex h-[18px] w-[18px] items-center justify-center rounded border border-slate-300 bg-white text-sm leading-none text-slate-500 transition enabled:hover:border-sky-400 enabled:hover:text-sky-700 disabled:opacity-40"
          >
            −
          </button>
          <button
            onClick={() => changeZoom(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            title={`הגדלת התצוגה בסרגל (${Math.round(zoom * 100)}%)`}
            aria-label="הגדלת התצוגה בסרגל"
            className="flex h-[18px] w-[18px] items-center justify-center rounded border border-slate-300 bg-white text-sm leading-none text-slate-500 transition enabled:hover:border-sky-400 enabled:hover:text-sky-700 disabled:opacity-40"
          >
            +
          </button>
        </div>

        {/* zoom ולא transform: scale — הוא משנה גם את הפריסה, כך שהגלילה
            והגרירה ממשיכים להתאים לגודל שרואים */}
        <div dir="rtl" className="py-2" style={{ zoom }}>
          <h2 className="flex items-center gap-2 px-3 pb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">
            <span className="h-3.5 w-1 rounded-full bg-sky-500" aria-hidden />
            מסכים
          </h2>

          {presets.map((p) => {
            const on = !activeViewId && activePreset === p.id
            return (
              <button
                key={p.id}
                onClick={() => onPresetChange(p.id)}
                title={p.description}
                className={
                  item +
                  (on
                    ? ' bg-sky-600 font-bold text-white'
                    : ' text-slate-600 hover:bg-sky-50 hover:text-sky-800')
                }
              >
                <span className="truncate">{p.name}</span>
                {presetCounts[p.id] !== undefined && (
                  <span
                    className={
                      'shrink-0 text-xs tabular-nums ' + (on ? 'text-sky-100' : 'text-slate-400')
                    }
                  >
                    {presetCounts[p.id].toLocaleString('he-IL')}
                  </span>
                )}
              </button>
            )
          })}

          {/* הכותרת עצמה היא הקישור לדף הטבלאות — הגלגל שישב כאן הוביל לאותו מקום */}
          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-2.5">
            <h2 className="min-w-0">
              <Link
                to={`/views/${authorityCode}`}
                title="לדף כל הטבלאות הייעודיות"
                className="flex items-center gap-2 px-3 pb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500 transition hover:text-emerald-700"
              >
                <span className="h-3.5 w-1 rounded-full bg-emerald-500" aria-hidden />
                <span className="truncate">טבלאות ייעודיות</span>
              </Link>
            </h2>
            <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1.5">
              {onCreateFolder && (
                <button
                  onClick={() => {
                    setDraft('')
                    setCreating({ parentId: selected })
                    if (selected && !open.has(selected)) toggleOpen(selected)
                  }}
                  title={
                    selected
                      ? 'תיקייה חדשה בתוך התיקייה המסומנת'
                      : 'תיקייה חדשה. לסימון תיקייה — לחיצה עליה, והחדשה תיווצר בתוכה'
                  }
                  aria-label="תיקייה חדשה"
                  className="text-slate-400 transition hover:text-emerald-700"
                >
                  <IconFolderPlus className="h-4 w-4" />
                </button>
              )}
              {views.length > 0 && (
                <button
                  onClick={() => (searching ? closeSearch() : setSearching(true))}
                  title="חיפוש טבלה לפי שם"
                  aria-label="חיפוש טבלה לפי שם"
                  className={
                    'transition ' +
                    (searching ? 'text-sky-700' : 'text-slate-400 hover:text-sky-700')
                  }
                >
                  <IconSearch className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {searching && (
            <div className="px-3 pb-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeSearch()
                }}
                placeholder="חיפוש טבלה…"
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 transition focus:border-sky-400 focus:outline-none"
              />
            </div>
          )}

          {/* לחיצה על שטח ריק מבטלת את הסימון, כמו בסייר הקבצים */}
          <div onClick={() => setSelected(null)} className="min-h-[3rem] pb-1">
            {needle ? (
              matching.length === 0 ? (
                <p className="px-3 pb-1 text-xs leading-relaxed text-slate-400">
                  אין טבלה בשם «{query.trim()}».
                </p>
              ) : (
                matching
                  .slice()
                  .sort(byName)
                  .map((v) => viewRow(v, 0, pathOf(v.folder_id)))
              )
            ) : folders.length === 0 && views.length === 0 ? (
              <>
                {creating?.parentId === null && newFolderRow(0)}
                <p className="px-3 pb-1 text-xs leading-relaxed text-slate-400">
                  סנן בטבלה ושמור את התוצאה כרשימה קבועה.
                </p>
              </>
            ) : (
              renderTree(null, 0)
            )}
          </div>

          {/* הפעולה יושבת מתחת לתוצאותיה — ולא מתחרה בשם עם קישור הניווט */}
          {canSaveToView && (
            <button
              onClick={onSaveToView}
              title="שמירת מי שסונן כרגע כרשימה קבועה"
              className="mt-1 w-full px-3 py-1.5 text-right text-sm font-medium text-sky-700 transition hover:bg-sky-50"
            >
              + מהסינון הנוכחי
            </button>
          )}
        </div>
      </div>

      {menu &&
        createPortal(
          <>
            {/* שכבה שקופה שסוגרת בלחיצה בחוץ, בלי מאזין על document */}
            <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)} />
            <div
              dir="rtl"
              style={{
                position: 'fixed',
                top: Math.min(menu.y, window.innerHeight - 150),
                left: Math.min(Math.max(8, menu.x), window.innerWidth - 188),
                width: 180,
              }}
              className="z-50 overflow-hidden rounded-xl border border-slate-300 bg-white py-1 shadow-2xl"
            >
              <div className="border-b border-slate-100 px-3 py-1.5">
                <div className="truncate text-xs font-bold text-slate-500">{menu.folder.name}</div>
                {!mine(menu.folder) && (
                  <div className="truncate text-[11px] text-emerald-700">
                    שותפה איתך ע"י{' '}
                    {sharerOf('folder', menu.folder.id, menu.folder.parent_id)?.owner_name ??
                      sharerOf('folder', menu.folder.id, menu.folder.parent_id)?.owner_email ??
                      'משתמש אחר'}
                  </div>
                )}
              </div>

              {/* פעולות הבעלוּת מוצגות רק למי שיצר — הן חסומות ב-RLS ממילא */}
              {mine(menu.folder) ? (
                <>
                  <button
                    onClick={() => {
                      setDraft(menu.folder.name)
                      setRenaming(menu.folder.id)
                      setMenu(null)
                    }}
                    className={menuItem}
                  >
                    <span className="w-4 shrink-0 text-center">✎</span>
                    <span>שינוי שם</span>
                  </button>
                  <button
                    onClick={() => {
                      setDraft('')
                      setCreating({ parentId: menu.folder.id })
                      if (!open.has(menu.folder.id)) toggleOpen(menu.folder.id)
                      setMenu(null)
                    }}
                    className={menuItem}
                  >
                    <IconFolderPlus className="h-4 w-4 shrink-0" />
                    <span>תיקייה בתוכה</span>
                  </button>
                  {onShare && (
                    <button
                      onClick={() => {
                        onShare({ kind: 'folder', id: menu.folder.id, name: menu.folder.name })
                        setMenu(null)
                      }}
                      title="השיתוף חל גם על תיקיות המשנה ועל הטבלאות שבתוכן"
                      className={menuItem}
                    >
                      <IconShare className="h-4 w-4 shrink-0 text-sky-600" />
                      <span>שיתוף…</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onDeleteFolder?.(menu.folder)
                      setMenu(null)
                    }}
                    title="הטבלאות שבתוכה יחזרו לשורש ולא יימחקו"
                    className={
                      menuItemBase + ' border-t border-slate-100 hover:bg-red-50 hover:text-red-700'
                    }
                  >
                    <span className="w-4 shrink-0 text-center">🗑</span>
                    <span>מחיקת התיקייה</span>
                  </button>
                </>
              ) : (
                <p className="px-3 py-2 text-xs leading-relaxed text-slate-400">
                  התיקייה אינה שלך. שינוי שם, מחיקה ושיתוף שמורים למי שיצר אותה.
                </p>
              )}
            </div>
          </>,
          document.body,
        )}

      {viewMenu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onMouseDown={() => setViewMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setViewMenu(null)
              }}
            />
            <div
              dir="rtl"
              style={{ ...menuPosition(viewMenu.x, viewMenu.y, MENU_MAX_HEIGHT), maxHeight: MENU_MAX_HEIGHT }}
              className="thin-scrollbar z-50 overflow-y-auto rounded-xl border border-slate-300 bg-white py-1 shadow-2xl"
            >
              <div className="truncate border-b border-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
                {viewMenu.view.name}
              </div>
              {viewMenuBody(viewMenu)}
            </div>
          </>,
          document.body,
        )}
    </aside>
  )
}
