-- מיגרציה 017: טבלאות ייעודיות — חברוּת מפורשת
--
-- ═══ ההחלטה ═══
--
-- טבלה ייעודית היא **רשימת תעודות זהות**, ולא סינון שמור שמחושב מחדש.
--
-- הדרישה שהכריעה: "להגיע לסינון באחד המסכים ואת מי שסיננת להוסיף לאחת
-- הטבלאות הייעודיות". פעולה כזו אפשרית רק כשהחברוּת מפורשת — בסינון
-- דינמי היית עורך את התנאי, לא "מוסיף אנשים".
--
-- המחיר, וצריך שיהיה גלוי במסך: תלמיד חדש שמתאים לסינון המקורי **אינו**
-- מצטרף מעצמו, ותלמיד שיצא מהסינון נשאר ברשימה עד שיוסר.
--
-- `saved_views.filters` (מיגרציה 016) נשמר כ**תיעוד** של הסינון שממנו
-- נבנתה הרשימה — כדי שאפשר יהיה לענות בעוד חצי שנה "מאיפה הגיעו
-- 47 האלה". הוא אינו מורץ מחדש.
--
-- ═══ מה מגן על העדכון החודשי ═══
--
-- ⚠️ כמו בטבלה התוספתית: **אין מפתח זר ל-students_{code}**. מפתח כזה
-- היה מפיל את ה-TRUNCATE ב-load_main.py ומשבית את העדכון החודשי.
-- הקישור לתלמיד הוא ת"ז בלבד; היושרה נשמרת בתצוגה ובניקוי.

-- ═══════════════════════════════════════════════════════════════
-- א. הטבלה, ויצירתה בכל מסלול
-- ═══════════════════════════════════════════════════════════════
-- הפונקציה מ-016 מורחבת במקום להוסיף פונקציה שנייה: `create_authority`
-- כבר קוראת לה, וכך מועצה חדשה מקבלת גם את טבלת החברוּת בלי לגעת שוב
-- ב-create_authority ובלי לגעת בסוכן.

