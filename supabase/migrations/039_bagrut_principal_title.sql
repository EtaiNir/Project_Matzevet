-- ═══════════════════════════════════════════════════════════════
-- 039 — "מנהל/ת בית ספר" בבגרות: כותרת בלבד
-- ═══════════════════════════════════════════════════════════════
-- התפקיד עלה בהחלטה על העריכה הידנית (018, 18.10). אייל אישר את ההמלצה:
-- מנהל בית ספר = "כל בית הספר" (bagrut_role = 'coordinator') עם כותרת אחרת.
-- הוא רואה ועורך בדיוק כמו רכז בגרויות — גם את תוכנית בית הספר.
--
-- לכן **אין שינוי בהרשאות**: עמודה לתצוגה בלבד. אף פונקציה ב-RLS אינה קוראת
-- אותה. ערך אחד מוכר — 'principal'; null = הכותרת של התפקיד.

alter table public.users add column if not exists bagrut_title text;

alter table public.users drop constraint if exists users_bagrut_title_check;
alter table public.users add constraint users_bagrut_title_check
  check (bagrut_title is null or bagrut_title = 'principal');

comment on column public.users.bagrut_title is
  'כותרת לתצוגה בבגרות. principal = מנהל/ת בית ספר (עם bagrut_role = coordinator). לא משפיעה על הרשאות. מיגרציה 039.';
