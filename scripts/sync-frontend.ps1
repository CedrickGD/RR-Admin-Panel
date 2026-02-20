[CmdletBinding()]
param(
	[switch]$InstallDeps
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$frontendDir = Join-Path $repoRoot "frontend"
$distDir = Join-Path $frontendDir "dist"
$distAssetsDir = Join-Path $distDir "assets"
$wwwrootDir = Join-Path $repoRoot "wwwroot"
$wwwrootAssetsDir = Join-Path $wwwrootDir "assets"

Push-Location $frontendDir
try {
	if ($InstallDeps -or -not (Test-Path (Join-Path $frontendDir "node_modules"))) {
		npm ci
	}

	npm run build
}
finally {
	Pop-Location
}

if (-not (Test-Path $distDir)) {
	throw "Build output was not found at $distDir"
}

Copy-Item (Join-Path $distDir "*") $wwwrootDir -Recurse -Force

$keepIndexAssetNames = @{}
Get-ChildItem $distAssetsDir -File |
	Where-Object { $_.Name -match "^index-.*\.(js|css)$" } |
	ForEach-Object { $keepIndexAssetNames[$_.Name] = $true }

Get-ChildItem $wwwrootAssetsDir -File |
	Where-Object { $_.Name -match "^index-.*\.(js|css)$" -and -not $keepIndexAssetNames.ContainsKey($_.Name) } |
	Remove-Item -Force

Write-Host "Frontend build synced to wwwroot."
