<#
.SYNOPSIS
  פתיחת סשן עבודה מקביל: worktree נפרד עם branch משלו, מוכן להרצה.

.DESCRIPTION
  יוצר תיקייה אחות לתיקייה הראשית ("<תיקייה ראשית>-<שם>") על branch חדש
  מ-origin/main, מעתיק את קובצי הסביבה, מקשר את node_modules ואת ה-venv של
  הסוכן, ובוחר פורט פנוי לשרת הפיתוח. ראה CLAUDE.md, "עבודה במקביל".

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\new-session.ps1 bagrut-export
#>
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Base = 'origin/main'
)
$ErrorActionPreference = 'Stop'
# בלי זה PowerShell 5.1 מפענח את הפלט של git (UTF-8) בקידוד הקונסולה, והנתיב העברי משתבש
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if ($Name -notmatch '^[a-z0-9][a-z0-9-]*$') {
  throw 'שם המשימה: אותיות לטיניות קטנות, ספרות ומקף בלבד (למשל bagrut-export)'
}

# התיקייה הראשית — גם כשמריצים מתוך worktree אחר: ה-.git המשותף יושב בה
$common = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$main = Split-Path $common -Parent
$path = "$main-$Name"
if (Test-Path $path) { throw "כבר קיימת תיקייה: $path" }

git -C $main fetch origin --quiet
# --no-track: ה-branch לא עוקב אחרי origin/main — כדי ש-git push מתוך ה-worktree
# לא יוכל להגיע ל-main בטעות. מיזוג ל-main רק דרך finish-session.ps1.
git -C $main worktree add --no-track $path -b $Name $Base
if ($LASTEXITCODE -ne 0) { throw 'git worktree add נכשל' }

# מה שגיט לא מעתיק: קובצי סביבה (מוחרגים מגיט)
foreach ($f in '.env', '.env.db') {
  if (Test-Path "$main\$f") { Copy-Item "$main\$f" $path }
}
# npm install נכשל ברשת הזו (SELF_SIGNED_CERT_IN_CHAIN) — מקשרים לתיקייה הקיימת.
# finish-session.ps1 מסיר את הקישורים לפני מחיקת התיקייה, כך שהמקור לא נפגע.
foreach ($d in 'node_modules', 'agent\venv') {
  if (Test-Path "$main\$d") { cmd /c mklink /J "$path\$d" "$main\$d" | Out-Null }
}

# פורט פנוי לשרת הפיתוח, מ-5174 ומעלה (5173 — התיקייה הראשית)
$busy = @((Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue).LocalPort)
$port = 5174
while ($busy -contains $port) { $port++ }

Write-Host ''
Write-Host "✓ סשן '$Name' מוכן" -ForegroundColor Green
Write-Host "  תיקייה: $path"
Write-Host "  branch: $Name (מ-$Base)"
Write-Host ''
Write-Host '  הצעדים הבאים:'
Write-Host "  1. לפתוח את התיקייה בחלון VS Code נפרד ולהפעיל שם את Claude"
Write-Host "  2. שרת פיתוח:  node node_modules\vite\bin\vite.js --port $port   →  http://localhost:$port"
Write-Host "  3. בסיום:      scripts\finish-session.ps1 $Name"
