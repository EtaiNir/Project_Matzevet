// Edge Function: ניהול משתמשים — יצירה, קביעת סיסמה, ומחיקה.
//
// למה נדרשת פונקציה בצד שרת: יצירת משתמש וקביעת סיסמה מחייבות את מפתח
// ה-service_role, שאסור שיגיע לדפדפן. הפונקציה מחזיקה אותו בצד השרת,
// ומוודאת בעצמה שהקורא הוא מנהל-על לפני כל פעולה.
//
// פריסה:
//   supabase functions deploy admin-users --project-ref agcoeqshvkyopjjdvril
//
// משתני סביבה (מוגדרים אוטומטית ע"י Supabase):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** תפקידים והיקפים מותרים — נאכפים גם כאן, לא רק ב-UI. */
const ROLES = ['viewer', 'admin', 'super_admin']
// 'none' = אין גישה למצבת (מיגרציה 032). כל מוצר מוענק בנפרד, במפורש.
const SCOPES = ['none', 'council', 'locality', 'school']
// תפקידי הבגרות (026, 030). null = אין גישה לבגרות.
const BAGRUT_ROLES = ['council', 'coordinator', 'grade_coordinator', 'subject_coordinator', 'homeroom']
// תפקידי התקציב (044). null = אין גישה לתקציב.
const BUDGET_ROLES = ['manager', 'owner', 'viewer']

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []

/** שגיאות Supabase מגיעות באנגלית — מתרגמים את הנפוצות לממשק עברי. */
function translate(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('already been registered') || m.includes('already exists')) {
    return 'כתובת המייל כבר רשומה במערכת'
  }
  if (m.includes('invalid format') || m.includes('validate email')) {
    return 'כתובת המייל אינה תקינה'
  }
  if (m.includes('password') && m.includes('at least')) {
    return 'הסיסמה קצרה מדי'
  }
  if (m.includes('weak') || m.includes('pwned') || m.includes('leaked')) {
    return 'הסיסמה חלשה מדי או שדלפה בעבר — בחר סיסמה אחרת'
  }
  if (m.includes('user not found')) {
    return 'המשתמש לא נמצא'
  }
  return message
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/**
 * מאמת שהקורא מחובר ושהתפקיד שלו super_admin.
 * מחזיר את מזהה המשתמש, או null אם אינו מורשה.
 */
