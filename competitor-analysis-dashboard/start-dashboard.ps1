$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeCandidates = @()

$PathNode = Get-Command node -ErrorAction SilentlyContinue
if ($PathNode) {
  $NodeCandidates += $PathNode.Source
}

$NodeCandidates += Join-Path $env:LOCALAPPDATA "ms-playwright-go\1.57.0\node.exe"
$NodeCandidates += "C:\Program Files\nodejs\node.exe"

$NodePath = $null
foreach ($Candidate in $NodeCandidates | Select-Object -Unique) {
  if (-not $Candidate -or -not (Test-Path $Candidate)) {
    continue
  }
  try {
    & $Candidate --version *> $null
    $NodePath = $Candidate
    break
  } catch {
    continue
  }
}

if (-not $NodePath) {
  throw "Không tìm thấy Node.js có thể chạy được trên máy này."
}

Set-Location $AppRoot
& $NodePath .\server.js
