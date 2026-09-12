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
$Services = $Service -join " "

$localHead = (git rev-parse --short HEAD).Trim()
$remoteHead = (git rev-parse --short "origin/$Ref").Trim()
if ($localHead -ne $remoteHead) {
    Write-Host "HEAD ($localHead) is not origin/$Ref ($remoteHead). Push first - the NAS pulls from GitHub." -ForegroundColor Yellow
    exit 1
}

Write-Host "=== 1. Fast-forwarding NAS checkout to origin/$Ref ===" -ForegroundColor Cyan
ssh -i $SshKey "$NasUser@$NasHost" "set -e; cd $NasRepo && git fetch origin && git checkout -q $Ref && git pull --ff-only origin $Ref && git log --oneline -1"

Write-Host "=== 2. Rebuilding and restarting [$Services] on the NAS ===" -ForegroundColor Cyan
ssh -i $SshKey "$NasUser@$NasHost" "set -e; cd $NasRepo/deploy/nas && docker compose up -d --build $Services"

Write-Host "=== 3. Live status ===" -ForegroundColor Green
ssh -i $SshKey "$NasUser@$NasHost" "docker ps --filter name=razorreaper --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'; echo; echo 'served by admin:'; docker exec razorreaper-admin-1 ls /srv/admin/assets | grep -E '^index-.*[.](js|css)'"
