-- מיגרציה 021: תיקיות לטבלאות ייעודיות, והבעלות עוברת למשתמש
--
-- שלושה שינויים שקשורים זה בזה:
--
--   א. טבלה ייעודית היא **אישית**. כל משתמש רואה ומגיע רק למה שהוא
--      עצמו יצר. זה הפוך ממה שהוחלט ב-016, ראה למטה.
--   ב. תיקיות — עץ לארגון הטבלאות בסרגל הצד, כמו בסייר הקבצים.
--   ג. מחיקת משתמש לא תיחסם יותר ע"י מה שהוא יצר.
--
-- ═══════════════════════════════════════════════════════════════
-- א. הבעלות עוברת למשתמש
-- ═══════════════════════════════════════════════════════════════
-- מיגרציה 016 קבעה ברירת מחדל `visibility = 'authority'` מתוך הנחה
-- ש"טבלת ההסעות של מצר" היא נכס של הרשות ולא של מי שיצר אותה. אייל
-- הכריע אחרת: *"כל משתמש רואה בסרגל הצד ויש לו גישה רק לטבלאות שהוא
-- יצר"*.
--
-- לכן העמודה `visibility` **נמחקת** ולא נשארת ומתעלמים ממנה. עמודה
-- שאיש אינו קורא היא בדיוק אותו מצב נסתר שבגללו סל הגריעה נבנה כטבלה
-- נפרדת ולא כדגל `is_archived`. אם יוחלט בעתיד להחזיר שיתוף — זו
-- מיגרציה של חמש שורות, והיא תהיה החלטה מפורשת ולא שריד.
--
-- **מה זה אומר בפועל:** טבלה שנוצרה ע"י משתמש אחד נעלמת מהסרגל של
-- כל השאר. הנתונים אינם נמחקים — רק הראייה מצטמצמת.

-- המדיניות הישנה יורדת ראשונה: היא קוראת את `visibility`, ו-Postgres
-- לא ייתן למחוק עמודה שמדיניות תלויה בה.
drop policy if exists saved_views_read on public.saved_views;

alter table public.saved_views drop column if exists visibility;

create policy saved_views_read on public.saved_views
  for select to authenticated
  using (public.has_authority(authority_code) and created_by = auth.uid());

-- העדכון והמחיקה מצטמצמים לאותו כלל. קודם מנהל רשות יכול היה למחוק
-- רשימה של מישהו אחר; מרגע שהוא אינו רואה אותה, ההרשאה הזו הייתה
-- הרשאה על משהו בלתי נראה.
drop policy if exists saved_views_update on public.saved_views;
create policy saved_views_update on public.saved_views
  for update to authenticated
  using (public.has_authority(authority_code) and created_by = auth.uid())
  with check (public.has_authority(authority_code) and created_by = auth.uid());

drop policy if exists saved_views_delete on public.saved_views;
create policy saved_views_delete on public.saved_views
  for delete to authenticated
  using (public.has_authority(authority_code) and created_by = auth.uid());

comment on table public.saved_views is
  'טבלאות ייעודיות — רשימת תלמידים קבועה. אישית ליוצר שלה (מיגרציה 021).';

-- ═══════════════════════════════════════════════════════════════
-- ב. תיקיות
-- ═══════════════════════════════════════════════════════════════
-- עץ פשוט: `parent_id` על עצמה. אין טבלת קשרים ואין נתיב טקסטואלי —
-- מספר התיקיות של משתמש בודד נמדד בעשרות, והעץ נבנה בזיכרון בצד
-- הלקוח בפעולה אחת.

