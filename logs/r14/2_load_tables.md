
### native_before_1

| krok | p50 | p95 | p99 | požadavků | chyby | řízené 503 (opakováno / i po opakování) |
|---|---|---|---|---|---|---|
| page | 326 ms | 816 ms | 1.05 s | 300 | 0 (0.0 %) | 0 / 0 |
| plan | 113 ms | 722 ms | 1.17 s | 300 | 0 (0.0 %) | 0 / 0 |
| hold | 675 ms | 2.08 s | 2.27 s | 284 | 0 (0.0 %) | 0 / 0 |
| checkout | 962 ms | 2.77 s | 3.51 s | 207 | 0 (0.0 %) | 0 / 0 |
| pay | 1 ms | 2 ms | 2 ms | 207 | 0 (0.0 %) | 0 / 0 |
| webhook | 7.40 s | 9.68 s | 9.76 s | 207 | 0 (0.0 %) | 0 / 0 |

prodáno míst 500, kolize holdu (409) 77, vyprodáno 70, opakování sítě testu 0
konzistence: OK — prodaná místa 500, zaplacené položky 500, vstupenky 500, místo 2× 0/0, osiřelé holdy 0, pending po expiraci 0

### native_before_2

| krok | p50 | p95 | p99 | požadavků | chyby | řízené 503 (opakováno / i po opakování) |
|---|---|---|---|---|---|---|
| page | 361 ms | 1.18 s | 1.27 s | 300 | 0 (0.0 %) | 0 / 0 |
| plan | 113 ms | 1.22 s | 2.06 s | 300 | 0 (0.0 %) | 0 / 0 |
| hold | 774 ms | 2.81 s | 3.04 s | 275 | 0 (0.0 %) | 0 / 0 |
| checkout | 1.17 s | 2.55 s | 3.50 s | 206 | 0 (0.0 %) | 0 / 0 |
| pay | 1 ms | 1 ms | 4 ms | 206 | 0 (0.0 %) | 0 / 0 |
| webhook | 9.12 s | 16.25 s | 17.44 s | 206 | 0 (0.0 %) | 0 / 0 |

prodáno míst 500, kolize holdu (409) 69, vyprodáno 77, opakování sítě testu 0
konzistence: OK — prodaná místa 500, zaplacené položky 500, vstupenky 500, místo 2× 0/0, osiřelé holdy 0, pending po expiraci 0

### native_after_1

| krok | p50 | p95 | p99 | požadavků | chyby | řízené 503 (opakováno / i po opakování) |
|---|---|---|---|---|---|---|
| page | 66 ms | 289 ms | 523 ms | 300 | 0 (0.0 %) | 0 / 0 |
| plan | 18 ms | 103 ms | 170 ms | 300 | 0 (0.0 %) | 0 / 0 |
| hold | 34 ms | 136 ms | 212 ms | 204 | 0 (0.0 %) | 0 / 0 |
| checkout | 137 ms | 397 ms | 464 ms | 202 | 0 (0.0 %) | 0 / 0 |
| pay | 1 ms | 2 ms | 2 ms | 202 | 0 (0.0 %) | 0 / 0 |
| webhook | 659 ms | 2.29 s | 2.46 s | 202 | 0 (0.0 %) | 0 / 0 |

prodáno míst 500, kolize holdu (409) 2, vyprodáno 98, opakování sítě testu 0
konzistence: OK — prodaná místa 500, zaplacené položky 500, vstupenky 500, místo 2× 0/0, osiřelé holdy 0, pending po expiraci 0

### native_after_2

| krok | p50 | p95 | p99 | požadavků | chyby | řízené 503 (opakováno / i po opakování) |
|---|---|---|---|---|---|---|
| page | 105 ms | 441 ms | 556 ms | 300 | 0 (0.0 %) | 0 / 0 |
| plan | 29 ms | 163 ms | 277 ms | 300 | 0 (0.0 %) | 0 / 0 |
| hold | 60 ms | 189 ms | 240 ms | 209 | 0 (0.0 %) | 0 / 0 |
| checkout | 204 ms | 585 ms | 928 ms | 198 | 0 (0.0 %) | 0 / 0 |
| pay | 1 ms | 2 ms | 4 ms | 198 | 0 (0.0 %) | 0 / 0 |
| webhook | 1.33 s | 2.89 s | 3.07 s | 198 | 0 (0.0 %) | 0 / 0 |

