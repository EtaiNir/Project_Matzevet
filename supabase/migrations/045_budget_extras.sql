-- ═══════════════════════════════════════════════════════════════
-- 045 — מודול התקציב: קובץ התוספתיים, ותאריך הנתונים (החלטה 023 §8)
-- ═══════════════════════════════════════════════════════════════
-- אייל, 21.10: הקליטה היא שלושה קבצים — שני דוחות EPR (בפורמט קבוע: העמודות
-- שאינן אפורות) ו**קובץ התוספתיים**: ייצוא של הטבלה "תקציב כרטסת - ראשי ברמת
-- הכרטיס הבודד - תוספיים" מהאקסס של סבא. ממנה נבנית הטבלה הראשית.
--
-- מה שבתוספתיים ועוד לא היה לו מקום:
--   · הדגלים במיתר / הכנסה / הוצאה / פעיל בשנה הקודמת (שכבת המשתמש של הכרטיס)
--   · "תכנית שנה נוכחית" הכנסות/הוצאות — זהה לתקציב ב-EPR (אומת 405/405), אבל
--     התוספתיים מכילים גם כרטיסים שאין להם שורה בדוח הכרטיסים
-- ותאריך הנתונים: עד מתי הדוח (EprRep19102026… = 19.10.2026). לפיו הקצב ו"חודש
-- גזירת הנתונים" — לא לפי התנועה האחרונה, שעשויה להיות עתידית.

alter table public.budget_card_meta add column if not exists card_name        text;
alter table public.budget_card_meta add column if not exists in_meitar        boolean not null default false;
alter table public.budget_card_meta add column if not exists is_income        boolean;
alter table public.budget_card_meta add column if not exists is_expense       boolean;
alter table public.budget_card_meta add column if not exists active_prev_year boolean not null default false;

comment on column public.budget_card_meta.in_meitar is '"במיתר" בתוספתיים — הכרטיס מתוקצב מהמיתר';
comment on column public.budget_card_meta.is_income is '"הכנסה" בתוספתיים. null = לא נקבע — נגזר מהתקציב';
comment on column public.budget_card_meta.is_expense is '"הוצאה" בתוספתיים. null = לא נקבע — נגזר מהתקציב';

alter table public.budget_card_plans add column if not exists plan_income  numeric;
alter table public.budget_card_plans add column if not exists plan_expense numeric;

comment on column public.budget_card_plans.plan_income is
  '"תכנית שנה נוכחית הכנסות" מהתוספתיים. זהה לתקציב ב-EPR; משמש לכרטיס שאין לו שורה בדוח הכרטיסים';

-- (בקליטה עצמה תאריך הנתונים נשמר ב-report.as_of של budget_uploads — אין לו עמודה)
alter table public.budget_cards add column if not exists as_of date;

comment on column public.budget_cards.as_of is
  'עד מתי הנתונים — מהשם של דוח EPR (EprRepDDMMYYYY…), אחרת יום הקליטה. לפיו הקצב';
