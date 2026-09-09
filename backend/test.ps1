$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$backendPath = $PSScriptRoot
$temporaryDrive = $null
if ($backendPath -match '[^\x00-\x7F]') {
  $temporaryDrive = @('Z','Y','X','W') | Where-Object { -not (Test-Path "${_}:\") } | Select-Object -First 1
  if ($temporaryDrive) {
    subst "${temporaryDrive}:" $backendPath
    Set-Location "${temporaryDrive}:\"
  }
}
$repository = Join-Path (Get-Location) ".maven-repository"

if (Test-Path ".\mvnw.cmd") {
  & ".\mvnw.cmd" "-Dmaven.repo.local=$repository" test
  exit $LASTEXITCODE
}

$maven = Get-Command mvn -ErrorAction SilentlyContinue
if (-not $maven) {
  $cached = Get-ChildItem "$env:USERPROFILE\.m2\wrapper\dists\apache-maven-*\*\bin\mvn.cmd" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $cached) { throw "Maven bulunamadı." }
  $mavenPath = $cached.FullName
} else {
  $mavenPath = $maven.Source
}

& $mavenPath "-Dmaven.repo.local=$repository" test
exit $LASTEXITCODE