prodáno míst 500, kolize holdu (409) 11, vyprodáno 102, opakování sítě testu 0
konzistence: OK — prodaná místa 500, zaplacené položky 500, vstupenky 500, místo 2× 0/0, osiřelé holdy 0, pending po expiraci 0

### native_pool5_before

| krok | p50 | p95 | p99 | požadavků | chyby | řízené 503 (opakováno / i po opakování) |
|---|---|---|---|---|---|---|
| page | 395 ms | 933 ms | 1.12 s | 300 | 0 (0.0 %) | 0 / 0 |
| plan | 402 ms | 1.35 s | 2.38 s | 300 | 0 (0.0 %) | 0 / 0 |
| hold | 822 ms | 2.54 s | 2.72 s | 291 | 0 (0.0 %) | 0 / 0 |
| checkout | 1.28 s | 3.11 s | 3.36 s | 196 | 0 (0.0 %) | 0 / 0 |
| pay | 1 ms | 2 ms | 3 ms | 196 | 0 (0.0 %) | 0 / 0 |
| webhook | 7.70 s | 15.24 s | 15.68 s | 196 | 0 (0.0 %) | 0 / 0 |

prodáno míst 500, kolize holdu (409) 95, vyprodáno 84, opakování sítě testu 0
konzistence: OK — prodaná místa 500, zaplacené položky 500, vstupenky 500, místo 2× 0/0, osiřelé holdy 0, pending po expiraci 0

### native_pool5_after

| krok | p50 | p95 | p99 | požadavků | chyby | řízené 503 (opakováno / i po opakování) |
|---|---|---|---|---|---|---|
| page | 86 ms | 309 ms | 462 ms | 300 | 0 (0.0 %) | 0 / 0 |
| plan | 28 ms | 157 ms | 254 ms | 300 | 0 (0.0 %) | 0 / 0 |
| hold | 52 ms | 168 ms | 240 ms | 217 | 0 (0.0 %) | 0 / 0 |
| checkout | 197 ms | 467 ms | 681 ms | 206 | 0 (0.0 %) | 0 / 0 |
| pay | 1 ms | 1 ms | 3 ms | 206 | 0 (0.0 %) | 0 / 0 |
| webhook | 854 ms | 1.53 s | 1.71 s | 206 | 0 (0.0 %) | 0 / 0 |

prodáno míst 500, kolize holdu (409) 11, vyprodáno 93, opakování sítě testu 0
konzistence: OK — prodaná místa 500, zaplacené položky 500, vstupenky 500, místo 2× 0/0, osiřelé holdy 0, pending po expiraci 0

### native_stress_pool5_burst

| krok | p50 | p95 | p99 | požadavků | chyby | řízené 503 (opakováno / i po opakování) |
|---|---|---|---|---|---|---|
| page | 1.49 s | 1.99 s | 2.03 s | 300 | 0 (0.0 %) | 0 / 0 |
| plan | 3.79 s | 5.85 s | 5.87 s | 300 | 0 (0.0 %) | 0 / 0 |
| hold | 2.87 s | 4.57 s | 4.64 s | 468 | 0 (0.0 %) | 0 / 0 |
| checkout | 4.92 s | 6.05 s | 6.25 s | 190 | 0 (0.0 %) | 0 / 0 |
| pay | 1 ms | 2 ms | 2 ms | 190 | 0 (0.0 %) | 0 / 0 |
| webhook | 39.01 s | 41.76 s | 41.85 s | 190 | 0 (0.0 %) | 0 / 0 |

prodáno míst 423, kolize holdu (409) 278, vyprodáno 0, opakování sítě testu 0
konzistence: OK — prodaná místa 423, zaplacené položky 423, vstupenky 423, místo 2× 0/0, osiřelé holdy 0, pending po expiraci 0
