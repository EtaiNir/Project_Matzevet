// ייצוא ל-PDF מלשונית המעקב — שני מסמכים:
//   · יומן המעקב — רשומה בודדת או היומן כולו (משימה 4, פגישת 14.10). logHtml
//   · סיכום ותוכנית — הפגישה האחרונה, ניתוח הזכאות (הרקע לשיחה) ותוכנית
//     ההתערבות (אייל, 21.10). briefHtml
//
// לחיצה פותחת ישר את חלון "שמירה בשם" של המערכת — בלי חלון הדפסה (בקשה
// מפורשת, 18.10). בכרום ובאדג' זה showSaveFilePicker; בדפדפן אחר הקובץ
// פשוט יורד.
//
// איך נבנה הקובץ: דף ה-HTML מרונדר ב-iframe נסתר, וכל חלק בו (.blk) — הכותרת,
// כל רשומה, כל שדה ארוך, כל פעולה, התחתית — מצולם בנפרד (html2canvas) ומונח על עמודי A4
// (jsPDF). כך העברית והיישור לימין יוצאים בדיוק כמו בדפדפן, ורשומה לעולם
// אינה נחתכת בין שני עמודים. המחיר: הטקסט בקובץ הוא תמונה — אי אפשר לסמן
// אותו או לחפש בו. PDF עם טקסט אמיתי היה דורש להטמיע גופן עברי ולהפוך
// כיווני טקסט בעצמנו.
//
// שתי הספריות נטענות רק בלחיצה (import דינמי) — האתר עצמו אינו נעשה כבד.
//
// 🔒 הכול נבנה בזיכרון, ושום דבר לא נשמר בדפדפן. ת"ז אינה מודפסת: שם, כיתה
// ובית ספר מספיקים לזיהוי בתיק, ודף מודפס מסתובב.

import { LOG_KIND_LABELS, type BagrutLogEntry } from '@/lib/bagrut'
import { fmtDate } from '@/lib/bagrutCycle'
import { SITE } from '@/config/site'

