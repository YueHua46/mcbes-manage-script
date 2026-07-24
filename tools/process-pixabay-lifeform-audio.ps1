param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,
  [string]$OutputDirectory = "resource_packs/Backrooms/sounds/backrooms/lifeform"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$ffmpeg = Join-Path $projectRoot "node_modules/ffmpeg-static/ffmpeg.exe"
$outputRoot = Join-Path $projectRoot $OutputDirectory

if (-not (Test-Path -LiteralPath $ffmpeg)) {
  throw "ffmpeg-static was not found. Run npm install before processing Lifeform audio."
}

$sources = @(
  @{
    File = "audio_08610d7fc7.mp3"
    Hash = "EFC868FD9FCB5BCC78DFDB7D7906EDB3F9819D2222E62B307214F50252149F5C"
    Output = "pixabay_distant_scream.wav"
    Filter = "atrim=start=0.12:end=6.35,asetpts=PTS-STARTPTS,highpass=f=90,lowpass=f=3000,aecho=0.72:0.42:105|225:0.12|0.055,volume=1.10,alimiter=limit=0.78,afade=t=in:st=0:d=0.10,afade=t=out:st=5.88:d=0.35"
  },
  @{
    File = "audio_9046603103.mp3"
    Hash = "5BB622676E2AF918CF55B668F69FD0C77FCFF0120249098EC657F80755D96B57"
    Output = "pixabay_hurt_wail.wav"
    Filter = "atrim=start=0.18:end=1.28,asetpts=PTS-STARTPTS,highpass=f=95,lowpass=f=4300,acompressor=threshold=0.22:ratio=2.4:attack=8:release=75:makeup=1.05,volume=0.72,alimiter=limit=0.82,afade=t=in:st=0:d=0.025,afade=t=out:st=0.94:d=0.16"
  },
  @{
    File = "audio_b70968e3d3.mp3"
    Hash = "B3A05B3ECF2254AA12BBDB7EA5B148ADF4437BDE9958D866C4570742609F5EF4"
    Output = "pixabay_glitch_roar.wav"
    Filter = "atrim=start=0.22:end=2.32,asetpts=PTS-STARTPTS,highpass=f=75,lowpass=f=4800,acompressor=threshold=0.20:ratio=2.8:attack=6:release=90:makeup=1.08,volume=1.22,alimiter=limit=0.84,afade=t=in:st=0:d=0.035,afade=t=out:st=1.88:d=0.22"
  }
)

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

foreach ($source in $sources) {
  $inputPath = Join-Path $SourceDirectory $source.File
  if (-not (Test-Path -LiteralPath $inputPath)) {
    throw "Missing Pixabay source file: $inputPath"
  }
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $inputPath).Hash
  if ($actualHash -ne $source.Hash) {
    throw "Source hash mismatch for $($source.File): $actualHash"
  }

  $outputPath = Join-Path $outputRoot $source.Output
  & $ffmpeg -hide_banner -loglevel error -y -i $inputPath -af $source.Filter `
    -ac 1 -ar 16000 -c:a pcm_s16le $outputPath
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed while processing $($source.File)"
  }
  Write-Output "Created $outputPath"
}
