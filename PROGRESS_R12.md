# PROGRESS — kolo 12 (provozní příručka a UX průchod administrací)

Větev `fix/round12-ux-2026-10-06` z `d0bbcb00`. Výstupy a screenshoty `logs/r12/`.

## Příprava
- `scripts/staging/create.sh --local` → DB `r12demo` (demo agentura demo@tixly-staging.test: Brno + Ostrava, Racek + Hamlet,
  4 termíny, 400 míst, 20 kategorií, 24 blokovaných); tixly_app NOBYPASSRLS, 871 politik. `logs/r12/0_create_local.txt`.
- Build aplikace OK (`logs/r12/0_app_build.txt`); server `logs/r12/serve_r12.sh` (:3200), simulátor GoPay :3998, Mailpit :58225.
