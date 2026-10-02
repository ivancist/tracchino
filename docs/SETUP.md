# Setup — Cloudflare, accesso e sviluppo locale

Tutti i comandi girano nel container Docker (`docker compose exec dev …`): sul Mac non si installa niente.
I valori personali (email, team Access, AUD, chiave Gemini) **non vanno mai nel repo**, che è pubblico: in locale stanno in `.dev.vars`, in produzione nei secret di Cloudflare.

## 0. Avvio del container
```bash
docker compose up -d dev
docker compose exec dev npm ci          # solo la prima volta o quando cambia package-lock.json
```
In alternativa: VS Code → "Dev Containers: Reopen in Container" (stesso container, stessi volumi).

## 1. Login di wrangler (una volta sola)
```bash
docker compose exec -it dev npx wrangler login --device
```
Apri l'URL mostrato, inserisci il codice e autorizza. Il token resta nel volume Docker `tracchino_cf-config`, non sul Mac.
Verifica: `docker compose exec dev npx wrangler whoami`.

## 2. Database D1 (in UE)
```bash
docker compose exec dev npx wrangler d1 create tracchino --jurisdiction eu
```
Copia il `database_id` in `wrangler.jsonc`, poi:
```bash
docker compose exec dev npm run db:migrate:remote
```

## 3. Secret di produzione
```bash
docker compose exec -it dev npx wrangler secret put ALLOWED_EMAIL       # la tua email Google
```
`GEMINI_API_KEY` serve dalla Fase 3. `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD` si impostano al passo 5.

## 4. Primo deploy (sicuro anche senza Access)
```bash
docker compose exec dev npm run deploy
```
Finché i secret di Access non sono impostati, ogni `/api/*` risponde 401: il Worker blocca tutto se manca la configurazione. Si vede solo un guscio HTML vuoto, senza dati.

## 5. Cloudflare Access con login Google
1. **Zero Trust** (dashboard Cloudflare → Zero Trust): crea il team (piano Free). Il team domain sarà `<team>.cloudflareaccess.com`.
2. **Client OAuth Google** ([Google Cloud Console](https://console.cloud.google.com/), va bene lo stesso progetto di Gemini):
   - *APIs & Services → OAuth consent screen*: tipo External, aggiungi la tua email tra i test users.
   - *Credentials → Create credentials → OAuth client ID → Web application*
     - Authorized JavaScript origins: `https://<team>.cloudflareaccess.com`
     - Authorized redirect URI: `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
   - Copia Client ID e Client Secret.
3. **Zero Trust → Settings → Authentication → Login methods → Add → Google**: incolla ID e secret, poi premi *Test*.
4. **Workers & Pages → tracchino → Settings → Domains & Routes → workers.dev → Enable Cloudflare Access**. Poi *Manage Cloudflare Access* (o Zero Trust → Access → Applications):
   - Policy: **Allow**, Include → **Emails** → la tua email (solo quella).
   - Login methods: solo **Google**.
   - Session duration: 1 mese.
   - Copia l'**Application Audience (AUD) Tag**.
5. Imposta i secret e rifai il deploy:
   ```bash
   docker compose exec -it dev npx wrangler secret put ACCESS_TEAM_DOMAIN   # es. mioteam.cloudflareaccess.com
   docker compose exec -it dev npx wrangler secret put ACCESS_AUD
   docker compose exec dev npm run deploy
   ```

## 6. Verifica finale (smoke test)
```bash
URL=https://tracchino.<sottodominio>.workers.dev
curl -s -o /dev/null -w "%{http_code}\n" $URL/          # atteso 302 (redirect al login Access)
curl -s -o /dev/null -w "%{http_code}\n" $URL/api/me    # atteso 302/401/403, mai 200
```
Poi apri l'URL in incognito sul telefono: deve chiedere il login Google, mostrare la tua email e "Database: Connesso". Con un altro account Google l'accesso deve essere negato.

## Sviluppo locale
```bash
docker compose exec dev npm run db:migrate:local
docker compose exec dev npm run dev       # → http://localhost:5173 sul Mac
```
In locale il login è bypassato (`DEV_AUTH_BYPASS` in `.dev.vars`), solo su `localhost`. La porta è pubblicata solo su `127.0.0.1`: telefono e rete Wi-Fi non la raggiungono, è voluto. Sul telefono si prova la versione deployata, mentre la vista mobile si prova con DevTools (Cmd+Opt+I → icona dispositivo) o con `npm run e2e`.

## Test
```bash
docker compose exec dev npm run typecheck
docker compose exec dev npm run lint
docker compose exec dev npm test          # Workers runtime + D1 locale
docker compose exec dev npm run e2e       # Playwright, mobile + desktop
docker compose exec dev npm run build     # include la scansione dei segreti
```

## Pulizia completa (se un giorno vuoi rimuovere tutto)
```bash
docker compose down --volumes --rmi local   # container, volumi (dipendenze, login wrangler) e immagine
```
