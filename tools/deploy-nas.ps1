param (
    [string]$Service = "admin"
)

$ErrorActionPreference = "Stop"
$NasHost = "192.168.2.201"
$NasUser = "cedrick.grabe"
$NasSmb = "\\DXP2800-665A\docker\razorreaper\src\RR-Admin-Panel"
$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$SshKey = "$env:USERPROFILE\.ssh\id_ed25519"

Write-Host "=== 1. Syncing source files to NAS ($NasSmb) ===" -ForegroundColor Cyan
& robocopy "$RepoRoot\src" "$NasSmb\src" /E /NDL /NFL | Out-Null
& robocopy "$RepoRoot\public" "$NasSmb\public" /E /NDL /NFL | Out-Null
& robocopy "$RepoRoot\shared" "$NasSmb\shared" /E /NDL /NFL | Out-Null
& robocopy "$RepoRoot\deploy\nas\admin" "$NasSmb\deploy\nas\admin" /E /NDL /NFL | Out-Null
& robocopy "$RepoRoot" "$NasSmb" vite.config.ts package.json package-lock.json /NDL /NFL | Out-Null

Write-Host "=== 2. Rebuilding and restarting container [$Service] on NAS ===" -ForegroundColor Cyan
ssh -i $SshKey -o StrictHostKeyChecking=no "$NasUser@$NasHost" "cd /volume1/docker/razorreaper/src/RR-Admin-Panel/deploy/nas && docker compose up -d --build $Service"

Write-Host "=== 3. Verification - Live Container Status: ===" -ForegroundColor Green
ssh -i $SshKey -o StrictHostKeyChecking=no "$NasUser@$NasHost" "docker ps --filter name=$Service --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"