export interface PrintLogInput {
  studentName: string
  className: string | null
  school: string
  /** "קיץ תשפ"ו" */
  roundLabel: string
  entries: BagrutLogEntry[]
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const made = () => new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
const subLine = (p: { className: string | null; school: string; roundLabel: string }) =>
  [p.className && `כיתה ${p.className}`, p.school, p.roundLabel].filter(Boolean).map((x) => esc(x as string)).join(' · ')

/** העיצוב המשותף לשני המסמכים — עמוד A4, עברית, ימין לשמאל */
const BASE_CSS = `
  @page { size: A4; margin: 0; }
  html, body { margin: 0; }
  body { padding: 0 14mm; }
  table.page { width: 100%; border-collapse: collapse; }
  table.page > thead td { height: 14mm; }
  table.page > tfoot td { height: 14mm; }
  table.page td { padding: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, "Noto Sans Hebrew", sans-serif; color: #1e293b; font-size: 11.5pt; line-height: 1.55; }
  header { border-bottom: 2px solid #0284c7; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 18pt; }
  .sub { color: #475569; font-size: 10.5pt; margin-top: 2px; }
  .count { color: #64748b; font-size: 9.5pt; margin-top: 4px; }
  .entry { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; break-inside: avoid; }
  h2 { margin: 0 0 6px; font-size: 12.5pt; }
  .meta { font-weight: normal; color: #64748b; font-size: 10pt; margin-right: 8px; }
  .f { margin-top: 6px; }
  .l { font-size: 9pt; font-weight: bold; color: #64748b; }
  .v { white-space: pre-wrap; }
  /* padding-bottom: כל חלק מצולם בנפרד בגבולות הקופסה שלו — בלי ריווח מתחת לשורה
     האחרונה, תחתית האותיות נחתכת (קרה בתחתית, 18.10) */
  footer { margin-top: 16px; color: #94a3b8; font-size: 8.5pt; line-height: 1.8; border-top: 1px solid #e2e8f0; padding: 6px 0 6px; }
`

function entryHtml(e: BagrutLogEntry): string {
  const field = (label: string, value: string | null) =>
    value ? `<div class="f"><div class="l">${label}</div><div class="v">${esc(value)}</div></div>` : ''
  const meta = [fmtDate(e.happened_on), e.participants ? `משתתפים: ${esc(e.participants)}` : ''].filter(Boolean).join(' · ')
  return `<section class="entry blk">
    <h2>${LOG_KIND_LABELS[e.kind]}<span class="meta">${meta}</span></h2>
    ${field('מה עלה', e.summary)}
    ${field('על מה הוסכם', e.agreements)}
    ${field('הצעד הבא', e.next_step)}
    ${field('מעקב הבא', e.next_followup ? fmtDate(e.next_followup) : null)}
  </section>`
}

export function logHtml(p: PrintLogInput): string {
  const single = p.entries.length === 1
  const title = single ? `רשומת מעקב — ${p.studentName}` : `יומן מעקב — ${p.studentName}`
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${BASE_CSS}</style></head><body>
<table class="page"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
<header class="blk">
  <h1>${esc(title)}</h1>
  <div class="sub">${subLine(p)}</div>
  ${single ? '' : `<div class="count">${p.entries.length} רשומות, מהחדשה לישנה</div>`}
</header>
${p.entries.map(entryHtml).join('\n')}
<footer class="blk">הופק מ${esc(SITE.name)} ב-${made()} · זכאות לבגרות · יומן מעקב</footer>
</td></tr></tbody></table>
</body></html>`
}

// ─────────────────────────────── סיכום ותוכנית ───────────────────────────────

export interface BriefAction {
  title: string
  detail: string | null
  status: 'active' | 'done'
  actionType: string | null
  owner: string | null
  due: string | null
  requiredGrade: number | null
  outcome: string | null
}

export interface BriefSuggestion {
  title: string
  why: string | null
  how: string | null
  subject: string | null
  owner: string | null
  requiredGrade: number | null
}

export interface BriefInput {
  studentName: string
  className: string | null
  school: string
  roundLabel: string
  /** הפגישה האחרונה ביומן; null — היומן ריק */
  lastEntry: BagrutLogEntry | null
  eligibility: {
    /** false — לתלמיד אין ניתוח זכאות (לא בשכבה המסיימת) */
    graduating: boolean
    /** "זכאי" / "אין זכאות" / "זכאי במסלול שלילי אחד" — כולל שינוי ידני */
    status: string
    /** שינוי ידני בתוקף — מי, מתי, למה, ומה קבע ניתוח הזכאות (043) */
    manual: string | null
    fields: { label: string; value: string | null; short: boolean }[]
  }
  plan: {
    approved: BriefAction[]
    suggestions: BriefSuggestion[]
    /** הערת ה-AI לתוכנית */
    aiNote: string | null
    /** מתי נוצרו ההצעות; generatedNow — נוצרו עכשיו, בשביל המסמך */
    aiAt: string | null
    generatedNow: boolean
  }
}

const BRIEF_CSS = `
  .sec { margin-top: 14px; }
  .sec h2 { font-size: 13.5pt; color: #0c4a6e; border-bottom: 1px solid #bae6fd; padding-bottom: 3px; margin-bottom: 8px; }
  .hint { color: #64748b; font-size: 9.5pt; margin: -4px 0 8px; }
  .status { display: inline-block; font-weight: bold; font-size: 12.5pt; padding: 2px 12px; border-radius: 999px; background: #f1f5f9; }
  .status.ok { background: #dcfce7; color: #166534; }
  .status.no { background: #ffe4e6; color: #9f1239; }
  .manual { margin-top: 6px; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 6px; padding: 6px 10px; font-size: 10pt; color: #4c1d95; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 14px; margin-top: 10px; background: #f8fafc; border-radius: 8px; padding: 8px 12px; }
  .act { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; }
  .act.sug { border-style: dashed; border-color: #a78bfa; background: #faf5ff; }
  .act .t { font-weight: bold; }
  .tag { display: inline-block; font-size: 8.5pt; font-weight: bold; padding: 0 7px; border-radius: 999px; margin-left: 6px; vertical-align: 1px; }
  .tag.active { background: #e0f2fe; color: #075985; }
  .tag.done { background: #dcfce7; color: #166534; }
  .tag.sug { background: #ede9fe; color: #5b21b6; }
  .chips { margin-top: 4px; color: #475569; font-size: 9.5pt; }
  .empty { color: #94a3b8; font-size: 10.5pt; }
`

function actionHtml(a: BriefAction): string {
  const chips = [a.actionType, a.owner && `אחראי: ${a.owner}`, a.due && `עד: ${a.due}`, a.requiredGrade != null && `ציון נדרש: ${a.requiredGrade}`]
    .filter(Boolean).map((x) => esc(String(x))).join(' · ')
  return `<div class="act blk">
    <div class="t"><span class="tag ${a.status}">${a.status === 'done' ? 'הושלם' : 'בביצוע'}</span>${esc(a.title)}</div>
    ${a.detail ? `<div class="v">${esc(a.detail)}</div>` : ''}
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${a.outcome ? `<div class="f"><div class="l">תוצאה</div><div class="v">${esc(a.outcome)}</div></div>` : ''}
  </div>`
}

function suggestionHtml(x: BriefSuggestion, i: number): string {
  const chips = [x.subject, x.owner && `אחראי: ${x.owner}`, x.requiredGrade != null && `ציון נדרש: ${x.requiredGrade}`]
    .filter(Boolean).map((v) => esc(String(v))).join(' · ')
  return `<div class="act sug blk">
    <div class="t"><span class="tag sug">הצעה — טרם אושרה</span>${i + 1}. ${esc(x.title)}</div>
    ${x.why ? `<div class="chips">מטפל ב: ${esc(x.why)}</div>` : ''}
    ${x.how ? `<div class="v">${esc(x.how)}</div>` : ''}
    ${chips ? `<div class="chips">${chips}</div>` : ''}
  </div>`
}

/**
 * כותרת פרק צמודה לחלק הראשון שלו — כך כותרת לעולם אינה נשארת לבד בתחתית
 * עמוד. החלק הראשון מקבל את הכותרת לפניו, בתוך אותו .blk.
 */
function section(title: string, hint: string | null, parts: string[]): string {
  const head = `<h2>${esc(title)}</h2>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}`
  if (!parts.length) return `<div class="sec blk">${head}</div>`
  const [first, ...rest] = parts
  return `<div class="sec blk">${head}${first.replace(/^\s*<div class="([^"]*)\bblk\b/, '<div class="$1')}</div>${rest.join('\n')}`
}

export function briefHtml(p: BriefInput): string {
  const title = `סיכום ותוכנית — ${p.studentName}`
  const e = p.lastEntry

  const meeting = e
    ? [`<div class="entry blk">
        <h2>${LOG_KIND_LABELS[e.kind]}<span class="meta">${[fmtDate(e.happened_on), e.participants ? `משתתפים: ${esc(e.participants)}` : ''].filter(Boolean).join(' · ')}</span></h2>
        ${[['מה עלה', e.summary], ['על מה הוסכם', e.agreements], ['הצעד הבא', e.next_step], ['מעקב הבא', e.next_followup ? fmtDate(e.next_followup) : null]]
          .map(([l, v]) => (v ? `<div class="f"><div class="l">${l}</div><div class="v">${esc(v)}</div></div>` : '')).join('')}
      </div>`]
    : ['<div class="blk"><p class="empty">אין עדיין רשומה ביומן המעקב.</p></div>']

  const el = p.eligibility
  const tone = el.status.startsWith('אין') ? 'no' : el.status.startsWith('זכאי') ? 'ok' : ''
  const short = el.fields.filter((f) => f.short)
  const long = el.fields.filter((f) => !f.short)
  const eligibility = el.graduating
    ? [
        `<div class="blk"><span class="status ${tone}">${esc(el.status)}</span>
          ${el.manual ? `<div class="manual">${esc(el.manual)}</div>` : ''}
          <div class="grid">${short.map((f) => `<div><div class="l">${esc(f.label)}</div><div>${f.value ? esc(f.value) : '—'}</div></div>`).join('')}</div>
        </div>`,
        ...long.map((f) => `<div class="f blk"><div class="l">${esc(f.label)}</div><div class="v">${f.value ? esc(f.value) : '—'}</div></div>`),
      ]
    : ['<div class="blk"><p class="empty">לתלמיד אין ניתוח זכאות — הוא נעשה לשכבה המסיימת בלבד.</p></div>']

  const pl = p.plan
  const planParts = [
    ...pl.approved.map(actionHtml),
    ...(pl.suggestions.length
      ? [
          `<div class="blk"><div class="hint" style="margin:6px 0">${pl.generatedNow ? 'נוצרו עכשיו ע"י ה-AI, בשביל המסמך הזה' : `הצעות ה-AI${pl.aiAt ? ` מ-${esc(fmtDate(pl.aiAt))}` : ''}`} · לפי סדר העדיפות · המורה מחליט מה נכנס לתוכנית${pl.aiNote ? `<br>${esc(pl.aiNote)}` : ''}</div></div>`,
          ...pl.suggestions.map(suggestionHtml),
        ]
      : []),
  ]
  if (!planParts.length) planParts.push('<div class="blk"><p class="empty">אין פעולות בתוכנית.</p></div>')

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${BASE_CSS}${BRIEF_CSS}</style></head><body>
<table class="page"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
<header class="blk">
  <h1>${esc(title)}</h1>
  <div class="sub">${subLine(p)}</div>
  <div class="count">הפגישה האחרונה · ניתוח הזכאות · תוכנית ההתערבות</div>
</header>
${section('הפגישה האחרונה', null, meeting)}
${section('ניתוח הזכאות', 'הרקע לשיחה — כפי שהגיע בניתוח הזכאות', eligibility)}
${section('תוכנית ההתערבות', pl.approved.length ? `${pl.approved.filter((a) => a.status === 'active').length} בביצוע · ${pl.approved.filter((a) => a.status === 'done').length} הושלמו` : null, planParts)}
<footer class="blk">הופק מ${esc(SITE.name)} ב-${made()} · זכאות לבגרות · סיכום ותוכנית</footer>
</td></tr></tbody></table>
</body></html>`
}

const A4 = { w: 210, h: 297, margin: 14 }

/** "יומן מעקב - שם התלמיד.pdf" — בלי תווים שאסורים בשם קובץ */
function fileName(kind: string, studentName: string): string {
  return `${kind} - ${studentName}`.replace(/[\\/:*?"<>|]/g, '').trim() + '.pdf'
}

type SaveTarget = { write: (blob: Blob) => Promise<void> } | null

/**
 * חלון "שמירה בשם" — חייב להיפתח מיד בלחיצה (הדפדפן מתיר אותו רק בתגובה
 * ישירה למשתמש), ולכן לפני בניית הקובץ. null = המשתמש ביטל.
 */
async function pickTarget(name: string): Promise<SaveTarget | 'download'> {
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker
  if (!picker) return 'download'
  try {
    const handle = await picker({ suggestedName: name, types: [{ description: 'מסמך PDF', accept: { 'application/pdf': ['.pdf'] } }] })
    return {
      write: async (blob) => {
        const w = await handle.createWritable()
        await w.write(blob)
        await w.close()
      },
    }
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null
    return 'download' // חסום (iframe, מדיניות) — נופלים להורדה רגילה
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** מרנדר את הדף ב-iframe נסתר ברוחב A4, ומחזיר את המסמך שלו */
function renderFrame(html: string): Promise<{ doc: Document; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    // 794px = רוחב A4 ב-96dpi; מחוץ למסך, אבל בגודל אמיתי כדי שהפריסה תהיה נכונה
    Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '794px', height: '1123px', border: '0' })
    frame.onload = async () => {
      const doc = frame.contentDocument
      if (!doc) return reject(new Error('בניית הקובץ נכשלה'))
      await doc.fonts?.ready
      resolve({ doc, dispose: () => frame.remove() })
    }
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}

/**
 * בונה PDF מדף HTML ושומר אותו. מחזיר false אם המשתמש ביטל את חלון השמירה.
 * `build` רץ **אחרי** חלון השמירה — החלון חייב להיפתח מיד בלחיצה, ו-build יכול
 * לקחת זמן (בקשה ל-AI). שגיאה ב-build עוברת כמו שהיא; שגיאה בבנייה — עם הודעה
 * קריאה (מלכודת 15 — לומר איפה).
 */
async function savePdf(name: string, build: () => Promise<string>): Promise<boolean> {
  const target = await pickTarget(name)
  if (target === null) return false
  const html = await build()

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const { doc, dispose } = await renderFrame(html)
  try {
    const blocks = [...doc.querySelectorAll<HTMLElement>('.blk')]
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const width = A4.w - A4.margin * 2
    const maxH = A4.h - A4.margin * 2
    let y = A4.margin
    for (const el of blocks) {
      // הצילום בגבולות הקופסה בדיוק — ולכן לכל חלק יש ריווח מתחת לשורה האחרונה
      // (ראה footer ב-CSS). ⚠️ לא לחתוך עם x/y של html2canvas: נבדק, והצילום זז
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false })
      let w = width
      let h = (canvas.height / canvas.width) * width
      // חלק גבוה מעמוד שלם (טקסט ארוך מאוד) — מוקטן כדי להיכנס, צמוד לימין
      if (h > maxH) {
        w = width * (maxH / h)
        h = maxH
      }
      // חלק שלא נכנס בשארית העמוד — לעמוד חדש (אלא אם העמוד ריק ממילא)
      if (y + h > A4.h - A4.margin && y > A4.margin) {
        pdf.addPage()
        y = A4.margin
      }
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', A4.margin + (width - w), y, w, h)
      y += h + 3
    }
    const blob = pdf.output('blob')
    if (target === 'download') download(blob, name)
    else await target.write(blob)
    return true
  } catch (e) {
    throw new Error(`יצירת קובץ ה-PDF נכשלה: ${(e as Error).message}`)
  } finally {
    dispose()
  }
}

/** יומן המעקב — רשומה בודדת או כולו. מחזיר false אם המשתמש ביטל. */
export function saveLogPdf(p: PrintLogInput): Promise<boolean> {
  return savePdf(fileName(p.entries.length === 1 ? 'רשומת מעקב' : 'יומן מעקב', p.studentName), async () => logHtml(p))
}

/**
 * סיכום ותוכנית. `build` אוסף את התוכן אחרי חלון השמירה — כולל יצירת הצעות
 * ב-AI כשאין תוכנית. מחזיר false אם המשתמש ביטל.
 */
export function saveBriefPdf(studentName: string, build: () => Promise<BriefInput>): Promise<boolean> {
  return savePdf(fileName('סיכום ותוכנית', studentName), async () => briefHtml(await build()))
}
