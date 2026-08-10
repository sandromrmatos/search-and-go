$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profile = Join-Path $env:TEMP "sag-smoke-profile"
$out = Join-Path $env:TEMP "sag-dom.html"

if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$args = @(
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--user-data-dir=$profile",
  "--virtual-time-budget=15000",
  "--run-all-compositor-stages-before-draw",
  "--dump-dom",
  "http://127.0.0.1:8123/index.html"
)

& $chrome @args 2>$null | Out-File -FilePath $out -Encoding utf8
$dom = Get-Content $out -Raw

Write-Output "=== dump length: $($dom.Length) ==="

if ($dom -match 'id="boot"[^>]*class="([^"]*)"') { Write-Output "boot class attr order A: $($matches[1])" }
if ($dom -match '<div class="([^"]*)" id="boot"') { Write-Output "boot class: $($matches[1])" }
if ($dom -match '<div class="([^"]*)" id="app"') { Write-Output "app class: $($matches[1])" }
if ($dom -match 'Could not start') { Write-Output "!! BOOT ERROR PAGE RENDERED" }

# how many creature cells rendered in the collection grid?
$cells = ([regex]::Matches($dom, 'class="cell')).Count
Write-Output "cells rendered: $cells"

$optCount = ([regex]::Matches($dom, '<option value="(Neutral|Mystic|Wind|Celestial|Mechanic)"')).Count
Write-Output "type filter options: $optCount"

if ($dom -match 'id="geo-status"[^>]*>([^<]*)<') { Write-Output "geo status: $($matches[1])" }
if ($dom -match '<div class="geo-status[^"]*" id="geo-status">([^<]*)<') { Write-Output "geo status: $($matches[1])" }
if ($dom -match 'id="hud-xp-text">([^<]*)<') { Write-Output "hud xp: $($matches[1])" }
if ($dom -match 'id="collection-count">([^<]*)<') { Write-Output "collection count: $($matches[1])" }
if ($dom -match 'id="boot-msg">([^<]*)<') { Write-Output "boot msg: $($matches[1])" }
Write-Output "=== done ==="
