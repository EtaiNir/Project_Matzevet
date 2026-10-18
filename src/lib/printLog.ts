// ייצוא יומן המעקב ל-PDF — רשומה בודדת או היומן כולו (משימה 4, פגישת 14.10).
//
// לחיצה פותחת ישר את חלון "שמירה בשם" של המערכת — בלי חלון הדפסה (בקשה
// מפורשת, 18.10). בכרום ובאדג' זה showSaveFilePicker; בדפדפן אחר הקובץ
// פשוט יורד.
//
// איך נבנה הקובץ: דף ה-HTML (logHtml) מרונדר ב-iframe נסתר, וכל חלק בו —
// הכותרת, כל רשומה, התחתית — מצולם בנפרד (html2canvas) ומונח על עמודי A4
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

function entryHtml(e: BagrutLogEntry): string {
  const field = (label: string, value: string | null) =>
    value ? `<div class="f"><div class="l">${label}</div><div class="v">${esc(value)}</div></div>` : ''
  const meta = [fmtDate(e.happened_on), e.participants ? `משתתפים: ${esc(e.participants)}` : ''].filter(Boolean).join(' · ')
  return `<section class="entry">
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
  const sub = [p.className && `כיתה ${p.className}`, p.school, p.roundLabel].filter(Boolean).map((x) => esc(x as string)).join(' · ')
  const made = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
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
  footer { margin-top: 16px; color: #94a3b8; font-size: 8.5pt; border-top: 1px solid #e2e8f0; padding-top: 6px; }
</style></head><body>
<table class="page"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
<header>
  <h1>${esc(title)}</h1>
  <div class="sub">${sub}</div>
  ${single ? '' : `<div class="count">${p.entries.length} רשומות, מהחדשה לישנה</div>`}
</header>
${p.entries.map(entryHtml).join('\n')}
<footer>הופק מ${esc(SITE.name)} ב-${made} · זכאות לבגרות · יומן מעקב</footer>
</td></tr></tbody></table>
</body></html>`
}

const A4 = { w: 210, h: 297, margin: 14 }

/** "יומן מעקב - שם התלמיד.pdf" — בלי תווים שאסורים בשם קובץ */
function fileName(p: PrintLogInput): string {
  const kind = p.entries.length === 1 ? 'רשומת מעקב' : 'יומן מעקב'
  return `${kind} - ${p.studentName}`.replace(/[\\/:*?"<>|]/g, '').trim() + '.pdf'
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
 * שומר את היומן כקובץ PDF. מחזיר false אם המשתמש ביטל את חלון השמירה.
 * זורק שגיאה עם הודעה קריאה אם הבנייה נכשלה (מלכודת 15 — לומר איפה).
 */
export async function saveLogPdf(p: PrintLogInput): Promise<boolean> {
  const name = fileName(p)
  const target = await pickTarget(name)
  if (target === null) return false

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const { doc, dispose } = await renderFrame(logHtml(p))
  try {
    const blocks = [...doc.querySelectorAll<HTMLElement>('header, .entry, footer')]
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const width = A4.w - A4.margin * 2
    let y = A4.margin
    for (const el of blocks) {
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false })
      const h = (canvas.height / canvas.width) * width
      // רשומה שלא נכנסת בשארית העמוד — לעמוד חדש (אלא אם העמוד ריק ממילא)
      if (y + h > A4.h - A4.margin && y > A4.margin) {
        pdf.addPage()
        y = A4.margin
      }
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', A4.margin, y, width, h)
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
