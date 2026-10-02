---
name: verify
description: Run the full Tracchino verification ladder (typecheck, lint, unit + Worker integration tests, e2e, build, secret scan) and report results. Use after any non-trivial change, before saying a task is done, or when the user asks to check/validate the work.
---

# Verify

Run each step in order. Stop at the first failing step, fix it (or report it), then re-run from that step.
Never mark work as done while a step is failing or was skipped without saying so.

## Steps

1. **Typecheck** — `docker compose exec dev npm run typecheck`
2. **Lint** — `docker compose exec dev npm run lint`
3. **Unit + integration tests** — `docker compose exec dev npm test`
   - Integration tests run on local D1 with migrations applied (`@cloudflare/vitest-pool-workers`).
   - Check that changed/added routes have tests for: happy path, invalid input → 400, missing/invalid Access JWT → 401.
4. **E2E** — `docker compose exec dev npm run e2e` (skip only if the change does not touch UI or API; say so explicitly).
5. **Build** — `docker compose exec dev npm run build`
6. **Secret scan** — `npm run build` already runs `scripts/check-secrets.sh dist` (exact `.dev.vars` values). Also check the client bundle for anything secret-shaped:
   ```bash
   scripts/check-secrets.sh dist
   grep -rnoE "AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,}|DEV_AUTH_BYPASS|GEMINI_API_KEY|database_id" dist/client || echo "OK: client bundle clean"
   find dist -name ".dev.vars*"   # must print nothing
   git ls-files | grep -E "^\.dev\.vars$|^backups/" && echo FAIL || echo "OK: nothing secret tracked"
   ```
   Any hit is a failure until explained.
7. **Config check** — `DEV_AUTH_BYPASS` must not appear in `wrangler.jsonc`:
   ```bash
   grep -n "DEV_AUTH_BYPASS" wrangler.jsonc && echo "FAIL" || echo "OK"
   ```
8. **Migrations in sync** — `docker compose exec dev npm run db:generate` must produce no new migration. If it does, the schema changed without a migration: use the `db-migration` skill.

## Optional: production smoke test (after deploy only)
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<app-domain>/api/me   # expect 302 or 401/403, never 200
curl -s -o /dev/null -w "%{http_code}\n" https://<app-domain>/          # expect 302 to Access login
```

## Report
Summarize as a short table: step → pass/fail/skipped (+ reason). Include the failing output for any failure.
