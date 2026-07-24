param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,
  [string]$ResourcePackDirectory = "resource_packs/Backrooms"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$ffmpeg = Join-Path $projectRoot "node_modules/ffmpeg-static/ffmpeg.exe"
$packRoot = Join-Path $projectRoot $ResourcePackDirectory

if (-not (Test-Path -LiteralPath $ffmpeg)) {
  throw "ffmpeg-static was not found. Run npm install before processing Backrooms audio."
}

$sources = @(
  @{
    File = "backrooms-is-there-anybody-in-there_-made-with-Voicemod.mp3"
    Hash = "D1CDF85D7DD19084AE39623123D3D02407946F72FD3B6266A8F74EF09E0AAEBA"
    Output = "sounds/backrooms/events/corner_is_anybody.wav"
    Filter = "highpass=f=100,lowpass=f=5000,loudnorm=I=-19:TP=-4:LRA=7,alimiter=limit=0.72,afade=t=in:st=0:d=0.02,afade=t=out:st=5.62:d=0.20"
  },
  @{
    File = "u_sw4m729ttd-whose-is-this-creepy-ambient-sound-232423.mp3"
    Hash = "03434BB63FD0DD83C7EC9FB80DA1410034B8C645AB11110571AFC184E89B737E"
    Output = "sounds/backrooms/events/corner_creepy_ambient.wav"
    Filter = "highpass=f=70,lowpass=f=5200,loudnorm=I=-21:TP=-5:LRA=8,alimiter=limit=0.62,afade=t=in:st=0:d=0.08,afade=t=out:st=21.40:d=0.26"
  },
  @{
    File = "unr3al_backr00ms-backrooms-smiler-jumpscare-123798.mp3"
    Hash = "FCCADC10DE4A64C043FB41935DAF5941E952EC651838A12BEFE2D7A66CB59F6A"
    Output = "sounds/backrooms/lifeform/lifeform_smiler.wav"
    Filter = "highpass=f=85,lowpass=f=5200,loudnorm=I=-17:TP=-3:LRA=7,alimiter=limit=0.78,afade=t=in:st=0:d=0.025,afade=t=out:st=7.18:d=0.24"
  },
  @{
    File = "cjb123-creature-wail-223555.mp3"
    Hash = "5BB622676E2AF918CF55B668F69FD0C77FCFF0120249098EC657F80755D96B57"
    Output = "sounds/backrooms/lifeform/lifeform_wail.wav"
    Filter = "highpass=f=95,lowpass=f=4600,loudnorm=I=-18:TP=-3:LRA=7,alimiter=limit=0.76,afade=t=in:st=0:d=0.025,afade=t=out:st=3.42:d=0.20"
  },
  @{
    File = "as-human-expansion-is-projected-to-increase-exponentially-in-the-coming-decades-we-must-account-for-these-never-before-f.mp3"
    Hash = "AC628C9A3322EA29F9908DCFB09D53E7263E855297EB29DD29C65226E982DD9A"
    Output = "sounds/backrooms/events/corner_radio_recording.wav"
    Filter = "highpass=f=120,lowpass=f=4600,loudnorm=I=-19:TP=-4:LRA=7,alimiter=limit=0.70,afade=t=in:st=0:d=0.04,afade=t=out:st=10.82:d=0.22"
  }
)

foreach ($source in $sources) {
  $inputPath = Join-Path $SourceDirectory $source.File
  if (-not (Test-Path -LiteralPath $inputPath)) {
    throw "Missing Backrooms source file: $inputPath"
  }
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $inputPath).Hash
  if ($actualHash -ne $source.Hash) {
    throw "Source hash mismatch for $($source.File): $actualHash"
  }

  $outputPath = Join-Path $packRoot $source.Output
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null
  & $ffmpeg -hide_banner -loglevel error -y -i $inputPath -vn -af $source.Filter `
    -ac 1 -ar 16000 -c:a pcm_s16le $outputPath
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed while processing $($source.File)"
  }
  Write-Output "Created $outputPath"
}
