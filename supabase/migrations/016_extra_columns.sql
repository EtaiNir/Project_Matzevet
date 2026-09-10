-- מיגרציה 016: עמודות שהמשתמש מוסיף
--
-- אפיון מלא: docs/extra-fields-design.md
--
-- ═══ העיקרון ═══
--
-- עמודה שהמשתמש מוסיף היא **נתון ולא סכימה**. אין `ALTER TABLE` בזמן
-- ריצה: הקטלוג (`extra_columns`) מגדיר אילו עמודות קיימות, והערכים
-- יושבים בעמודת `jsonb` אחת בטבלה נפרדת לכל רשות.
--
-- ═══ מה מגן על העדכון החודשי ═══
--
-- ⚠️ **אין מפתח זר מ-students_{code}_extra ל-students_{code}, וגם לא
-- יהיה.** `MISPAR_ZEHUT` שם הוא `text primary key` ותו לא. מפתח זר
-- היה גורם ל-`truncate table public.students_{code}` ב-load_main.py
-- להיכשל, כלומר להשבית את העדכון החודשי של אותה רשות — והתיקון שאליו
-- מושכת האינטואיציה, `TRUNCATE ... CASCADE`, היה מרוקן בשקט את הטבלה
-- התוספתית. היושרה נשמרת בסימון יתומים (סעיף ז), לא באילוץ.
--
-- הסוכן אינו יודע שהטבלאות האלה קיימות, ואינו משתנה.

-- ═══════════════════════════════════════════════════════════════
-- א. הרשאות
-- ═══════════════════════════════════════════════════════════════
-- שתי רמות נפרדות, כי צפייה אינה עריכה ועריכה אינה ניהול:
--   may_edit_extra            — למלא ערכים. ניתן להענקה גם ל-viewer.
--   may_manage_extra_columns  — ליצור/לארכב עמודות. מנהל רשות ומעלה.
--
-- סבא (13.8): "אולי לייצר איזושהי הרשאת עריכה, שיש כאלה שאפשר להגדיר
-- להם אותם רק לצפייה." מזכירה צריכה לערוך בלי להיות מנהלת רשות.

alter table public.users
  add column if not exists can_edit_extra boolean not null default false;

comment on column public.users.can_edit_extra is
  'רשאי למלא ערכים בעמודות שהמשתמש הוסיף. אינו מקנה הרשאה ליצור עמודות.';

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
  'האם המשתמש רשאי למלא ערכים בעמודות תוספתיות של הרשות.';

-- יצירת עמודה משנה את מה שכל הרשות רואה, ולכן היא ברמת מנהל רשות —
-- אותה מדרגה בדיוק כמו העלאת מצב"ת (may_update_moe, מיגרציה 012).
create or replace function public.may_manage_extra_columns(code text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and not is_suspended
      and (role = 'super_admin' or (role = 'admin' and code = any(authority_codes)))
  );
$$;

comment on function public.may_manage_extra_columns(text) is
  'האם המשתמש רשאי ליצור, לשנות ולארכב עמודות תוספתיות ברשות.';

-- שני קבועים במקום אחד, כדי שהאתר יציג בדיוק את מה שהמסד יאכוף
create or replace function public.extra_grace_days()
returns int language sql immutable as $$ select 90 $$;

comment on function public.extra_grace_days() is
  'כמה ימים נשמרים ערכים של עמודה מאורכבת, ושורות של תלמידים שנגרעו, לפני מחיקה סופית.';

create or replace function public.extra_columns_max()
returns int language sql immutable as $$ select 50 $$;

comment on function public.extra_columns_max() is
  'תקרת עמודות פעילות לרשות. מונעת הפיכת הטבלה לשדה פתוח ושמירה על ייצוא קריא.';