create table if not exists public.view_folders (
  id             uuid primary key default gen_random_uuid(),
  authority_code text not null references public.authorities(code) on delete cascade,
  parent_id      uuid references public.view_folders(id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 60),
  sort_order     int  not null default 0,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists view_folders_owner_idx
  on public.view_folders (authority_code, created_by, parent_id);

comment on table public.view_folders is
  'תיקיות לארגון הטבלאות הייעודיות בסרגל. אישיות ליוצר, כמו הטבלאות עצמן.';

alter table public.view_folders enable row level security;

drop policy if exists view_folders_read on public.view_folders;
create policy view_folders_read on public.view_folders
  for select to authenticated
  using (public.has_authority(authority_code) and created_by = auth.uid());

drop policy if exists view_folders_insert on public.view_folders;
create policy view_folders_insert on public.view_folders
  for insert to authenticated
  with check (public.has_authority(authority_code) and created_by = auth.uid());

drop policy if exists view_folders_update on public.view_folders;
create policy view_folders_update on public.view_folders
  for update to authenticated
  using (public.has_authority(authority_code) and created_by = auth.uid())
  with check (public.has_authority(authority_code) and created_by = auth.uid());

drop policy if exists view_folders_delete on public.view_folders;
create policy view_folders_delete on public.view_folders
  for delete to authenticated
  using (public.has_authority(authority_code) and created_by = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- ג. הטבלאות נכנסות לתיקיות
-- ═══════════════════════════════════════════════════════════════
-- `on delete set null` ולא `cascade`, וזו ההחלטה המשמעותית כאן:
-- **מחיקת תיקייה לעולם אינה מוחקת טבלאות.** תיקייה היא סידור; טבלה
-- ייעודית מחזיקה רשימת תלמידים שמישהו בנה ידנית. מי שמוחק תיקייה
-- מתכוון לסדר מחדש, לא לאבד את התוכן — והתיקיות שבתוכה נגררות
-- (`cascade` על `parent_id`), אבל הטבלאות שבהן חוזרות לשורש.

alter table public.saved_views
  add column if not exists folder_id uuid
  references public.view_folders(id) on delete set null;

create index if not exists saved_views_folder_idx
  on public.saved_views (authority_code, created_by, folder_id);

-- ═══════════════════════════════════════════════════════════════
-- ד. שמירה על שפיות העץ
-- ═══════════════════════════════════════════════════════════════
-- RLS מונע ממשתמש **לראות** תיקייה של אחר, אבל אינו מונע ממנו לשלוח
-- מזהה שניחש. שלושת התנאים נאכפים כאן, במסד, ולא בתצוגה — אותו שיקול
-- כמו במלכודת 16 ב-CLAUDE.md.

create or replace function public.view_folders_check()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  parent public.view_folders%rowtype;
  cur    uuid;
  hops   int := 0;
begin
  new.updated_at := now();

  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'תיקייה אינה יכולה להכיל את עצמה';
  end if;

  select * into parent from public.view_folders where id = new.parent_id;
  if not found then
    raise exception 'תיקיית האב אינה קיימת';
  end if;
  if parent.authority_code is distinct from new.authority_code
     or parent.created_by is distinct from new.created_by then
    raise exception 'תיקיית האב שייכת למשתמש או לרשות אחרים';
  end if;

  -- מעגל: לטפס מתיקיית האב כלפי מעלה ולוודא שלא חוזרים לעצמנו
  cur := new.parent_id;
  while cur is not null loop
    hops := hops + 1;
    if cur = new.id then
      raise exception 'לא ניתן להעביר תיקייה לתוך תיקיית משנה שלה';
    end if;
    if hops > 20 then
      raise exception 'עומק התיקיות חורג מהמותר';
    end if;
    select parent_id into cur from public.view_folders where id = cur;
  end loop;

  return new;
end;
$$;

drop trigger if exists view_folders_check on public.view_folders;
create trigger view_folders_check
  before insert or update on public.view_folders
  for each row execute function public.view_folders_check();

/** טבלה נכנסת רק לתיקייה של אותו משתמש ואותה רשות. */
create or replace function public.saved_views_folder_check()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  f public.view_folders%rowtype;
begin
  if new.folder_id is null then
    return new;
  end if;
  select * into f from public.view_folders where id = new.folder_id;
  if not found then
    raise exception 'התיקייה אינה קיימת';
  end if;
  if f.authority_code is distinct from new.authority_code
     or f.created_by is distinct from new.created_by then
    raise exception 'התיקייה שייכת למשתמש או לרשות אחרים';
  end if;
  return new;
end;
$$;

drop trigger if exists saved_views_folder_check on public.saved_views;
create trigger saved_views_folder_check
  before insert or update of folder_id on public.saved_views
  for each row execute function public.saved_views_folder_check();

-- ═══════════════════════════════════════════════════════════════
-- ה. מחיקת משתמש לא תיחסם
-- ═══════════════════════════════════════════════════════════════
-- באג שהתגלה תוך כדי: `created_by` הפנה ל-`public.users(id)` בלי
-- `on delete`, כלומר NO ACTION. מחיקת משתמש ב-Edge Function מגיעה
-- ל-`auth.users`, נגררת ל-`public.users` — ושם **נחסמת** אם המשתמש
-- יצר אי־פעם עמודה או טבלה ייעודית. השגיאה הייתה מגיעה כ"נכשל" גנרי.
--
-- `set null` ולא `cascade`: סבא — *"עדיף להשאיר תלמיד במערכת מאשר
-- למחוק אותו"*. אותו שיקול כאן. עמודה שמולאה על אלפי תלמידים לא
-- תיעלם כי מי שיצר אותה עזב.
--
-- ⚠️ עם הבעלות האישית (סעיף א) יש לזה תוצאה: טבלה ייעודית של משתמש
-- שנמחק הופכת ל**יתומה** — `created_by = null`, ואיש אינו רואה אותה.
-- הנתונים שמורים, והחלטה מה לעשות בהם היא ידנית ומודעת.

alter table public.saved_views
  drop constraint if exists saved_views_created_by_fkey,
  add  constraint saved_views_created_by_fkey
       foreign key (created_by) references public.users(id) on delete set null;

alter table public.extra_columns
  drop constraint if exists extra_columns_created_by_fkey,
  add  constraint extra_columns_created_by_fkey
       foreign key (created_by) references public.users(id) on delete set null;

alter table public.extra_columns_trash
  drop constraint if exists extra_columns_trash_created_by_fkey,
  add  constraint extra_columns_trash_created_by_fkey
       foreign key (created_by) references public.users(id) on delete set null;

alter table public.extra_columns_trash
  drop constraint if exists extra_columns_trash_deleted_by_fkey,
  add  constraint extra_columns_trash_deleted_by_fkey
       foreign key (deleted_by) references public.users(id) on delete set null;

-- ═══════════════════════════════════════════════════════════════
-- ו. הוספת תלמידים — רק היוצר
-- ═══════════════════════════════════════════════════════════════
-- הפונקציה היא security definer ולכן אינה עוברת ב-RLS. עד כה היא
-- התירה גם למי ש-`may_edit_extra` להוסיף לרשימה של אחר — הרשאה על
-- רשימה שהוא כבר אינו רואה.

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
  if v.created_by is distinct from auth.uid() then
    raise exception 'רק יוצר הרשימה יכול להוסיף אליה';
  end if;

  members := 'students_' || v.authority_code || '_view_members';
  main    := 'students_' || v.authority_code;
  if to_regclass('public.' || quote_ident(members)) is null then
    perform public._ensure_extra_table(v.authority_code);
  end if;

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

-- ═══════════════════════════════════════════════════════════════
-- ז. מחיקת רשות גוררת גם את התיקיות
-- ═══════════════════════════════════════════════════════════════
-- `view_folders.authority_code` כבר מוגדרת `on delete cascade`, ולכן
-- `delete_authority` אינה משתנה. נרשם כאן כדי שלא יחפשו.