create or replace function public._ensure_extra_table(target_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  tbl     text;
  members text;
  main    text;
  scope   text;
begin
  if target_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;

  tbl     := 'students_' || target_code || '_extra';
  members := 'students_' || target_code || '_view_members';
  main    := 'students_' || target_code;

  if to_regclass('public.' || quote_ident(main)) is null then
    raise exception 'טבלת התלמידים של רשות % אינה קיימת', target_code;
  end if;

  -- ההיקף (מועצתי/יישובי/בית-ספרי) נבדק מול הטבלה הראשית. שם הטבלה
  -- ידוע כאן, ולכן אפשר להטמיע אותו במדיניות במקום לשכפל סמלים
  -- שמתיישנים ברגע שתלמיד עובר מוסד.
  scope := format(
    'public.has_authority(%L) and exists (
       select 1 from public.%I s
        where s."MISPAR_ZEHUT" = public.%I."MISPAR_ZEHUT"
          and public.in_user_scope(s."SEMEL_YISHUV1", s."SEMEL_MOSAD"))',
    target_code, main, tbl);

  -- ── הטבלה התוספתית (מיגרציה 016) ──
  if to_regclass('public.' || quote_ident(tbl)) is null then
    execute format($f$
      create table public.%I (
        "MISPAR_ZEHUT" text primary key,
        data           jsonb       not null default '{}'::jsonb,
        orphaned_at    timestamptz,
        updated_at     timestamptz not null default now(),
        updated_by     uuid references public.users(id)
      )$f$, tbl);

    execute format('alter table public.%I enable row level security', tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      tbl || '_read', tbl, scope);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (%s and public.may_edit_extra(%L))',
      tbl || '_insert', tbl, scope, target_code);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (%s and public.may_edit_extra(%L))
         with check (%s and public.may_edit_extra(%L))',
      tbl || '_update', tbl, scope, target_code, scope, target_code);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (%s and public.may_edit_extra(%L))',
      tbl || '_delete', tbl, scope, target_code);
  end if;

  -- ── טבלת החברוּת (מיגרציה 017) ──
  if to_regclass('public.' || quote_ident(members)) is null then
    execute format($f$
      create table public.%I (
        view_id        uuid not null
                       references public.saved_views(id) on delete cascade,
        "MISPAR_ZEHUT" text not null,
        added_at       timestamptz not null default now(),
        added_by       uuid references public.users(id),
        primary key (view_id, "MISPAR_ZEHUT")
      )$f$, members);

    execute format(
      'create index if not exists %I on public.%I (view_id)',
      members || '_view_idx', members);

    execute format('alter table public.%I enable row level security', members);

    -- אותו תנאי היקף, על טבלת החברוּת
    scope := format(
      'public.has_authority(%L) and exists (
         select 1 from public.%I s
          where s."MISPAR_ZEHUT" = public.%I."MISPAR_ZEHUT"
            and public.in_user_scope(s."SEMEL_YISHUV1", s."SEMEL_MOSAD"))',
      target_code, main, members);

    -- קריאה: מי שרואה את הרשימה ואת התלמיד
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (%s and exists (select 1 from public.saved_views v
                                where v.id = view_id))',
      members || '_read', members, scope);

    -- כתיבה: יוצר הרשימה, או מי שרשאי למלא נתונים ברשות.
    -- כך משתמש אקראי אינו משנה רשימה משותפת שאחרים נשענים עליה.
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (%s and exists (
           select 1 from public.saved_views v
            where v.id = view_id and v.authority_code = %L
              and (v.created_by = auth.uid() or public.may_edit_extra(%L))))',
      members || '_insert', members, scope, target_code, target_code);

    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (%s and exists (
           select 1 from public.saved_views v
            where v.id = view_id and v.authority_code = %L
              and (v.created_by = auth.uid() or public.may_edit_extra(%L))))',
      members || '_delete', members, scope, target_code, target_code);
  end if;

  return tbl;
end;
$$;

comment on function public._ensure_extra_table(text) is
  'יוצרת אידמפוטנטית את הטבלה התוספתית ואת טבלת החברוּת של המסכים הייעודיים, עם ה-RLS שלהן.';

-- ═══════════════════════════════════════════════════════════════
-- ב. השלמה לרשויות שכבר קיימות
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  a record;
begin
  for a in select code from public.authorities order by code loop
    if to_regclass('public.' || quote_ident('students_' || a.code)) is not null then
      perform public._ensure_extra_table(a.code);
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════
-- ג. מחיקת מועצה — לגרור גם את טבלת החברוּת
-- ═══════════════════════════════════════════════════════════════
-- בלי זה נשארת טבלה יתומה עם תעודות זהות של קטינים, בדיוק כמו
-- שמיגרציה 013 באה למנוע.

