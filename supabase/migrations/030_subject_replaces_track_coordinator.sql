-- מיגרציה 030: רכז מקצוע מחליף את רכז המגמה
--
-- ═══════════════════════════════════════════════════════════════
-- מה ולמה
-- ═══════════════════════════════════════════════════════════════
--
-- 026 הגדירה "רכז מגמה" (track_coordinator) — היקף לפי מגמת התלמיד. 027b
-- (שוחזרה מהמסד החי) הוסיפה לצידו "רכז מקצוע" (subject_coordinator) — היקף
-- לפי המקצועות. אייל, 7.10: *"רכז מגמה יהיה רכז מקצוע, וההתנהגות הנכונה היא
-- זו של רכז המקצוע"*. לכן נשאר תפקיד אחד:
--
--   subject_coordinator — רכז מקצוע: **רואה ועורך מעקב לכל תלמידי בית הספר**
--   (bagrut_schools). המקצועות שלו (bagrut_subject_keys) הם **מיקוד במסכים**
--   ("המקצועות שלי" בראש הסרגל) — לא הגבלת גישה. בלי עריכת המצפן.
--
-- למה לא "רואה רק תלמיד שיש לו ציון במקצוע" (כמו ב-027b): אייל, 7.10 — *"הרכז
-- צריך לראות את התלמיד"* גם לפני הציון הראשון. ו-T1 אינו יודע מי לומד מקצוע
-- כשאין ציון: כל תלמיד מקבל שורה כמעט לכל מקצוע, ומי שאין לו ציון — "טרם החל"
-- (באגיאל 4,568 שורות ל-216 תלמידים × 23 מקצועות). הגבלה לפי מקצוע הייתה
-- מסתירה בשקט את מי שעוד לא ניגש. 030 נכתבה מחדש לפני שנדחפה, והוחלה שוב.
--
-- רכז המגמה יוצא: מהאילוץ, מ-in_bagrut_scope ומ-may_edit_bagrut_student.
-- users.bagrut_tracks יוצאת גם היא — שימשה רק את התפקיד הזה. (bagrut_students.track
-- נשארת: זה נתון על התלמיד, לא הרשאה.)
--
-- בטוח: ב-7.10 אין אף משתמש עם תפקיד בגרות, ואף משתמש עם מגמות. רכז מגמה
-- שיימצא יהפוך לרכז מקצוע של אותם בתי ספר. והעמודה נמחקת רק אם ריקה.

-- ── 1. רכז מגמה קיים → רכז מקצוע (אם יש)
update public.users set bagrut_role = 'subject_coordinator'
 where bagrut_role = 'track_coordinator';

-- ── 2. האילוץ — בלי track_coordinator
alter table public.users drop constraint if exists users_bagrut_role_check;
alter table public.users add constraint users_bagrut_role_check
  check (bagrut_role = any (array['council', 'coordinator', 'grade_coordinator',
                                  'subject_coordinator', 'homeroom']));

-- ── 3. היקף: בלי ענף המגמה. החתימה (כולל track) נשארת — הפונקציות שקוראות לה לא משתנות.
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
             when u.bagrut_role = 'council' then true
             when not (school = any(u.bagrut_schools)) then false
             when u.bagrut_role = 'coordinator'       then true
             when u.bagrut_role = 'grade_coordinator' then grade      = any(u.bagrut_grades)
             when u.bagrut_role = 'homeroom'          then class_name = any(u.bagrut_classes)
             else false
           end
    from public.users u
    where u.id = auth.uid()), false);
$function$;

-- ── 4. עריכת מעקב: בלי track_coordinator
CREATE OR REPLACE FUNCTION public.may_edit_bagrut_student(p_round uuid, p_student text, school text, grade text, class_name text, track text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select not u.is_suspended
       and (u.role = 'super_admin'
            or (u.bagrut_role in ('coordinator', 'grade_coordinator',
                                  'subject_coordinator', 'homeroom')
                and public.bagrut_student_visible(p_round, p_student, school, grade,
                                                  class_name, track)))
    from public.users u
    where u.id = auth.uid()), false);
$function$;

-- ── 5. מי רואה תלמיד: רכז מקצוע — כל בית הספר. החתימה נשארת (p_round, p_student
-- כבר לא בשימוש לתפקיד הזה) — המדיניות שקוראות לה לא משתנות.
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
             -- המקצועות הם מיקוד במסכים, לא הגבלה: T1 אינו יודע מי לומד מקצוע לפני הציון
             when u.bagrut_role = 'subject_coordinator' then school = any(u.bagrut_schools)
             else public.in_bagrut_scope(school, grade, class_name, track)
           end
    from public.users u
    where u.id = auth.uid()), false);
$function$;

-- ── 6. users.bagrut_tracks — רק אם ריקה אצל כולם (לא מוחקים נתון בשקט)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'users' and column_name = 'bagrut_tracks') then
    if exists (select 1 from public.users where cardinality(bagrut_tracks) > 0) then
      raise notice 'users.bagrut_tracks לא נמחקה: יש בה ערכים';
    else
      alter table public.users drop column bagrut_tracks;
    end if;
  end if;
end $$;