-- ═══════════════════════════════════════════════════════════════
-- ב. מסכים ייעודיים
-- ═══════════════════════════════════════════════════════════════
-- נוצר כאן ולא בשלב מאוחר יותר, כי extra_columns.view_id מצביע לכאן.
-- הטבלה עומדת ריקה עד שייבנה המסך; אין לה השפעה על שום דבר קיים.

create table if not exists public.saved_views (
  id             uuid primary key default gen_random_uuid(),
  authority_code text not null references public.authorities(code) on delete cascade,
  name           text not null,
  description    text,
  base_preset    text,
  -- אותו מבנה בדיוק של FilterCondition[] שהטבלה כבר מייצרת
  filters        jsonb  not null default '[]'::jsonb,
  fields         text[] not null default '{}',
  sort           jsonb,
  -- ברירת מחדל 'authority': "טבלת ההסעות של מצר" היא נכס של הרשות,
  -- לא של מי שיצר אותה. משתמש שעוזב אינו לוקח אותה איתו.
  visibility     text not null default 'authority'
                 check (visibility in ('private', 'authority')),
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists saved_views_authority_idx
  on public.saved_views (authority_code, name);

alter table public.saved_views enable row level security;

drop policy if exists saved_views_read on public.saved_views;
create policy saved_views_read on public.saved_views
  for select to authenticated
  using (
    public.has_authority(authority_code)
    and (visibility = 'authority' or created_by = auth.uid())
  );

drop policy if exists saved_views_insert on public.saved_views;
create policy saved_views_insert on public.saved_views
  for insert to authenticated
  with check (public.has_authority(authority_code) and created_by = auth.uid());

drop policy if exists saved_views_update on public.saved_views;
create policy saved_views_update on public.saved_views
  for update to authenticated
  using (created_by = auth.uid() or public.may_manage_extra_columns(authority_code))
  with check (created_by = auth.uid() or public.may_manage_extra_columns(authority_code));

drop policy if exists saved_views_delete on public.saved_views;
create policy saved_views_delete on public.saved_views
  for delete to authenticated
  using (created_by = auth.uid() or public.may_manage_extra_columns(authority_code));

-- ═══════════════════════════════════════════════════════════════
-- ג. הקטלוג — אילו עמודות קיימות
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.extra_columns (
  id             uuid primary key default gen_random_uuid(),
  authority_code text not null references public.authorities(code) on delete cascade,
  -- null = עמודה של הרשות כולה. אחרת — שייכת למסך ייעודי אחד בלבד.
  view_id        uuid references public.saved_views(id) on delete cascade,
  label          text not null check (length(trim(label)) between 1 and 60),
  type           text not null check (type in ('text', 'checkbox')),
  sort_order     int  not null default 0,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now()
);

create index if not exists extra_columns_authority_idx
  on public.extra_columns (authority_code, sort_order);

comment on table public.extra_columns is
  'העמודות הפעילות שהמשתמש הוסיף. המפתח ב-students_{code}_extra.data הוא ה-id מכאן.';

-- ═══════════════════════════════════════════════════════════════
-- ג2. סל הגריעה
-- ═══════════════════════════════════════════════════════════════
-- **הטבלה נפרדת בכוונה, ולא דגל `is_archived` על extra_columns.**
--
-- דגל היה הופך "עמודה קיימת אבל מוסתרת" למצב שכל מסלול הקריאה חייב
-- להכיר — רישום השדות, בורר השדות, הייצוא, המסכים הייעודיים. כאן
-- `extra_columns` מכילה **אך ורק עמודות חיות**, ואין תנאי סינון בשום
-- שאילתה. עמודה או שקיימת או שלא.
--
-- הערכים עצמם אינם זזים: הם נשארים ב-`data` תחת אותו מפתח, בלי שאיש
-- מציג אותם. לכן מחיקה ושחזור הן העברת שורה אחת בין טבלאות — לא
-- העתקת ערכים של אלפי תלמידים.

create table if not exists public.extra_columns_trash (
  id             uuid primary key,          -- אותו id, כדי שהערכים ב-data יתחברו בשחזור
  authority_code text not null references public.authorities(code) on delete cascade,
  view_id        uuid,                      -- בלי FK: המסך יכול להימחק בינתיים
  label          text not null,
  type           text not null,
  sort_order     int  not null default 0,
  value_count    int  not null default 0,   -- כמה תלמידים החזיקו ערך ברגע המחיקה
  created_by     uuid references public.users(id),
  created_at     timestamptz,
  deleted_by     uuid references public.users(id),
  deleted_at     timestamptz not null default now()
);

create index if not exists extra_columns_trash_authority_idx
  on public.extra_columns_trash (authority_code, deleted_at);

comment on table public.extra_columns_trash is
  'עמודות שנמחקו. ניתנות לשחזור עד extra_grace_days ימים, ואז הערכים נמחקים מה-jsonb.';

alter table public.extra_columns_trash enable row level security;

drop policy if exists extra_columns_trash_read on public.extra_columns_trash;
create policy extra_columns_trash_read on public.extra_columns_trash
  for select to authenticated
  using (public.has_authority(authority_code));

-- אין מדיניות כתיבה כלל: הכניסה לסל והיציאה ממנו עוברות אך ורק דרך
-- delete_extra_column / restore_extra_column, שבודקות הרשאה בעצמן.

-- ═══════════════════════════════════════════════════════════════
-- ג3. תקרת עמודות ו-RLS
-- ═══════════════════════════════════════════════════════════════

create or replace function public.extra_columns_enforce_max()
returns trigger
language plpgsql
as $$
declare
  active int;
begin
  select count(*) into active
    from public.extra_columns
   where authority_code = new.authority_code
     and id <> new.id;

  if active >= public.extra_columns_max() then
    raise exception
      'הגעת לתקרה של % עמודות ברשות. יש למחוק עמודה קיימת לפני הוספת חדשה.',
      public.extra_columns_max();
  end if;
  return new;
end;
$$;

drop trigger if exists extra_columns_archived_stamp on public.extra_columns;
drop trigger if exists extra_columns_max_check on public.extra_columns;
create trigger extra_columns_max_check
  before insert on public.extra_columns
  for each row execute function public.extra_columns_enforce_max();

alter table public.extra_columns enable row level security;

drop policy if exists extra_columns_read on public.extra_columns;
create policy extra_columns_read on public.extra_columns
  for select to authenticated
  using (public.has_authority(authority_code));

drop policy if exists extra_columns_insert on public.extra_columns;
create policy extra_columns_insert on public.extra_columns
  for insert to authenticated
  with check (public.may_manage_extra_columns(authority_code));

drop policy if exists extra_columns_update on public.extra_columns;
create policy extra_columns_update on public.extra_columns
  for update to authenticated
  using (public.may_manage_extra_columns(authority_code))
  with check (public.may_manage_extra_columns(authority_code));

-- ⚠️ **אין מדיניות DELETE בכוונה.** מחיקה מהממשק עוברת דרך
-- delete_extra_column, שמעבירה לסל הגריעה. המחיקה הסופית מתבצעת רק
-- ב-extra_cleanup_purge, אחרי תקופת החסד. כך אי אפשר להשמיד ערכים של
-- רשות שלמה בקריאה אחת ל-API.

-- ═══════════════════════════════════════════════════════════════
-- ד. הטבלה התוספתית — אחת לכל רשות
-- ═══════════════════════════════════════════════════════════════
-- שני מסלולים יוצרים טבלת תלמידים: create_authority (מהאתר) ו-
-- ensure_table שבסוכן (worker.py, כשמגיעים קבצים של מועצה חדשה).
-- אם היינו תולים את הטבלה התוספתית באחד מהם, מועצות מהמסלול השני
-- היו נשארות בלעדיה — בשקט. לכן היצירה אידמפוטנטית ונקראת גם מהאתר.

create or replace function public._ensure_extra_table(target_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  tbl   text;
  main  text;
  scope text;
begin
  if target_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;

  tbl  := 'students_' || target_code || '_extra';
  main := 'students_' || target_code;

  if to_regclass('public.' || quote_ident(main)) is null then
    raise exception 'טבלת התלמידים של רשות % אינה קיימת', target_code;
  end if;

  if to_regclass('public.' || quote_ident(tbl)) is not null then
    return tbl;
  end if;

  -- ללא references לטבלה הראשית — ראה האזהרה בראש הקובץ
  execute format($f$
    create table public.%I (
      "MISPAR_ZEHUT" text primary key,
      data           jsonb       not null default '{}'::jsonb,
      orphaned_at    timestamptz,
      updated_at     timestamptz not null default now(),
      updated_by     uuid references public.users(id)
    )$f$, tbl);

  execute format('alter table public.%I enable row level security', tbl);

  -- ההיקף (מועצתי/יישובי/בית-ספרי) אינו יכול להיבדק על הטבלה התוספתית
  -- עצמה — אין בה סמל יישוב וסמל מוסד. שכפול שלהם לכאן היה מתיישן
  -- ברגע שתלמיד עובר מוסד. לכן exists מול הטבלה הראשית, מול המפתח
  -- הראשי שלה. ה-RLS שלה חלה גם על תת-השאילתה, כך שההגנה כפולה.
  scope := format(
    'public.has_authority(%L) and exists (
       select 1 from public.%I s
        where s."MISPAR_ZEHUT" = public.%I."MISPAR_ZEHUT"
          and public.in_user_scope(s."SEMEL_YISHUV1", s."SEMEL_MOSAD"))',
    target_code, main, tbl);

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

  return tbl;
end;
$$;

comment on function public._ensure_extra_table(text) is
  'יצירה אידמפוטנטית של הטבלה התוספתית + RLS. פנימית — בלי בדיקת הרשאה.';

revoke all on function public._ensure_extra_table(text) from public, authenticated;

-- העטיפה הפומבית: אותה פעולה, עם בדיקת הרשאה
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

grant execute on function public.ensure_extra_table(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ה. חיבור למסלול יצירת המועצה, והשלמה לרשויות הקיימות
-- ═══════════════════════════════════════════════════════════════

create or replace function public.create_authority(
  new_code text,
  new_name text
)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  table_name text;
begin
  if not public.is_super_admin() then
    raise exception 'נדרשת הרשאת מנהל־על';
  end if;

  if new_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;

  if coalesce(trim(new_name), '') = '' then
    raise exception 'חובה להזין שם רשות';
  end if;

  if exists (select 1 from public.authorities where code = new_code) then
    raise exception 'רשות בקוד % כבר קיימת', new_code;
  end if;

  table_name := 'students_' || new_code;

  insert into public.authorities (code, name) values (new_code, trim(new_name));
  insert into public.clients (authority_code) values (new_code);

  execute format(
    'create table if not exists public.%I (like public.students_1400000 including all)',
    table_name
  );

  execute format('alter table public.%I enable row level security', table_name);

  execute format(
    'create policy %I on public.%I for select to authenticated
       using (public.has_authority(%L) and public.in_user_scope("SEMEL_YISHUV1", "SEMEL_MOSAD"))',
    table_name || '_read', table_name, new_code
  );

  -- מיגרציה 016: גם הטבלה התוספתית, כדי שמועצה חדשה תיוולד שלמה
  perform public._ensure_extra_table(new_code);

  return table_name;
end;
$$;

-- רשויות שכבר קיימות
do $$
declare
  a record;
begin
  for a in select code from public.authorities order by code loop
    if to_regclass('public.' || quote_ident('students_' || a.code)) is not null then
      perform public._ensure_extra_table(a.code);
      raise notice 'טבלה תוספתית מוכנה לרשות %', a.code;
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════
-- ו. מחיקת מועצה — לגרור גם את הטבלה התוספתית
-- ═══════════════════════════════════════════════════════════════
-- בלי זה נשארת טבלה יתומה עם תעודות זהות של קטינים — בדיוק התרחיש
-- שמיגרציה 013 באה למנוע. extra_columns ו-saved_views נגררים ממילא
-- ב-on delete cascade על authority_code.

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
-- ז. מחיקה, שחזור וניקוי
-- ═══════════════════════════════════════════════════════════════
-- שני סוגי "זבל" נמחקים סופית באותו מנגנון, אחרי extra_grace_days ימים:
--   1. ערכים של עמודה שנמחקה ויושבת בסל הגריעה
--   2. שורות של תלמידים שכבר אינם במצב"ת
--
-- ⚠️ **הניקוי לעולם אינו רץ בעקבות הטעינה החודשית.** "מחק כל שורה
-- שאין לה ת"ז בטבלה הראשית", מיד אחרי TRUNCATE + טעינה מחדש, הופך כל
-- טעינה שגויה לאובדן בלתי הפיך. ב-2026-08-17 נטענו בטעות קובצי מטה
-- מנשה לטבלה של כפר מנדא — אפס ת"ז משותפות. הטבלה הראשית שוחזרה
-- מגיבוי; לטבלה התוספתית אין גיבוי.

create or replace function public.mark_extra_orphans(target_code text)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  tbl     text;
  main    text;
  marked  int := 0;
begin
  if target_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;

  tbl  := 'students_' || target_code || '_extra';
  main := 'students_' || target_code;

  if to_regclass('public.' || quote_ident(tbl)) is null
     or to_regclass('public.' || quote_ident(main)) is null then
    return 0;
  end if;

  execute format(
    'update public.%I e set orphaned_at = now()
      where e.orphaned_at is null
        and not exists (select 1 from public.%I s
                         where s."MISPAR_ZEHUT" = e."MISPAR_ZEHUT")', tbl, main);
  get diagnostics marked = row_count;

  -- ומי שחזר — הסימון מתבטל. זה מה שמנטרל טעינה שגויה: בסבב הבא,
  -- כשהנתונים הנכונים חוזרים, השעון מתאפס מעצמו ואיש לא צריך לתקן.
  execute format(
    'update public.%I e set orphaned_at = null
      where e.orphaned_at is not null
        and exists (select 1 from public.%I s
                     where s."MISPAR_ZEHUT" = e."MISPAR_ZEHUT")', tbl, main);

  return marked;
end;
$$;

revoke all on function public.mark_extra_orphans(text) from public, authenticated;

-- ─────────────── כמה תלמידים מחזיקים ערך בעמודה ───────────────
-- נקרא **לפני** הצגת אישור המחיקה. זו ההגנה המרכזית: הטעות הנפוצה
-- היא "חשבתי שהעמודה לא בשימוש", והמספר הזה עונה עליה בדיוק בנקודה
-- שבה היא נוצרת — ולא 90 יום אחריה.

create or replace function public.extra_column_usage(column_id uuid)
returns int
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c    public.extra_columns%rowtype;
  tbl  text;
  vals int := 0;
begin
  select * into c from public.extra_columns where id = column_id;
  if not found or not public.has_authority(c.authority_code) then
    return 0;
  end if;

  tbl := 'students_' || c.authority_code || '_extra';
  if to_regclass('public.' || quote_ident(tbl)) is not null then
    execute format('select count(*) from public.%I where data ? %L', tbl, column_id::text)
      into vals;
  end if;
  return vals;
end;
$$;

grant execute on function public.extra_column_usage(uuid) to authenticated;

-- ─────────────── מחיקת עמודה ───────────────
-- מעבירה לסל הגריעה. הערכים ב-data **אינם נוגעים** — הם נשארים תחת
-- אותו מפתח, בלי שאיש מציג אותם. לכן זו העברת שורה אחת, גם כשמדובר
-- בעמודה עם ערכים לאלפי תלמידים, והשחזור זול באותה מידה.

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

grant execute on function public.delete_extra_column(uuid) to authenticated;

-- ─────────────── שחזור ───────────────

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

  -- אם המסך הייעודי שאליו השתייכה נמחק בינתיים, היא חוזרת כעמודה של
  -- הרשות כולה במקום שהשחזור ייכשל.
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

grant execute on function public.restore_extra_column(uuid) to authenticated;

-- ─────────────── ניקוי ───────────────

create or replace function public.extra_cleanup_preview(target_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  tbl     text;
  trash   jsonb := '[]'::jsonb;
  due     int := 0;
  orphans int := 0;
  o_due   int := 0;
  grace   int := public.extra_grace_days();
begin
  if not public.may_manage_extra_columns(target_code) then
    raise exception 'נדרשת הרשאת מנהל רשות';
  end if;

  perform public.mark_extra_orphans(target_code);

  tbl := 'students_' || target_code || '_extra';
  if to_regclass('public.' || quote_ident(tbl)) is not null then
    execute format(
      'select count(*) filter (where orphaned_at is not null),
              count(*) filter (where orphaned_at < now() - make_interval(days => %s))
         from public.%I', grace, tbl)
      into orphans, o_due;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',            t.id,
           'label',         t.label,
           'type',          t.type,
           'values',        t.value_count,
           'deleted_at',    t.deleted_at,
           'restore_until', t.deleted_at + make_interval(days => grace)
         ) order by t.deleted_at desc), '[]'::jsonb),
         count(*) filter (where t.deleted_at < now() - make_interval(days => grace))
    into trash, due
    from public.extra_columns_trash t
   where t.authority_code = target_code;

  return jsonb_build_object(
    'grace_days',      grace,
    'trash',           trash,
    'trash_due',       due,
    'orphan_rows',     orphans,
    'orphan_rows_due', o_due
  );
end;
$$;

grant execute on function public.extra_cleanup_preview(text) to authenticated;

create or replace function public.extra_cleanup_purge(target_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  tbl       text;
  c         record;
  cols_gone jsonb := '[]'::jsonb;
  rows_gone int := 0;
  grace     int := public.extra_grace_days();
begin
  if not public.may_manage_extra_columns(target_code) then
    raise exception 'נדרשת הרשאת מנהל רשות';
  end if;

  perform public.mark_extra_orphans(target_code);

  tbl := 'students_' || target_code || '_extra';
  if to_regclass('public.' || quote_ident(tbl)) is null then
    return jsonb_build_object('columns', cols_gone, 'rows', 0);
  end if;

  -- רק כאן, אחרי תקופת החסד, הערכים באמת נמחקים מה-jsonb
  for c in
    select id, label from public.extra_columns_trash
     where authority_code = target_code
       and deleted_at < now() - make_interval(days => grace)
  loop
    execute format('update public.%I set data = data - %L where data ? %L',
                   tbl, c.id::text, c.id::text);
    delete from public.extra_columns_trash where id = c.id;
    cols_gone := cols_gone || jsonb_build_object('id', c.id, 'label', c.label);
  end loop;

  execute format(
    'delete from public.%I where orphaned_at is not null
      and orphaned_at < now() - make_interval(days => %s)', tbl, grace);
  get diagnostics rows_gone = row_count;

  return jsonb_build_object('columns', cols_gone, 'rows', rows_gone);
end;
$$;

grant execute on function public.extra_cleanup_purge(text) to authenticated;

comment on function public.extra_cleanup_purge(text) is
  'מוחקת סופית ערכים של עמודות מסל הגריעה ושורות של תלמידים שנגרעו, אחרי תקופת החסד בלבד.';
