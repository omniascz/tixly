# Kolo 21 — ukončí jen procesy této session: next start -p 3200 z tixly\nextjs-boilerplate (+ jeho rodiče npx) a simulátor Sentry :3995.
$all = Get-CimInstance Win32_Process
$byId = @{}; $all | ForEach-Object { $byId[[int]$_.ProcessId] = $_ }
$kill = @()
foreach ($p in $all) {
  $c = [string]$p.CommandLine
  if ($c.Contains('tixly\nextjs-boilerplate\node_modules\.bin') -and $c.Contains('start -p 3200')) {
    $kill += $p
    $q = $byId[[int]$p.ParentProcessId]
    while ($q -and ([string]$q.CommandLine).Contains('next start -p 3200')) { $kill += $q; $q = $byId[[int]$q.ParentProcessId] }
  }
  if ($c.Contains('r14-fake-sentry.mjs 3995')) { $kill += $p }
}
$kill | ForEach-Object { "stop $($_.ProcessId) $($_.Name)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# Kolo 21: + simulátor GoPay spuštěný z tixly\nextjs-boilerplate (tests/helpers/fake-gopay.mjs)
Get-CimInstance Win32_Process | Where-Object { ([string]$_.CommandLine).Contains('tests/helpers/fake-gopay.mjs') -and ([string]$_.CommandLine).Contains('node') } | ForEach-Object { "stop $($_.ProcessId) $($_.Name)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
