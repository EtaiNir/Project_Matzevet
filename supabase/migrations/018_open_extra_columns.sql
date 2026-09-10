-- מיגרציה 018: כל משתמש יכול להוסיף עמודות
--
-- ═══ מה משתנה ═══
--
-- ב-016 יצירת עמודה הוגבלה למנהל רשות ומעלה, באותה מדרגה של העלאת
-- מצב"ת. זה היה שיקול שגוי: העלאת מצב"ת דורסת רשות שלמה, ואילו הוספת
-- עמודה היא כלי עבודה אישי. מזכירה שרוצה לסמן לעצמה עשרים תלמידים
-- אינה צריכה לבקש הרשאה.
--
-- מכאן: **כל משתמש עם גישה לרשות יוצר עמודות וממלא בהן ערכים.**
--
-- ═══ מה לא נפתח ═══
--
-- מחיקה נשארת מוגבלת — אבל לא לפי תפקיד אלא לפי בעלות: **מי שיצר את
-- העמודה מוחק אותה, ומנהל רשות מוחק כל עמודה.** אחרת היה נוצר מצב
-- שמשתמש יוצר עמודה בטעות ואינו יכול להסיר אותה.
--
-- הניקוי הסופי (extra_cleanup_purge) נשאר למנהל רשות: הוא מוחק נתונים
-- לצמיתות מכל הרשות, וזו פעולת תחזוקה ולא פעולת עבודה.

-- ═══════════════════════════════════════════════════════════════
-- א. יצירה ומילוי — לכל מי שיש לו גישה לרשות
-- ═══════════════════════════════════════════════════════════════

create or replace function public.may_add_extra_columns(code text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and not is_suspended
      and (role = 'super_admin' or code = any(authority_codes))
  );
$$;

comment on function public.may_add_extra_columns(text) is
  'האם המשתמש רשאי ליצור עמודות ברשות — כל מי שיש לו גישה אליה.';

-- מילוי ערכים נפתח באותה מידה. עמודה שאי אפשר למלא בה דבר היא עמודה
-- חסרת טעם, ולכן אין הגיון להתיר יצירה ולחסום כתיבה.
-- `users.can_edit_extra` נשאר בסכימה: אם יידרש בעתיד מצב "צפייה בלבד"
-- לנתונים התוספתיים, זה המקום שבו הוא ייאכף.
create or replace function public.may_edit_extra(code text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and not is_suspended
      and (role = 'super_admin' or code = any(authority_codes))
  );
$$;

-- ═══════════════════════════════════════════════════════════════
-- ב. שינוי ומחיקה — בעלות, לא תפקיד
-- ═══════════════════════════════════════════════════════════════

create or replace function public.may_modify_extra_column(column_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
      from public.extra_columns c
      join public.users u on u.id = auth.uid()
     where c.id = column_id
       and not u.is_suspended
       and (
         u.role = 'super_admin'
         or (c.authority_code = any(u.authority_codes)
             and (c.created_by = u.id or u.role = 'admin'))
       )
  );
$$;

comment on function public.may_modify_extra_column(uuid) is
  'האם המשתמש רשאי לשנות או למחוק עמודה — יוצר העמודה, או מנהל הרשות.';

-- ═══════════════════════════════════════════════════════════════
-- ג. RLS מעודכן על הקטלוג
-- ═══════════════════════════════════════════════════════════════

drop policy if exists extra_columns_insert on public.extra_columns;
create policy extra_columns_insert on public.extra_columns
  for insert to authenticated
  with check (
    public.may_add_extra_columns(authority_code)
    -- אי אפשר ליצור עמודה בשם מישהו אחר: הבעלות היא שקובעת מי ימחק
    and created_by = auth.uid()
  );

drop policy if exists extra_columns_update on public.extra_columns;
create policy extra_columns_update on public.extra_columns
  for update to authenticated
  using (public.may_modify_extra_column(id))
  with check (public.may_modify_extra_column(id));

-- ═══════════════════════════════════════════════════════════════
-- ד. הפונקציות שנשענו על ההרשאה הישנה
-- ═══════════════════════════════════════════════════════════════

-- יצירת הטבלאות בפעם הראשונה — כל מי שרשאי ליצור עמודה
create or replace function public.ensure_extra_table(target_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.may_add_extra_columns(target_code) then
    raise exception 'אין לך גישה לרשות הזו';
  end if;
  return public._ensure_extra_table(target_code);
end;
$$;

create or replace function public.delete_extra_column(column_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  c    public.extra_columns%rowtype;
  tbl  text;
  vals int := 0;
begin
  select * into c from public.extra_columns where id = column_id;
  if not found then
    raise exception 'העמודה אינה קיימת';
  end if;
  if not public.may_modify_extra_column(column_id) then
    raise exception 'רק מי שיצר את העמודה, או מנהל הרשות, יכול למחוק אותה';
  end if;

  tbl := 'students_' || c.authority_code || '_extra';
  if to_regclass('public.' || quote_ident(tbl)) is not null then
    execute format('select count(*) from public.%I where data ? %L', tbl, column_id::text)
      into vals;
  end if;

  insert into public.extra_columns_trash
         (id, authority_code, view_id, label, type, sort_order,
          value_count, created_by, created_at, deleted_by)
  values (c.id, c.authority_code, c.view_id, c.label, c.type, c.sort_order,
          vals, c.created_by, c.created_at, auth.uid());

  delete from public.extra_columns where id = column_id;

  return jsonb_build_object('id', c.id, 'label', c.label, 'values', vals);
end;
$$;

-- שחזור: יוצר העמודה המקורי, או מנהל הרשות. הבדיקה מול הסל, כי
-- may_modify_extra_column מסתכלת על הטבלה החיה שהעמודה כבר אינה בה.
create or replace function public.restore_extra_column(column_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  t public.extra_columns_trash%rowtype;
begin
  select * into t from public.extra_columns_trash where id = column_id;
  if not found then
    raise exception 'העמודה אינה בסל הגריעה — ייתכן שכבר נמחקה סופית';
  end if;

  if not exists (
    select 1 from public.users u
     where u.id = auth.uid()
       and not u.is_suspended
       and (u.role = 'super_admin'
            or (t.authority_code = any(u.authority_codes)
                and (t.created_by = u.id or u.role = 'admin')))
  ) then
    raise exception 'רק מי שיצר את העמודה, או מנהל הרשות, יכול לשחזר אותה';
  end if;

  insert into public.extra_columns
         (id, authority_code, view_id, label, type, sort_order, created_by, created_at)
  values (t.id, t.authority_code,
          case when exists (select 1 from public.saved_views v where v.id = t.view_id)
               then t.view_id end,
          t.label, t.type, t.sort_order, t.created_by, t.created_at);

  delete from public.extra_columns_trash where id = column_id;

  return jsonb_build_object('id', t.id, 'label', t.label, 'values', t.value_count);
end;
$$;

-- extra_cleanup_preview / extra_cleanup_purge נשארות על
-- may_manage_extra_columns: מחיקה סופית של נתוני הרשות היא תחזוקה.
