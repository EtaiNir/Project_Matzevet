-- מיגרציה 019: החזרת הרשאת יצירת העמודות למנהל רשות
--
-- ═══ למה ═══
--
-- מיגרציה 018 פתחה יצירת עמודות ומילוי ערכים לכל מי שיש לו גישה
-- לרשות, כולל `viewer`. זו הייתה קריאה שגויה של הכוונה: "כל רמות
-- ההרשאה" משמעו שגם מנהל בית ספר וגם מנהל יישובי יוצרים עמודות ולא
-- רק מנהל מועצתי — ולא שצופה יוצר אותן.
--
-- **צופה אינו יוצר עמודות.** המיגרציה הזו מחזירה את המצב ל-016:
--
--   יצירה ומחיקה   →  may_manage_extra_columns  (admin / super_admin,
--                      בכל רמת היקף — מועצתי, יישובי או בית-ספרי)
--   מילוי ערכים     →  may_edit_extra  (admin, או viewer שהוענק לו
--                      במפורש can_edit_extra — בקשת סבא מ-13.8)
--
-- 018 לא הוסיפה יכולת אמיתית גם בכיוון השני: מכיוון שרק מנהלים יוצרים
-- עמודות, "יוצר העמודה" הוא תמיד מנהל, ובעלות לא הבדילה בין אף שני
-- משתמשים. לכן היא מוסרת ולא מתוחזקת.

-- ═══════════════════════════════════════════════════════════════
-- א. מילוי ערכים — חזרה לדגל can_edit_extra
-- ═══════════════════════════════════════════════════════════════

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
      and (
        role = 'super_admin'
        or (code = any(authority_codes) and (role = 'admin' or can_edit_extra))
      )
  );
$$;

comment on function public.may_edit_extra(text) is
  'האם המשתמש רשאי למלא ערכים בעמודות תוספתיות. צופה — רק אם הוענק לו can_edit_extra.';

-- ═══════════════════════════════════════════════════════════════
-- ב. RLS על הקטלוג — חזרה למנהל רשות
-- ═══════════════════════════════════════════════════════════════
-- `created_by = auth.uid()` נשמר מ-018: אין סיבה שמישהו ייצור עמודה
-- הרשומה על שם אחר, וזה גם מה שמאפשר להציג "מי הוסיף" במסך.

drop policy if exists extra_columns_insert on public.extra_columns;
create policy extra_columns_insert on public.extra_columns
  for insert to authenticated
  with check (
    public.may_manage_extra_columns(authority_code)
    and created_by = auth.uid()
  );

drop policy if exists extra_columns_update on public.extra_columns;
create policy extra_columns_update on public.extra_columns
  for update to authenticated
  using (public.may_manage_extra_columns(authority_code))
  with check (public.may_manage_extra_columns(authority_code));

-- ═══════════════════════════════════════════════════════════════
-- ג. הפונקציות — חזרה לבדיקה הישנה
-- ═══════════════════════════════════════════════════════════════

create or replace function public.ensure_extra_table(target_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.may_manage_extra_columns(target_code) then
    raise exception 'נדרשת הרשאת מנהל רשות';
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
  if not public.may_manage_extra_columns(c.authority_code) then
    raise exception 'נדרשת הרשאת מנהל רשות';
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
  if not public.may_manage_extra_columns(t.authority_code) then
    raise exception 'נדרשת הרשאת מנהל רשות';
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

-- ═══════════════════════════════════════════════════════════════
-- ד. הסרת מה ש-018 הוסיפה
-- ═══════════════════════════════════════════════════════════════

drop function if exists public.may_add_extra_columns(text);
drop function if exists public.may_modify_extra_column(uuid);
