-- ═══════════════════════════════════════════════════════════════
-- 035 — רכז מקצוע רואה רק את תלמידי המקצועות שלו
-- ═══════════════════════════════════════════════════════════════
-- הופך את 030. שם נקבע שרכז מקצוע רואה את כל בית הספר, והמקצועות שלו הם
-- מיקוד בלבד — כי תלמיד שעוד לא ניגש נעלם מהרכז (027b). אייל, 13.10:
-- *"שיראה את כל התלמידים שרשומים למקצוע — אני מסמן בבחירה מה הוא רואה, נגיד
-- אנגלית 3, 4, 5"*.
--
-- הבעיה של 027b עדיין קיימת בנתונים: T1 נותן לכל תלמיד שורה בכל מקצוע
-- (באגיאל 216 × 23), ומי שלא ניגש — "טרם החל". "רשום למקצוע" אינו כתוב בשום
-- מקום. מה שכן כתוב: מי התחיל (ציון, או "בתהליך" / "הושלם"). לכן:
--
--   1. תלמיד שהתחיל אחד מהמקצועות של הרכז — שלו.
--   2. מקצוע חובה ("חובה", "אנגלית ומתמטיקה"): תלמיד שלא התחיל אף רמה של
--      המקצוע — שלו גם כן. כל תלמיד לומד אנגלית; מי שעוד לא ניגש לאף רמה
--      שייך לכל רכזי האנגלית, ולא נעלם (זו התקלה של 027b).
--   3. מקצוע בחירה ("מורחב", "פנימי") — רק מי שהתחיל. תלמיד שלא ניגש לכימיה
--      אינו תלמיד כימיה.
--
-- "רמות של אותו מקצוע" — לפי השם בלי היחידות: "אנגלית 4 יח"ל" ו-"אנגלית 4"
-- (Anglit4) הם שניהם "אנגלית". עובד בשני מבני הקלט.
--
-- נאכף ב-RLS: bagrut_student_visible היא נקודת ההחלטה היחידה. הציונים,
-- המקצועות, המעקב, התוכנית והיומן נגזרים ממנה דרך bagrut_students.

-- שם המקצוע בלי מספר היחידות בסופו
create or replace function public.bagrut_subject_family(name text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(coalesce(name, ''), '\s*\d+\s*(יח"ל|יח״ל)?\s*$', ''));
$$;

-- האם התלמיד שייך לאחד המקצועות (מפתחות של הסבב) — לפי שלושת הכללים למעלה
create or replace function public.bagrut_subject_member(p_round uuid, p_student text, p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- 1. התחיל אחד מהמקצועות שלו
    exists (
      select 1 from public.bagrut_subjects s
       where s.round_id = p_round and s.student_id = p_student
         and s.subject_key = any(p_keys)
         and (s.final_grade is not null or s.cumulative_grade is not null
              or s.completion_status in ('בתהליך', 'הושלם')))
    or
    -- 2. מקצוע חובה שהתלמיד לא התחיל אף רמה שלו
    exists (
      select 1 from public.bagrut_round_subjects m
       where m.round_id = p_round and m.subject_key = any(p_keys)
         and m.subject_group in ('חובה', 'אנגלית ומתמטיקה')
         and not exists (
           select 1
             from public.bagrut_round_subjects f
             join public.bagrut_subjects s
               on s.round_id = f.round_id and s.subject_key = f.subject_key
            where f.round_id = p_round
              and public.bagrut_subject_family(f.subject_name) = public.bagrut_subject_family(m.subject_name)
              and s.student_id = p_student
              and (s.final_grade is not null or s.cumulative_grade is not null
                   or s.completion_status in ('בתהליך', 'הושלם'))));
$$;

-- מי רואה תלמיד — רק ענף רכז המקצוע משתנה (מ-030)
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
             when u.bagrut_role = 'subject_coordinator' then
               school = any(u.bagrut_schools)
               and public.bagrut_subject_member(p_round, p_student, u.bagrut_subject_keys)
             else public.in_bagrut_scope(school, grade, class_name, track)
           end
    from public.users u
    where u.id = auth.uid()), false);
$function$;

revoke all on function public.bagrut_subject_member(uuid, text, text[]) from public, anon;
grant execute on function public.bagrut_subject_member(uuid, text, text[]) to authenticated;
