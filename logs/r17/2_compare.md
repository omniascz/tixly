# Kolo 17 / krok 2 — srovnání p95 po krocích

### A) Zadání kroku 2: 4 samostatné workflow běhy (každá verze 2× po 3 bězích)

| krok | p95 Next 14 (medián) | p95 Next 15 (medián) | rozdíl | cíl (< 1,5 s) splněn |
|---|---|---|---|---|
| page | 224 ms | 400 ms | +79.0 % | — |
| plan | 100 ms | 294 ms | +195.6 % | — |
| hold | 358 ms | 3.25 s | +806.7 % | Next 14 ano / Next 15 ne |
| checkout | 476 ms | 3.36 s | +606.8 % | Next 14 ano / Next 15 ne |
| pay | 2 ms | 2 ms | +14.3 % | — |
| webhook | 2.90 s | 22.71 s | +684.4 % | — |

běhů: Next 14 6, Next 15 6

### B) Párové běhy: obě verze za sebou na tomtéž stroji (3 workflow běhy × 3+3 běhy, 1× obrácené pořadí)

| krok | p95 Next 14 (medián) | p95 Next 15 (medián) | rozdíl | cíl (< 1,5 s) splněn |
|---|---|---|---|---|
| page | 345 ms | 351 ms | +1.8 % | — |
| plan | 223 ms | 205 ms | -8.3 % | — |
| hold | 1.42 s | 1.51 s | +6.2 % | Next 14 ano / Next 15 ne |
| checkout | 1.51 s | 1.71 s | +13.7 % | Next 14 ne / Next 15 ne |
| pay | 2 ms | 2 ms | -22.3 % | — |
| webhook | 9.97 s | 10.73 s | +7.7 % | — |

běhů: Next 14 9, Next 15 9

### C) Párové běhy po strojích (medián p95 hold / checkout / webhook; rozdíl Next 15 proti Next 14)

| workflow běh | CPU | pořadí | Next 14 | Next 15 | hold | checkout | webhook | page | plan |
|---|---|---|---|---|---|---|---|---|---|
| 37767610402 | INTEL XEON PLATINUM 8573C | Next 14 → 15 | 1.42 s / 1.51 s / 9.97 s | 1.51 s / 1.71 s / 10.73 s | +6.2 % | +13.7 % | +7.7 % | +3.1 % | -0.2 % |
| 37770078757 | AMD EPYC 7763 64 | Next 15 → 14 | 2.76 s / 3.10 s / 20.95 s | 3.20 s / 3.50 s / 20.79 s | +15.9 % | +12.9 % | -0.8 % | -8.1 % | +11.6 % |
| 37770629805 | AMD EPYC 9V74 80 | Next 14 → 15 | 1.05 s / 1.05 s / 6.49 s | 986 ms / 1.14 s / 7.38 s | -6.3 % | +8.0 % | +13.7 % | -4.9 % | -26.6 % |

### D) Všechny měřené běhy (p95 v ms)

