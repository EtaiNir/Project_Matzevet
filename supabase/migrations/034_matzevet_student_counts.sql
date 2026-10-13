-- ═══════════════════════════════════════════════════════════════
-- 034 — ספירת תלמידי המצבת לכל רשות, בבקשה אחת ומהירה
-- ═══════════════════════════════════════════════════════════════
-- למה: האזור האישי וניהול הלקוחות סופרים תלמידים לכל רשות ב-
-- `select count(*)` דרך ה-RLS. המדיניות קוראת ל-in_user_scope() לכל שורה,
-- והפונקציה ניגשת לטבלת users בכל קריאה — 1.2–2.3 שניות לרשות של 8–12 אלף
-- תלמידים. שמונה ספירות במקביל נתקעות זו בזו, ובקשה שעוברת 8 שניות
-- (statement_timeout של authenticated) נכשלת. הדף השמיט בשקט את מה שנכשל,
-- והסכום קפץ בין טעינות: 13,561 (גלבוע + כפר מנדא) במקום 45,808.
--
-- הפונקציה בודקת את ההרשאה **פעם אחת** ואז סופרת עם סינון עמודות רגיל —
-- אותה תוצאה בדיוק כמו דרך ה-RLS (נבדק מול ה-RLS לכל משתמש לפני ההחלה),
-- באלפיות שנייה.
--
-- ⚠️ security definer — הפונקציה עוקפת את ה-RLS ולכן משכפלת אותו:
--   has_authority(code)          → מנהל־על, או code ב-authority_codes
--   in_user_scope(יישוב, מוסד)   → none: כלום · council: הכול ·
--                                   locality: "SEMEL_YISHUV1" ב-scope_values ·
--                                   school: "SEMEL_MOSAD" ב-scope_values
--   משתמש מושהה                  → כלום
-- שינוי באחת מהן (006, 007, 008, 032) מחייב שינוי כאן. מחזירה רק מספרים.

create or replace function public.matzevet_student_counts(codes text[])
returns table (authority_code text, students bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  u public.users;
  c text;
  n bigint;
begin
  select * into u from public.users where id = auth.uid();
  if u.id is null or u.is_suspended then
    return;
  end if;

  foreach c in array coalesce(codes, '{}') loop
    -- קוד רשות הוא ספרות בלבד — מגן על ה-format, ומדלג על קלט שאינו רשות
    continue when c is null or c !~ '^\d+$';
    -- has_authority
    continue when not (u.role = 'super_admin' or c = any(u.authority_codes));
    -- רשות בלי טבלת מצבת
    continue when to_regclass(format('public.%I', 'students_' || c)) is null;

    if u.scope_level = 'council' then
      execute format('select count(*) from public.%I', 'students_' || c) into n;
    elsif u.scope_level = 'locality' then
      execute format('select count(*) from public.%I where "SEMEL_YISHUV1" = any($1)', 'students_' || c)
        into n using u.scope_values;
    elsif u.scope_level = 'school' then
      execute format('select count(*) from public.%I where "SEMEL_MOSAD" = any($1)', 'students_' || c)
        into n using u.scope_values;
    else
      -- 'none' או ערך לא מוכר — כמו in_user_scope: אין גישה
      n := 0;
    end if;

    authority_code := c;
    students := n;
    return next;
  end loop;
end;
$$;

revoke all on function public.matzevet_student_counts(text[]) from public, anon;
grant execute on function public.matzevet_student_counts(text[]) to authenticated;

comment on function public.matzevet_student_counts(text[]) is
  'מספר תלמידי המצבת לכל רשות, בהרשאות המשתמש (משכפל את has_authority + in_user_scope). מיגרציה 034.';
