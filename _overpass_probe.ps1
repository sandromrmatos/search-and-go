$ProgressPreference = 'SilentlyContinue'
$q = @'
[out:json][timeout:25];
(
  nwr["shop"](around:100,51.5152,-0.1419);
  nwr["amenity"](around:100,51.5152,-0.1419);
);
out tags center;
'@

$endpoints = @(
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
)

foreach ($e in $endpoints) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest -Uri $e -Method Post -Body @{ data = $q } -UseBasicParsing -TimeoutSec 45
    $sw.Stop()
    $j = $r.Content | ConvertFrom-Json
    Write-Output ("{0}  ->  HTTP {1}  {2} ms  elements={3}" -f $e, $r.StatusCode, $sw.ElapsedMilliseconds, $j.elements.Count)
  } catch {
    $sw.Stop()
    Write-Output ("{0}  ->  ERROR after {1} ms : {2}" -f $e, $sw.ElapsedMilliseconds, $_.Exception.Message)
  }
}
