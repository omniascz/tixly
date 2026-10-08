# Kolo 16 / krok 2 — je stroj volný pro zátěžový test? CPU procesů mimo tuto session ≤ 20 % a volná paměť ≥ 4 GB.
# Výstup: jeden řádek „VOLNÝ|OBSAZENÝ …" + top procesy. Procesy této session (node/next/k6 spuštěné pro test) v době
# kontroly neběží; claude (agent) se do cizí zátěže nepočítá.
$n = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$tot = @(); for ($i = 0; $i -lt 5; $i++) { $tot += (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime; Start-Sleep -Seconds 2 }
$total = [math]::Round(($tot | Measure-Object -Average).Average, 1)
$s1 = Get-Process | Select-Object Id, Name, CPU
Start-Sleep -Seconds 10
$s2 = Get-Process | Select-Object Id, Name, CPU
$rows = foreach ($p in $s2) { $o = $s1 | Where-Object Id -eq $p.Id; if ($o -and $null -ne $p.CPU -and $null -ne $o.CPU) { [pscustomobject]@{ Name = $p.Name; Id = $p.Id; Pct = [math]::Round(($p.CPU - $o.CPU) / 10 / $n * 100, 1) } } }
$ext = [math]::Round((($rows | Where-Object { $_.Name -notin @('claude', 'Idle') }) | Measure-Object -Property Pct -Sum).Sum, 1)
$free = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
$ok = ($ext -le 20) -and ($free -ge 4096)
$state = if ($ok) { 'VOLNY' } else { 'OBSAZENY' }
"{0} {1} cpu_celkem={2}% cpu_mimo_session={3}% volna_pamet={4}MB" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $state, $total, $ext, $free
$top = ($rows | Sort-Object Pct -Descending | Select-Object -First 6 | ForEach-Object { "$($_.Name)#$($_.Id)=$($_.Pct)%" }) -join ' '
"  top: $top"
