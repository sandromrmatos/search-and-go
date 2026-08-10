$ProgressPreference = 'SilentlyContinue'
$base = "https://unpkg.com/leaflet@1.9.4/dist"
$dest = Join-Path $PSScriptRoot "vendor\leaflet"
New-Item -ItemType Directory -Force -Path (Join-Path $dest "images") | Out-Null

$files = @(
  @{ u = "$base/leaflet.js";  p = "leaflet.js" },
  @{ u = "$base/leaflet.css"; p = "leaflet.css" },
  @{ u = "$base/images/layers.png";          p = "images\layers.png" },
  @{ u = "$base/images/layers-2x.png";       p = "images\layers-2x.png" },
  @{ u = "$base/images/marker-icon.png";     p = "images\marker-icon.png" },
  @{ u = "$base/images/marker-icon-2x.png";  p = "images\marker-icon-2x.png" },
  @{ u = "$base/images/marker-shadow.png";   p = "images\marker-shadow.png" }
)

foreach ($f in $files) {
  $out = Join-Path $dest $f.p
  Invoke-WebRequest -Uri $f.u -OutFile $out -UseBasicParsing -TimeoutSec 60
  $len = (Get-Item $out).Length
  Write-Output "$($f.p) -> $len bytes"
}

# report the real SRI hash of the js we just downloaded
$bytes = [IO.File]::ReadAllBytes((Join-Path $dest "leaflet.js"))
$sha = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
Write-Output ("leaflet.js sha256-" + [Convert]::ToBase64String($sha))
