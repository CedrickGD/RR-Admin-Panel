param (
    [string[]]$Service = @("admin"),
    [string]$Ref = "main"
)

# Deploys the NAS checkout. Since 2026-09-12 the directory on the NAS is a real git clone of this
# repository (before that it was an SMB mirror filled by robocopy, which is why `git pull` there
# used to fail). Deploy = fast-forward that checkout to origin/<Ref>, then rebuild + restart the
# requested compose services. The NAS pulls from GitHub, so push first.
#
#   Frontend only:   .\tools\deploy-nas.ps1                      (npm run deploy:nas)
#   Backend as well: .\tools\deploy-nas.ps1 -Service admin,rr-api
#
# Secrets never live in the checkout: they sit under ${DATA_DIR}/env on the NAS, and
# deploy/nas/.env (DATA_DIR, BOT_SRC, ...) is git-ignored and stays put across pulls.

$ErrorActionPreference = "Stop"
$NasHost = "192.168.2.201"
$NasUser = "cedrick.grabe"
$NasRepo = "/volume1/docker/razorreaper/src/RR-Admin-Panel"
$SshKey = "$env:USERPROFILE\.ssh\id_ed25519"
# `npm run deploy:nas -- -Service admin,rr-api` hands PowerShell one string "admin,rr-api", not an
# array, so split on commas ourselves. Also stop on the first failing ssh step: compose errors
# such as "no such service" must not fall through to the status print and look like success.
$Services = (($Service -split ",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join " "
function Invoke-Nas([string]$Command) {
    ssh -i $SshKey "$NasUser@$NasHost" $Command
    if ($LASTEXITCODE -ne 0) { Write-Host "NAS step failed (exit $LASTEXITCODE)." -ForegroundColor Red; exit $LASTEXITCODE }
}

$localHead = (git rev-parse --short HEAD).Trim()
$remoteHead = (git rev-parse --short "origin/$Ref").Trim()
if ($localHead -ne $remoteHead) {
    Write-Host "HEAD ($localHead) is not origin/$Ref ($remoteHead). Push first - the NAS pulls from GitHub." -ForegroundColor Yellow
    exit 1
}

Write-Host "=== 1. Fast-forwarding NAS checkout to origin/$Ref ===" -ForegroundColor Cyan
Invoke-Nas "set -e; cd $NasRepo && git fetch origin && git checkout -q $Ref && git pull --ff-only origin $Ref && git log --oneline -1"

Write-Host "=== 2. Rebuilding and restarting [$Services] on the NAS ===" -ForegroundColor Cyan
# BUILD_SHA (the NAS checkout's HEAD, i.e. what gets built) is baked into rr-api for the System
# health page. The backtick keeps PowerShell from expanding `$(...)`; the NAS shell runs it.
Invoke-Nas "set -e; cd $NasRepo/deploy/nas && BUILD_SHA=`$(git rev-parse --short HEAD) docker compose up -d --build $Services"

Write-Host "=== 3. Live status ===" -ForegroundColor Green
Invoke-Nas "docker ps --filter name=razorreaper --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'; echo; echo 'served by admin:'; docker exec razorreaper-admin-1 ls /srv/admin/assets | grep -E '^index-.*[.](js|css)'"