async function requireSuperAdmin(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth) return null

  // לקוח בהקשר המשתמש — כדי לזהות מי קורא
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  })
  const { data: { user }, error } = await asUser.auth.getUser()
  if (error || !user) return null

  // התפקיד נקרא עם service_role כדי לא להיות תלוי במדיניות RLS
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'super_admin' ? user.id : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const callerId = await requireSuperAdmin(req)
  if (!callerId) return json({ error: 'נדרשת הרשאת מנהל־על' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'גוף בקשה לא תקין' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const action = String(body.action ?? '')

  try {
    // ─────────────── יצירת משתמש ───────────────
    if (action === 'create') {
      const email = String(body.email ?? '').trim()
      const password = String(body.password ?? '')
      const role = String(body.role ?? 'viewer')
      // ברירת המחדל: בלי גישה. מצבת מוענקת רק כשנשלח היקף במפורש.
      const scopeLevel = String(body.scope_level ?? 'none')
      const authorityCodes = strArray(body.authority_codes)
      const scopeValues = scopeLevel === 'none' || scopeLevel === 'council' ? [] : strArray(body.scope_values)
      const bagrutRole = body.bagrut_role ? String(body.bagrut_role) : null
      const bagrutScoped = Boolean(bagrutRole) && bagrutRole !== 'council' && bagrutRole !== 'coordinator'
      const budgetRole = body.budget_role ? String(body.budget_role) : null

      if (!email || !password) return json({ error: 'חסרים מייל או סיסמה' }, 400)
      if (password.length < 8) return json({ error: 'הסיסמה חייבת להיות באורך 8 תווים לפחות' }, 400)
      if (!ROLES.includes(role)) return json({ error: 'תפקיד לא מוכר' }, 400)
      if (!SCOPES.includes(scopeLevel)) return json({ error: 'היקף לא מוכר' }, 400)
      if (bagrutRole && !BAGRUT_ROLES.includes(bagrutRole)) return json({ error: 'תפקיד בגרות לא מוכר' }, 400)
      if (budgetRole && !BUDGET_ROLES.includes(budgetRole)) return json({ error: 'תפקיד תקציב לא מוכר' }, 400)
      // מנהל־על רואה הכול ממילא; לכל השאר — מוצר אחד לפחות, אחרת המשתמש לא יראה כלום
      if (role !== 'super_admin' && scopeLevel === 'none' && !bagrutRole && !budgetRole) {
        return json({ error: 'יש לבחור מוצר אחד לפחות: מצבת תלמידים, זכאות לבגרות או ניהול תקציב' }, 400)
      }

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // אין שליחת מייל אישור — סבא מוסר את הסיסמה ידנית
        user_metadata: {
          display_name: String(body.display_name ?? '') || email,
          role,
          authority_codes: authorityCodes,
        },
      })
      if (error) return json({ error: translate(error.message) }, 400)

      // הטריגר handle_new_auth_user יצר את הרשומה; משלימים את שני המוצרים
      const { error: updErr } = await admin
        .from('users')
        .update({
          // מנהל־על — כל הרשות במצבת, כמו שאר מנהלי־העל
          scope_level: role === 'super_admin' ? 'council' : scopeLevel,
          scope_values: role === 'super_admin' ? [] : scopeValues,
          // בגרות (מיגרציה 037): מועצתי — בלי היקף; רכז בגרויות — בתי הספר בלבד;
          // כל השאר — איחוד של השכבות, הכיתות והמקצועות שסומנו (מחנך יכול להיות גם רכז מקצוע)
          bagrut_role: bagrutRole,
          // מנהל/ת בית ספר — כותרת בלבד, רק עם "כל בית הספר" (039)
          bagrut_title: bagrutRole === 'coordinator' && body.bagrut_title === 'principal' ? 'principal' : null,
          bagrut_schools: bagrutRole && bagrutRole !== 'council' ? strArray(body.bagrut_schools) : [],
          bagrut_grades: bagrutScoped ? strArray(body.bagrut_grades) : [],
          bagrut_classes: bagrutScoped ? strArray(body.bagrut_classes) : [],
          bagrut_subject_keys: bagrutScoped ? strArray(body.bagrut_subject_keys) : [],
          // תקציב (044) — רק כשהוענק: כך יצירת משתמש בלי תקציב עובדת גם במסד שעוד אין בו 044
          ...(budgetRole && role !== 'super_admin'
            ? {
                budget_role: budgetRole,
                budget_categories: budgetRole === 'owner' ? strArray(body.budget_categories) : [],
              }
            : {}),
        })
        .eq('id', data.user.id)
      if (updErr) return json({ error: translate(updErr.message) }, 400)

      return json({ ok: true, id: data.user.id, email: data.user.email })
    }

    // ─────────────── קביעת סיסמה ───────────────
    if (action === 'set_password') {
      const id = String(body.id ?? '')
      const password = String(body.password ?? '')
      if (!id || !password) return json({ error: 'חסרים מזהה או סיסמה' }, 400)
      if (password.length < 8) return json({ error: 'הסיסמה חייבת להיות באורך 8 תווים לפחות' }, 400)

      const { error } = await admin.auth.admin.updateUserById(id, { password })
      if (error) return json({ error: translate(error.message) }, 400)
      return json({ ok: true })
    }

    // ─────────────── השהיה / החזרה לפעילות ───────────────
    // ban ב-Auth חוסם את הכניסה עצמה; הדגל ב-public.users מנטרל גם טוקן
    // שנשאר תקף מלפני ההשהיה (ראה מיגרציה 007).
    if (action === 'set_suspended') {
      const id = String(body.id ?? '')
      const suspended = Boolean(body.suspended)
      if (!id) return json({ error: 'חסר מזהה' }, 400)
      if (id === callerId) return json({ error: 'אי אפשר להשהות את המשתמש שלך' }, 400)

      const { error: banErr } = await admin.auth.admin.updateUserById(id, {
        ban_duration: suspended ? '876000h' : 'none', // ~100 שנה / ביטול
      })
      if (banErr) return json({ error: translate(banErr.message) }, 400)

      const { error } = await admin
        .from('users')
        .update({ is_suspended: suspended })
        .eq('id', id)
      if (error) return json({ error: translate(error.message) }, 400)

      return json({ ok: true, suspended })
    }

    // ─────────────── מחיקת משתמש ───────────────
    if (action === 'delete') {
      const id = String(body.id ?? '')
      if (!id) return json({ error: 'חסר מזהה' }, 400)
      if (id === callerId) return json({ error: 'אי אפשר למחוק את המשתמש שלך' }, 400)

      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) return json({ error: translate(error.message) }, 400)
      return json({ ok: true })
    }

    return json({ error: `פעולה לא מוכרת: ${action}` }, 400)
  } catch (e) {
    return json({ error: translate((e as Error).message) }, 500)
  }
})
