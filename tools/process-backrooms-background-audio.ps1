param(
  [Parameter(Mandatory = $true)]
  [string]$SourceFile,
  [string]$OutputFile = "resource_packs/Backrooms/sounds/music/game/yuehua_backrooms_loop.ogg"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$ffmpeg = Join-Path $projectRoot "node_modules/ffmpeg-static/ffmpeg.exe"
$expectedHash = "C283A1404CABB27AEED966F0680E7297AF93CED4FA8EA17C6080AE442EEF4F95"

if (-not (Test-Path -LiteralPath $ffmpeg)) {
  throw "ffmpeg-static was not found. Run npm install before processing Backrooms audio."
}
if (-not (Test-Path -LiteralPath $SourceFile)) {
  throw "Missing Backrooms background source: $SourceFile"
}
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $SourceFile).Hash
if ($actualHash -ne $expectedHash) {
  throw "Backrooms background source hash mismatch: $actualHash"
}

$destination = Join-Path $projectRoot $OutputFile
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
$filter = @(
  "[0:a]asplit=3[mid_src][tail_src][head_src];"
  "[mid_src]atrim=start=2:end=18,asetpts=PTS-STARTPTS[mid];"
  "[tail_src]atrim=start=18:end=20,asetpts=PTS-STARTPTS[tail];"
  "[head_src]atrim=start=0:end=2,asetpts=PTS-STARTPTS[head];"
  "[tail][head]acrossfade=d=2:c1=tri:c2=tri[seam];"
  "[mid][seam]concat=n=2:v=0:a=1[unit];"
  "[unit]aloop=loop=-1:size=793800,atrim=duration=180,loudnorm=I=-18:TP=-3:LRA=7[out]"
) -join ""
& $ffmpeg -hide_banner -loglevel error -y -i $SourceFile -vn `
  -filter_complex $filter -map "[out]" -ac 2 -ar 44100 -c:a libvorbis -q:a 6 $destination
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg failed while processing the Backrooms background track"
}
Write-Output "Created $destination"
