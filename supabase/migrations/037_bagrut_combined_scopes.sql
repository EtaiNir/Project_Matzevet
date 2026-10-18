-- ═══════════════════════════════════════════════════════════════
-- 037 — בבגרות: רואים את כל מה שסומן, לא לפי תפקיד אחד
-- ═══════════════════════════════════════════════════════════════
-- עד עכשיו לכל משתמש היה תפקיד אחד, והתפקיד קבע איזו עמודת היקף נקראת:
-- מחנך ← כיתות, רכז שכבה ← שכבות, רכז מקצוע ← מקצועות. מחנך שהוא גם רכז
-- מקצוע לא היה אפשרי.
--
-- סבא (פגישה 14.10): *"הגדרת התפקיד תהיה רק כותרת, ואת כל ההרשאות
-- הספציפיות לתפור לכל אחד"*. אייל בחר: מסמנים מה המשתמש רואה.
--
-- הכלל החדש לכל משתמש בית־ספרי (לא מועצתי, לא רכז בגרויות):
--   רואה תלמיד בבית ספר שלו אם הוא בשכבה שסומנה, **או** בכיתה שסומנה, **או**
--   במקצוע שסומן (ציון שאלון אחד לפחות — 036).
-- איחוד, לא חיתוך. רשימה ריקה לא מוסיפה כלום (ולא "הכול").
--
-- נשארים כמו שהם:
--   council     — צפייה בכל בתי הספר ברשויות שלו, בלי עריכה.
--   coordinator — "כל בית הספר", ועריכת המצפן.
-- bagrut_role נשאר עמודה אחת — התפקיד הראשי, לכותרת ולהבחנות שלמעלה. הממשק
-- גוזר אותו ממה שסומן.
--
-- רק שני הפונקציות משתנות. המדיניות לא משתנות: הן קוראות ל-
-- bagrut_student_visible (027b) ולפונקציות העריכה, שנשענות עליה.

-- ── מי רואה תלמיד — נקודת ההחלטה היחידה
CREATE OR REPLACE FUNCTION public.bagrut_student_visible(p_round uuid, p_student text, school text, grade text, class_name text, track text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
             when u.is_suspended then false
             when u.role = 'super_admin' then true
             when u.bagrut_role is null then false
             when u.bagrut_role = 'council' then true
             when not (school = any(u.bagrut_schools)) then false
             when u.bagrut_role = 'coordinator' then true
             -- איחוד של כל מה שסומן
             else coalesce(grade = any(u.bagrut_grades), false)
               or coalesce(class_name = any(u.bagrut_classes), false)
               or (cardinality(u.bagrut_subject_keys) > 0
                   and public.bagrut_subject_member(p_round, p_student, u.bagrut_subject_keys))
           end
    from public.users u
    where u.id = auth.uid()), false);
$function$;

-- ── אותו כלל בלי מקצועות (אין כאן סבב ותלמיד) — לעקביות עם מי שעוד קורא לה
CREATE OR REPLACE FUNCTION public.in_bagrut_scope(school text, grade text, class_name text, track text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
             when u.is_suspended then false
             when u.role = 'super_admin' then true
             when u.bagrut_role is null then false
             when u.bagrut_role = 'council' then true
             when not (school = any(u.bagrut_schools)) then false
             when u.bagrut_role = 'coordinator' then true
             else coalesce(grade = any(u.bagrut_grades), false)
               or coalesce(class_name = any(u.bagrut_classes), false)
           end
    from public.users u
    where u.id = auth.uid()), false);
$function$;

-- ── סמל מוסד של משרד החינוך — 6 ספרות (סבא, 14.10). כל הקיימים עומדים בזה.
alter table public.bagrut_schools drop constraint if exists bagrut_schools_school_code_check;
alter table public.bagrut_schools add constraint bagrut_schools_school_code_check
  check (school_code ~ '^\d{6}$');
