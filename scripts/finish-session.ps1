<#
.SYNOPSIS
  סיום סשן עבודה מקביל: rebase על main, בדיקה, מיזוג, ודחיפה וניקוי לפי בקשה.

.DESCRIPTION
  1. בודק שאין ב-worktree שינויים שלא נכנסו ל-commit.
  2. rebase של ה-branch על origin/main — כדי לקבל את מה שסשנים אחרים כבר מיזגו.
  3. tsc -b בתוך ה-worktree — השילוב חייב להתקמפל.
  4. מיזוג fast-forward ל-main בתיקייה הראשית.
  -Push    דוחף את main (לשני הריפואים — origin מוגדר עם שני push URLs).
  -Remove  מסיר את ה-worktree וה-branch. הקישורים (node_modules, venv)
           מוסרים קודם — כדי שמחיקת התיקייה לא תגיע לתיקייה הראשית.

  דחיפה ל-main מעדכנת את האתר החי. רק אחרי אישור של אייל.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\finish-session.ps1 bagrut-export
  powershell -ExecutionPolicy Bypass -File scripts\finish-session.ps1 bagrut-export -Push -Remove
#>
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [switch]$Push,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$common = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$main = Split-Path $common -Parent
$path = "$main-$Name"
if (-not (Test-Path $path)) { throw "אין worktree בשם הזה: $path" }

function Step($text) { Write-Host "→ $text" -ForegroundColor Cyan }

# 1. הכול ב-commit
Step 'בודק שאין שינויים פתוחים ב-worktree'
$dirty = git -C $path status --porcelain
if ($dirty) { throw "יש שינויים שלא נכנסו ל-commit ב-$path :`n$dirty" }

# 2. rebase על main העדכני
Step 'rebase על origin/main'
git -C $main fetch origin --quiet
git -C $path rebase origin/main
if ($LASTEXITCODE -ne 0) {
  throw "התנגשות ב-rebase. לפתור בתוך $path (git status), להמשיך ב-git rebase --continue, ולהריץ שוב."
}

# 3. השילוב מתקמפל
Step 'tsc -b'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Get-ChildItem "$env:LOCALAPPDATA\Programs\node-*\node.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $node) { throw 'לא נמצא node — אי אפשר לבדוק את הקוד לפני מיזוג' }
Push-Location $path
try {
  & $node node_modules\typescript\bin\tsc -b
  if ($LASTEXITCODE -ne 0) { throw 'tsc נכשל — לא ממזגים' }
} finally { Pop-Location }

# 4. מיזוג ל-main
Step 'מיזוג ל-main בתיקייה הראשית'
$branch = (git -C $main rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { throw "התיקייה הראשית על '$branch' ולא על main — לא ממזגים" }
git -C $main merge --ff-only origin/main --quiet
git -C $main merge --ff-only $Name
if ($LASTEXITCODE -ne 0) {
  throw 'המיזוג נכשל. אם בתיקייה הראשית יש שינויים פתוחים באותם קבצים — לסיים אותם קודם.'
}
Write-Host "✓ $Name מוזג ל-main (מקומית)" -ForegroundColor Green

if ($Push) {
  Step 'דחיפה ל-origin (שני הריפואים)'
  $pushUrls = @(git -C $main remote get-url --push --all origin)
  if ($pushUrls.Count -lt 2) { Write-Warning 'ל-origin יש פחות משני push URLs — האתר החי לא יתעדכן (CLAUDE.md, decisions/009)' }
  git -C $main push origin main
  if ($LASTEXITCODE -ne 0) { throw 'הדחיפה נכשלה' }
  Write-Host '✓ נדחף' -ForegroundColor Green
} else {
  Write-Host '  לא נדחף. לדחיפה (מעדכן את האתר החי):  git push origin main'
}

if ($Remove) {
  Step 'מסיר את ה-worktree'
  # קודם הקישורים — rmdir על junction מסיר רק את הקישור, לא את התוכן
  foreach ($d in 'node_modules', 'agent\venv') {
    $p = Join-Path $path $d
    if ((Test-Path $p) -and ((Get-Item $p -Force).LinkType -eq 'Junction')) { cmd /c rmdir "$p" }
  }
  foreach ($f in '.env', '.env.db') { Remove-Item (Join-Path $path $f) -ErrorAction SilentlyContinue }
  git -C $main worktree remove $path
  if ($LASTEXITCODE -ne 0) { throw "git worktree remove נכשל — לבדוק ידנית את $path" }
  git -C $main branch -d $Name
  Write-Host "✓ ה-worktree וה-branch הוסרו" -ForegroundColor Green
}
