/**
 * סט אייקונים אחיד לדפים הציבוריים.
 *
 * קווי מתאר בעובי אחיד, ריבוע 24, `currentColor` — כך כולם נראים כמשפחה
 * אחת ומקבלים את צבע ההקשר. אמוג'י נראה שונה בכל מערכת הפעלה ומוזיל את
 * המראה; זו הסיבה שהוחלף.
 */

type IconProps = { className?: string }

const base = 'h-6 w-6'

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? base}
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** משפך — סינון */
export function IconFilter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 5h17l-6.5 8v5.5l-4 2V13z" />
    </Svg>
  )
}

/** נעץ — קיבוע עמודה או שורה */
export function IconPin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.2 3.5h5.6l-.9 5.2 3.1 3.1H6.9l3.2-3.1z" />
      <path d="M12 11.8v8.7" />
    </Svg>
  )
}

/** זכוכית מגדלת — חיפוש */
export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.4 15.4 20.5 20.5" />
    </Svg>
  )
}

/** שיתוף — שלוש נקודות מחוברות */
export function IconShare(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="17.5" cy="5.5" r="2.5" />
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="18.5" r="2.5" />
      <path d="M8.8 10.8 15.2 6.7M8.8 13.2l6.4 4.1" />
    </Svg>
  )
}

/** תיקייה */
export function IconFolder(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h3.8l2 2.3H19a1.5 1.5 0 0 1 1.5 1.5v8.2a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
    </Svg>
  )
}

/** תיקייה חדשה */
export function IconFolderPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h3.8l2 2.3H19a1.5 1.5 0 0 1 1.5 1.5v8.2a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M12 11.3v5M9.5 13.8h5" />
    </Svg>
  )
}

/** חץ פתיחה — פונה שמאלה כשסגור, ומסובב כלפי מטה כשפתוח */
export function IconChevron(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.5 6 9 12l5.5 6" />
    </Svg>
  )
}

/** כרטיס תלמיד */
export function IconCard(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="10.5" r="2.2" />
      <path d="M5.5 16.5c.6-1.7 1.7-2.5 3-2.5s2.4.8 3 2.5M14.5 9.5h4M14.5 13h4" />
    </Svg>
  )
}

/** משפחה — זיהוי אחים */
export function IconFamily(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="7.5" r="2.8" />
      <circle cx="16.5" cy="9" r="2.2" />
      <path d="M3.5 19c0-2.8 2-4.6 4.5-4.6s4.5 1.8 4.5 4.6M14 19c0-2.2 1.3-3.6 2.9-3.6 1.5 0 2.6 1.1 2.9 2.8" />
    </Svg>
  )
}

/** טבלת סיכום — פיבוט */
export function IconPivot(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9 9.5V19.5M14.5 9.5V19.5" />
    </Svg>
  )
}

/** ייצוא / הורדה */
export function IconExport(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5v10M8.5 10.5 12 14l3.5-3.5" />
      <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </Svg>
  )
}

/** רענון אוטומטי */
export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4.5h-4.5" />
    </Svg>
  )
}

/** מנעול — פרטיות */
export function IconLock(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  )
}

/** שכבות — הפרדת נתונים */
export function IconLayers(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5 21 8l-9 4.5L3 8z" />
      <path d="M3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5" />
    </Svg>
  )
}

/** תעודה — הרשאות */
export function IconBadge(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5 19.5 6v5.5c0 4.3-3 7.5-7.5 9-4.5-1.5-7.5-4.7-7.5-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  )
}

/** לוח עם רשימת תלמידים — מצבת תלמידים */
export function IconRoster(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4.5" y="4.5" width="15" height="16" rx="2.2" />
      <rect x="9" y="3" width="6" height="3" rx="1" />
      <circle cx="9" cy="11" r="1.6" />
      <circle cx="9" cy="16" r="1.6" />
      <path d="M12.5 11h3.5M12.5 16h3.5" />
    </Svg>
  )
}

/** כובע סיום — זכאות לבגרות */
export function IconGraduation(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4.5 21.5 9 12 13.5 2.5 9z" />
      <path d="M6.5 11.2v4c0 1.7 2.5 3.3 5.5 3.3s5.5-1.6 5.5-3.3v-4" />
      <path d="M21.5 9v5.5" />
    </Svg>
  )
}

/** בניין ציבורי — רשויות וניהול לקוחות */
export function IconLandmark(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 9 12 4l8.5 5z" />
      <path d="M6 10v7M10 10v7M14 10v7M18 10v7" />
      <path d="M4.5 17.5h15M3.5 20.5h17" />
    </Svg>
  )
}

/** בית — האזור האישי */
export function IconHome(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1V9.5" />
    </Svg>
  )
}

// ── מודול התקציב: הסרגל (24.10 — במקום אמוג'י)

/** עמודות — תמונת תקציב */
export function IconChartBars(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h16" />
      <path d="M7 16.5V11M12 16.5V6.5M17 16.5v-3.5" />
    </Svg>
  )
}

/** טבלה — מעקב ותכנון */
export function IconTable(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
    </Svg>
  )
}

/** דגל — חריגות לטיפול */
export function IconFlag(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5h11l-2 4 2 4h-11" />
    </Svg>
  )
}

/** שעון עם חץ אחורה — מה השתנה מאז העדכון הקודם */
export function IconHistory(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 12a8 8 0 1 0 2.3-5.7" />
      <path d="M4 4.5V8.5h4" />
      <path d="M12 8v4.2l2.8 1.8" />
    </Svg>
  )
}

/** מחוונים — סימולציית תקציב */
export function IconSliders(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Svg>
  )
}

/** רשימה — פירוט הפעולות */
export function IconList(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5h.5M4.5 12h.5M4.5 17.5h.5" />
    </Svg>
  )
}

/** קבלה — רכש */
export function IconReceipt(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
      <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
    </Svg>
  )
}

/** חץ למעלה אל מגש — קליטת קבצים */
export function IconUpload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 15.5V4.5" />
      <path d="M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
    </Svg>
  )
}