| workflow běh | druh | CPU | verze | běh | page | plan | hold | checkout | pay | webhook | 5xx | chyby | konzistence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 37767338789 | samostatný | INTEL XEON PLATINUM 8573C | 14.2.35 | 1 | 306 | 148 | 1193 | 1294 | 2 | 7853 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767338789 | samostatný | INTEL XEON PLATINUM 8573C | 14.2.35 | 2 | 253 | 110 | 229 | 434 | 1 | 2214 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767338789 | samostatný | INTEL XEON PLATINUM 8573C | 14.2.35 | 3 | 295 | 139 | 487 | 649 | 2 | 3664 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767386803 | samostatný | AMD EPYC 9V45 96 | 14.2.35 | 1 | 130 | 55 | 161 | 318 | 3 | 1179 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767386803 | samostatný | AMD EPYC 9V45 96 | 14.2.35 | 2 | 194 | 90 | 527 | 518 | 2 | 3578 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767386803 | samostatný | AMD EPYC 9V45 96 | 14.2.35 | 3 | 133 | 56 | 168 | 298 | 2 | 1713 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767375587 | samostatný | AMD EPYC 7763 64 | 15.5.27 | 1 | 437 | 312 | 4436 | 4282 | 2 | 28672 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767375587 | samostatný | AMD EPYC 7763 64 | 15.5.27 | 2 | 469 | 357 | 2775 | 3153 | 1 | 18260 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767375587 | samostatný | AMD EPYC 7763 64 | 15.5.27 | 3 | 399 | 231 | 3022 | 3194 | 1 | 22564 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767402384 | samostatný | AMD EPYC 7763 64 | 15.5.27 | 1 | 394 | 242 | 3601 | 3469 | 2 | 22866 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767402384 | samostatný | AMD EPYC 7763 64 | 15.5.27 | 2 | 386 | 276 | 3282 | 3413 | 3 | 23731 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767402384 | samostatný | AMD EPYC 7763 64 | 15.5.27 | 3 | 402 | 324 | 3214 | 3316 | 2 | 20717 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767610402 | párový | INTEL XEON PLATINUM 8573C | 14.2.35 | 1 | 350 | 205 | 2376 | 2660 | 2 | 17413 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767610402 | párový | INTEL XEON PLATINUM 8573C | 14.2.35 | 2 | 340 | 223 | 1421 | 1506 | 2 | 9966 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767610402 | párový | INTEL XEON PLATINUM 8573C | 14.2.35 | 3 | 316 | 170 | 1397 | 1476 | 2 | 9226 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767610402 | párový | INTEL XEON PLATINUM 8573C | 15.5.27 | 1 | 334 | 187 | 1555 | 1842 | 2 | 10867 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767610402 | párový | INTEL XEON PLATINUM 8573C | 15.5.27 | 2 | 351 | 205 | 1510 | 1713 | 2 | 10729 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37767610402 | párový | INTEL XEON PLATINUM 8573C | 15.5.27 | 3 | 377 | 313 | 948 | 954 | 2 | 6193 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770078757 | párový | AMD EPYC 7763 64 | 15.5.27 | 1 | 409 | 263 | 4829 | 5040 | 2 | 29893 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770078757 | párový | AMD EPYC 7763 64 | 15.5.27 | 2 | 427 | 314 | 3204 | 3504 | 2 | 20690 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770078757 | párový | AMD EPYC 7763 64 | 15.5.27 | 3 | 403 | 427 | 2945 | 3157 | 2 | 20790 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770078757 | párový | AMD EPYC 7763 64 | 14.2.35 | 1 | 482 | 391 | 4007 | 4157 | 2 | 25665 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770078757 | párový | AMD EPYC 7763 64 | 14.2.35 | 2 | 402 | 230 | 2763 | 3103 | 2 | 20954 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770078757 | párový | AMD EPYC 7763 64 | 14.2.35 | 3 | 445 | 281 | 2421 | 2528 | 1 | 17011 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770629805 | párový | AMD EPYC 9V74 80 | 14.2.35 | 1 | 345 | 248 | 813 | 1055 | 2 | 5126 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770629805 | párový | AMD EPYC 9V74 80 | 14.2.35 | 2 | 240 | 112 | 1053 | 1037 | 2 | 6495 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770629805 | párový | AMD EPYC 9V74 80 | 14.2.35 | 3 | 272 | 186 | 1078 | 1302 | 2 | 8518 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770629805 | párový | AMD EPYC 9V74 80 | 15.5.27 | 1 | 292 | 137 | 988 | 1346 | 1 | 7419 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770629805 | párový | AMD EPYC 9V74 80 | 15.5.27 | 2 | 258 | 132 | 767 | 964 | 1 | 6042 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37770629805 | párový | AMD EPYC 9V74 80 | 15.5.27 | 3 | 259 | 148 | 986 | 1139 | 1 | 7382 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37766203272 | zkušební | INTEL XEON PLATINUM 8573C | 15.5.27 | 1 | 401 | 247 | 1539 | 1783 | 3 | 11320 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37766203272 | zkušební | INTEL XEON PLATINUM 8573C | 15.5.27 | 2 | 341 | 218 | 1526 | 1744 | 2 | 11767 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |
| 37766203272 | zkušební | INTEL XEON PLATINUM 8573C | 15.5.27 | 3 | 316 | 163 | 1893 | 2069 | 2 | 14128 | 0 | 0 | OK 500/500/500, 2× 0/0, holdy 0, pending 0 |

Konzistence: 33/33 OK; 5xx celkem 0; chyby celkem 0.
