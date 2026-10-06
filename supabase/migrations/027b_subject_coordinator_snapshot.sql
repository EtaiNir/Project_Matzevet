-- מיגרציה 027b: רכז מקצוע (subject_coordinator) — **תמונת מצב שחולצה מהמסד החי**
--
-- ⚠️ המקור של השינוי הזה אינו ידוע. ב-7.10.2026 התגלה שבמסד החי יש תפקיד
-- subject_coordinator, עמודה users.bagrut_subject_keys, והרשאות שנשענות על
-- may_edit_bagrut_student / bagrut_student_visible(p_round, …) — אבל אין להם
-- מיגרציה בריפו ולא בגיטהאב, ושום סשן פעיל לא כתב אותם. כנראה הוחלו
-- ישירות על המסד ממחשב אחר.
--
-- הקובץ נוצר **אוטומטית** מ-pg_get_functiondef ומ-pg_policy (לא הועתק ביד),
-- כדי שהריפו ישקף את המסד ושהרצה חוזרת של 026 לא תחזיר את ההרשאות אחורה.
-- ממוספר 027b כדי לרוץ לפני 029, שנשענת על may_edit_bagrut_student.
--
-- **אם קובץ המקור יימצא — להחליף את זה בו.** בנוי להרצה חוזרת: על המסד
-- החי הוא לא משנה דבר.

-- ── עמודה ותפקיד
alter table public.users
  add column if not exists bagrut_subject_keys text[] not null default '{}'::text[];

alter table public.users drop constraint if exists users_bagrut_role_check;
alter table public.users add constraint users_bagrut_role_check
  check (bagrut_role = any (array['council', 'coordinator', 'grade_coordinator',
                                  'track_coordinator', 'subject_coordinator', 'homeroom']));

-- ── פונקציות (כפי שהן במסד החי)
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
             when u.bagrut_role = 'track_coordinator' then track      = any(u.bagrut_tracks)
             when u.bagrut_role = 'homeroom'          then class_name = any(u.bagrut_classes)
             else false
           end
    from public.users u
    where u.id = auth.uid()), false);
$function$;
CREATE OR REPLACE FUNCTION public.bagrut_school_visible(school text)
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
             when u.bagrut_role is null then false
             else school = any(u.bagrut_schools)
           end
    from public.users u
    where u.id = auth.uid()), false);
$function$;
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
               and exists (select 1 from public.bagrut_grades g
                           where g.round_id = p_round
                             and g.student_id = p_student
                             and g.subject_key = any(u.bagrut_subject_keys))
             -- חמשת התפקידים של 026: הכלל שלהם נשאר במקום אחד
             else public.in_bagrut_scope(school, grade, class_name, track)
           end
    from public.users u
    where u.id = auth.uid()), false);
$function$;
CREATE OR REPLACE FUNCTION public.may_edit_bagrut_student(p_round uuid, p_student text, school text, grade text, class_name text, track text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select not u.is_suspended
       and (u.role = 'super_admin'
            or (u.bagrut_role in ('coordinator', 'grade_coordinator', 'track_coordinator',
                                  'subject_coordinator', 'homeroom')
                and public.bagrut_student_visible(p_round, p_student, school, grade,
                                                  class_name, track)))
    from public.users u
    where u.id = auth.uid()), false);
$function$;
CREATE OR REPLACE FUNCTION public.may_edit_bagrut_program(school text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select not u.is_suspended
       and (u.role = 'super_admin'
            or (u.bagrut_role = 'coordinator' and school = any(u.bagrut_schools)))
    from public.users u
    where u.id = auth.uid()), false);
$function$;

-- ── מדיניות על התלמידים ועל המעקב (כפי שהן במסד החי)
drop policy if exists bagrut_students_delete on public.bagrut_students;
create policy bagrut_students_delete on public.bagrut_students for delete to authenticated
  using (is_super_admin());
drop policy if exists bagrut_students_insert on public.bagrut_students;
create policy bagrut_students_insert on public.bagrut_students for insert to authenticated
  with check (is_super_admin());
drop policy if exists bagrut_students_read on public.bagrut_students;
create policy bagrut_students_read on public.bagrut_students for select to authenticated
  using ((has_authority(authority_code) AND bagrut_student_visible(round_id, student_id, school_code, grade, class_name, track)));
drop policy if exists bagrut_students_update on public.bagrut_students;
create policy bagrut_students_update on public.bagrut_students for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());
drop policy if exists bagrut_tracking_delete on public.bagrut_tracking;
create policy bagrut_tracking_delete on public.bagrut_tracking for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM bagrut_students s
  WHERE ((s.authority_code = bagrut_tracking.authority_code) AND (s.school_code = bagrut_tracking.school_code) AND (s.student_id = bagrut_tracking.student_id) AND may_edit_bagrut_student(s.round_id, s.student_id, s.school_code, s.grade, s.class_name, s.track)))));
drop policy if exists bagrut_tracking_insert on public.bagrut_tracking;
create policy bagrut_tracking_insert on public.bagrut_tracking for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM bagrut_students s
  WHERE ((s.authority_code = bagrut_tracking.authority_code) AND (s.school_code = bagrut_tracking.school_code) AND (s.student_id = bagrut_tracking.student_id) AND may_edit_bagrut_student(s.round_id, s.student_id, s.school_code, s.grade, s.class_name, s.track)))));
drop policy if exists bagrut_tracking_read on public.bagrut_tracking;
create policy bagrut_tracking_read on public.bagrut_tracking for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM bagrut_students s
  WHERE ((s.authority_code = bagrut_tracking.authority_code) AND (s.school_code = bagrut_tracking.school_code) AND (s.student_id = bagrut_tracking.student_id)))));
drop policy if exists bagrut_tracking_update on public.bagrut_tracking;
create policy bagrut_tracking_update on public.bagrut_tracking for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM bagrut_students s
  WHERE ((s.authority_code = bagrut_tracking.authority_code) AND (s.school_code = bagrut_tracking.school_code) AND (s.student_id = bagrut_tracking.student_id) AND may_edit_bagrut_student(s.round_id, s.student_id, s.school_code, s.grade, s.class_name, s.track)))))
  with check ((EXISTS ( SELECT 1
   FROM bagrut_students s
  WHERE ((s.authority_code = bagrut_tracking.authority_code) AND (s.school_code = bagrut_tracking.school_code) AND (s.student_id = bagrut_tracking.student_id) AND may_edit_bagrut_student(s.round_id, s.student_id, s.school_code, s.grade, s.class_name, s.track)))));

-- ── הפונקציה הישנה של 026 — הוחלפה ב-may_edit_bagrut_student, ואינה במסד החי
drop function if exists public.may_edit_bagrut_tracking(text, text, text, text);
