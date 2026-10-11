-- מיגרציה 032: "בלי גישה למצבת" — ומשתמש חדש מתחיל בלי גישה
--
-- ═══════════════════════════════════════════════════════════════
-- למה
-- ═══════════════════════════════════════════════════════════════
--
-- הגישה למצבת = שיוך לרשות (authority_codes) + היקף (scope_level). לא הייתה
-- אפשרות "בלי גישה", וברירת המחדל הייתה 'council' — כל תלמידי הרשות. וגם
-- הבגרות דורשת שיוך לרשות (has_authority). כלומר מחנכת שקיבלה גישה לבגרות
-- הייתה מקבלת אוטומטית את כל המצבת של הרשות: ת"ז, כתובות, טלפונים של קטינים.
--
-- עכשיו כל מוצר מוענק בנפרד (אייל, 11.10):
--   scope_level = 'none'  →  אין גישה למצבת. in_user_scope מחזירה false.
--   bagrut_role = null     →  אין גישה לבגרות (כמו קודם).
--
-- וברירת המחדל של scope_level היא 'none': משתמש חדש — גם אם נוצר ישירות
-- בלוח של Supabase, דרך הטריגר handle_new_auth_user שאינו קובע היקף —
-- מתחיל בלי גישה, ומקבל מוצרים רק כשמסמנים אותם במפורש ביצירה. שכחה לבחור
-- היקף כבר לא פותחת את כל הרשות.
--
-- משתמשים קיימים לא משתנים.

alter table public.users drop constraint if exists users_scope_level_check;
alter table public.users add constraint users_scope_level_check
  check (scope_level = any (array['none', 'council', 'locality', 'school']));

alter table public.users alter column scope_level set default 'none';

comment on column public.users.scope_level is
  'היקף במצבת: none (אין גישה), council (כל הרשות), locality (יישובים ב-scope_values), school (מוסדות ב-scope_values)';

-- 'none' כבר נופל ל-else false; הענף המפורש — כדי שהכוונה תהיה כתובה.
CREATE OR REPLACE FUNCTION public.in_user_scope(semel_yishuv text, semel_mosad text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
           when u.is_suspended then false
           when u.scope_level = 'none'     then false
           when u.scope_level = 'council'  then true
           when u.scope_level = 'locality' then semel_yishuv = any(u.scope_values)
           when u.scope_level = 'school'   then semel_mosad  = any(u.scope_values)
           else false
         end
  from public.users u
  where u.id = auth.uid();
$function$;