create or replace function public.delete_authority(
  target_code  text,
  confirm_name text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  auth_row      public.authorities%rowtype;
  tbl           text;
  student_rows  bigint := 0;
  users_touched int    := 0;
  uploads_count int    := 0;
  docs_count    int    := 0;
  busy          int    := 0;
begin
  if not public.is_super_admin() then
    raise exception 'נדרשת הרשאת מנהל־על';
  end if;

  if target_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;

  select * into auth_row from public.authorities where code = target_code;
  if not found then
    raise exception 'רשות בקוד % אינה קיימת', target_code;
  end if;

  if target_code = public.template_authority_code() then
    raise exception
      'אי אפשר למחוק את % — טבלת התלמידים שלה היא התבנית שממנה נבנית כל מועצה חדשה',
      auth_row.name;
  end if;

  select count(*) into busy
    from public.moe_uploads
   where authority_code = target_code
     and status in ('pending', 'processing');
  if busy > 0 then
    raise exception 'יש עדכון מצב"ת בעיבוד עבור %. יש להמתין לסיומו לפני המחיקה', auth_row.name;
  end if;

  if confirm_name is distinct from auth_row.name then
    raise exception 'שם האישור אינו תואם. יש להקליד בדיוק: %', auth_row.name;
  end if;

  tbl := 'students_' || target_code;

  if to_regclass('public.' || quote_ident(tbl)) is not null then
    execute format('select count(*) from public.%I', tbl) into student_rows;
  end if;

  select count(*) into uploads_count
    from public.moe_uploads where authority_code = target_code;
  select count(*) into docs_count
    from public.client_documents where authority_code = target_code;

  update public.users
     set authority_codes = array_remove(authority_codes, target_code)
   where target_code = any(authority_codes);
  get diagnostics users_touched = row_count;

  execute format('drop table if exists public.%I', tbl);
  execute format('drop table if exists public.%I', tbl || '_extra');
  execute format('drop table if exists public.%I', tbl || '_view_members');

  delete from public.authorities where code = target_code;

  return jsonb_build_object(
    'code',     target_code,
    'name',     auth_row.name,
    'students', student_rows,
    'users',    users_touched,
    'uploads',  uploads_count,
    'documents', docs_count
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ד. הוספה בכמות אחת
-- ═══════════════════════════════════════════════════════════════
-- הוספה של 400 תלמידים מסינון היא 400 שורות. שליחתן כמערך אחד חוסכת
-- 400 הלוך-ושוב, ומחזירה כמה **באמת** נוספו — כי מי שכבר ברשימה
-- מדולג בשקט (on conflict) ולא נספר.

create or replace function public.add_students_to_view(
  view_uuid uuid,
  ids       text[]
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v       public.saved_views%rowtype;
  members text;
  main    text;
  added   int := 0;
  total   int := 0;
begin
  select * into v from public.saved_views where id = view_uuid;
  if not found then
    raise exception 'הטבלה הייעודית אינה קיימת';
  end if;
  if not public.has_authority(v.authority_code) then
    raise exception 'אין לך גישה לרשות הזו';
  end if;
  if v.created_by is distinct from auth.uid()
     and not public.may_edit_extra(v.authority_code) then
    raise exception 'רק יוצר הרשימה או מי שרשאי לערוך נתונים יכול להוסיף אליה';
  end if;

  members := 'students_' || v.authority_code || '_view_members';
  main    := 'students_' || v.authority_code;
  if to_regclass('public.' || quote_ident(members)) is null then
    perform public._ensure_extra_table(v.authority_code);
  end if;

  -- ההוספה מסוננת דרך הטבלה הראשית: אי אפשר לתחוב לרשימה ת"ז שאינה
  -- ברשות, גם לא דרך קריאה ישירה ל-API.
  --
  -- הערכים עוברים ב-USING ולא ב-format: מערך ת"ז שמוטמע כטקסט תלוי
  -- בהמרת טיפוס מרומזת, ושם טבלה שמוטמע ב-%s אינו מצוטט כמזהה.
  execute format(
    'insert into public.%I (view_id, "MISPAR_ZEHUT", added_by)
     select $1, s."MISPAR_ZEHUT", $2
       from public.%I s
      where s."MISPAR_ZEHUT" = any($3)
     on conflict do nothing',
    members, main)
  using view_uuid, auth.uid(), ids;
  get diagnostics added = row_count;

  execute format('select count(*) from public.%I where view_id = $1', members)
    into total using view_uuid;

  return jsonb_build_object('added', added, 'total', total);
end;
$$;

grant execute on function public.add_students_to_view(uuid, text[]) to authenticated;

comment on function public.add_students_to_view(uuid, text[]) is
  'מוסיפה תלמידים לטבלה ייעודית. מדלגת על מי שכבר ברשימה, ומחזירה כמה נוספו בפועל.';
