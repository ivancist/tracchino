# Tracchino

Personal single-user webapp: grocery receipts, product nutrition, food diary, and cost analysis.
The full plan, data model and phases are in @PLAN.md — read it before starting any phase.

## Stack
- Cloudflare Worker with Static Assets (one Worker serves the SPA and `/api/*`)
- Frontend: React + TypeScript + Vite (`/src`)
- API: Hono + Zod (`/worker`)
- DB: Cloudflare D1 + Drizzle ORM (`/db`, migrations in `/db/migrations`)
- Receipt photos: private R2 bucket (binding `RECEIPT_PHOTOS`), compressed client-side, served only via `/api/receipts/:id/photo`
- Shared types/Zod schemas: `/shared`
- Hosted on `*.workers.dev` behind Cloudflare Access; `preview_urls = false`
- Auth: Cloudflare Access (Google, single allowed email) + JWT verification in the Worker
- Package manager: npm (v11+ with `allowScripts` in package.json)
- Cloudflare config: `wrangler.jsonc` (`compatibility_date` must not exceed what the workerd bundled in `@cloudflare/vitest-pool-workers` supports)

## Docker only — never install anything on the host
All Node tooling runs inside the `dev` container (compose project `tracchino`, also used by the VS Code Dev Container).
Never run `npm`, `npx`, `wrangler` or `node` directly on the host: it leaves global caches/config outside the project.
- Start: `docker compose up -d dev`
- Run any command: `docker compose exec dev <cmd>` (e.g. `docker compose exec dev npm test`)
- Dependencies, npm cache, wrangler login and Playwright browsers live in named Docker volumes.
- Ports are published on 127.0.0.1 only (dev mode bypasses auth).

## Commands (run inside the container)
- `npm run dev` — Vite + Worker on http://localhost:5173 (local D1, `DEV_AUTH_BYPASS` from `.dev.vars`)
- `npm run typecheck` — `tsc -b` (app, worker+tests, node configs)
- `npm run lint`
- `npm test` — Vitest in the Workers runtime on local D1 with migrations applied
- `npm run e2e` — Playwright (mobile + desktop), starts the dev server itself
- `npm run build` — builds, deletes the `.dev.vars` copy the Vite plugin emits, scans `dist` for secrets
- `npm run cf-typegen` — regenerate `worker/worker-configuration.d.ts` after changing `wrangler.jsonc`
- `npm run db:generate` — drizzle-kit migration from `db/schema.ts`
- `npm run db:migrate:local` / `npm run db:migrate:remote`
- `npm run deploy`

## Secrets
- Local secrets only in `.dev.vars` (gitignored, chmod 600). Production: `npx wrangler secret put <NAME>`.
- The repository is **public**. `.githooks/pre-commit` (enabled via `git config core.hooksPath .githooks`) blocks commits containing any `.dev.vars` value; never bypass it with `--no-verify`.
- Never print secret values in output, logs, tests or docs.

## Conventions
- UI text in Italian; code, identifiers and comments in English.
- Money is always **integer cents** (`*_cents`). Never use floats for money; format only at the UI edge (`Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })`).
- Quantities are **integer grams or millilitres** (`amount`), pieces are `pieces`. Nutrition values are per 100 g / 100 ml.
- Dates are ISO `YYYY-MM-DD` strings; weeks are ISO weeks (Monday start). Timezone: Europe/Rome.
- Derived values (€/kg, €/piece, cost per gram, medians) are computed, never stored.
- Missing data stays `null`, never `0` (e.g. a never-purchased product has unknown cost, not free).
- Every API input is validated with a Zod schema from `/shared`; the frontend uses the same schemas.
- Mobile-first UI: numeric keyboards (`inputMode="decimal"`), large touch targets, works at 360px width.

## Security invariants (never break these)
1. Every `/api/*` route goes through the Access JWT middleware (`worker/middleware/auth.ts`). No exceptions, including health checks.
2. The middleware verifies signature (team JWKS), `aud` and `email` against env config. Failure → 401.
3. `DEV_AUTH_BYPASS` must only exist in local dev config (`.dev.vars`), never in `wrangler.jsonc` or production env.
4. No secrets in `/src` or the built bundle. API keys (Gemini, etc.) live in `wrangler secret` / `.dev.vars` (gitignored).
5. No CORS headers: SPA and API are same-origin.
6. External calls (Gemini, Open Food Facts) happen only from the Worker, never from the browser.
7. The R2 bucket is never public (no custom domain, no `r2.dev`); photos are read only through the authenticated API.
8. State-changing requests pass `sameOriginOnly()` (CSRF) and `parseBody` (JSON content type only, ≤ 256 KB). Read bodies only through `parseBody`.
9. Never log whole error objects or request bodies (they can contain SQL values / personal data): message only.

## Stats semantics
Daily/weekly mean and median include **every** calendar day/ISO week in the period, with 0 for days/weeks without purchases — partial edge weeks included (owner's explicit choice; `complete` is only a display hint).
Store price comparisons rank on one metric only (€/kg, €/l or €/pz) and are Σpaid/Σquantity from raw cents, never averages of rounded unit prices.
Charts follow the dataviz skill; categorical charts use at most 3 series (palette validated all-pairs for 3).

## Verification
Work is not done until it is verified. After any non-trivial change, run the `verify` skill.
- Pure logic (stats, matching, cost calc) → unit tests with hand-computed expected values.
- New/changed route → integration test, including invalid input (400) and unauthenticated (401).
- Schema change → use the `db-migration` skill; never edit an applied migration.
- Receipt extraction/matching change → run the `receipt-eval` skill and compare against the previous score.
- Auth or config change → run the `security-auditor` agent.
- At the end of a phase → run the `phase-reviewer` agent against the phase's "Verifiche" in PLAN.md.

Report results honestly: if a check fails or is skipped, say so.
