# Cleanup stale portable versions — run manually to remove locked directories
$releaseDir = "E:\vela\11\vela-1\release\2.4.1"
$toRemove = @(
  "NovelForge-2.4.1-Portable-final",
  "NovelForge-2.4.1-Portable-v2",
  "NovelForge-2.4.1-Portable-r8"
)

foreach ($name in $toRemove) {
  $path = Join-Path $releaseDir $name
  if (Test-Path $path) {
    Write-Host "Removing: $name"
    Remove-Item $path -Recurse -Force -ErrorAction Continue
  }
}
Write-Host "Cleanup complete"
