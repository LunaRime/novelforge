# Cleanup stale portable versions — run manually to remove locked directories
$releaseDir = "E:\vela\11\vela-1\release\0.1.0"
$toRemove = @(
  "NovelForge-0.1.0-Portable-final",
  "NovelForge-0.1.0-Portable-v2",
  "NovelForge-0.1.0-Portable-r8"
)

foreach ($name in $toRemove) {
  $path = Join-Path $releaseDir $name
  if (Test-Path $path) {
    Write-Host "Removing: $name"
    Remove-Item $path -Recurse -Force -ErrorAction Continue
  }
}
Write-Host "Cleanup complete"
