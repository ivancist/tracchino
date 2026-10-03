# Stato di avanzamento

Leggere questo file all'inizio di una nuova sessione, insieme a `CLAUDE.md` e `PLAN.md`.
Ultimo aggiornamento: 2026-10-03

## Fasi

| Fase | Stato | Produzione |
|---|---|---|
| 0 Setup e accesso | ✅ completa | sì |
| 1 Spesa manuale | ✅ completa (audit + review) | sì |
| 2 Statistiche | ✅ completa (audit + review) | sì (`9e62c5d`) |
| 3 Scansione scontrino AI | 🟡 completa in locale, in verifica (branch `phase-3-scan`) | no |
| 4 Nutrizione e barcode | da fare | — |
| 5 Diario | da fare | — |
| 6 Analisi e simulazioni | da fare | — |

## Fase 3: fatto (branch `phase-3-scan`)

### Backend
- Migrazione `0002_ai_usage` (solo additiva, non ancora applicata in produzione) per il tetto di 30 scansioni al giorno.
- `shared/receipt-text.ts`: `normalizeRawText` (chiave degli alias) e `piecesHint` ("UOVA 6P" → 6).
  - Toglie solo i prezzi con decimali in coda; i numeri interi (formati, grammature: "GR.NAT. 120") restano, così la chiave è stabile tra una scansione e l'altra.
- `shared/text.ts`: `normalizeText` separa lettere e cifre ("N5" → "n 5").
- `worker/services/ai/`: interfaccia `ReceiptAi` e client Gemini.
  - `responseSchema`, temperature 0, output validato con Zod, timeout 45 s.
  - Un solo nuovo tentativo su 500/503 (sovraccarico); 429 → messaggio chiaro, senza retry.
  - Prompt: testo copiato senza correzioni, niente simboli iniziali, righe "2 PZ x" → `pieces`, date GG/MM/AA.
- `worker/services/matching.ts`:
  - `findCandidates`: alias esatto per catena, poi fuzzy su nomi e alias, più `coverageScore` (nome prodotto contenuto nella riga: "UOVA A TERRA XL 6P" → "Uova", "SGOMBRI GR.NAT." → "Sgombro al naturale");
  - `decide`: alias / proposed / uncertain / none;
  - `matchStore`: P.IVA, poi nome della catena. La P.IVA è della società, non del punto vendita (una società può avere molti negozi): tra i negozi con la stessa P.IVA o catena sceglie per indirizzo; senza indirizzo prende il più recente con stato `chain`, "controlla il punto vendita".
- `POST /api/receipts/scan`, salvataggio con `source: "scan"` e alias per catena, foto `PUT/GET /api/receipts/:id/photo` su R2 privato.
  - Se l'estrazione fallisce per colpa del provider, la scansione non consuma il tetto giornaliero (`ai_calls` conta comunque).
  - `parseImage` (eccezione voluta a `parseBody`: il corpo è un'immagine, non JSON) controlla anche i magic bytes: tipo dichiarato ≠ contenuto → 415.
  - Foto: se l'update D1 fallisce, l'oggetto R2 appena scritto viene cancellato; `Cache-Control: private, no-cache`.
- Salvare uno scontrino scansionato conferma tutte le righe, anche le "Proposto" non toccate: ognuna crea o conferma l'alias.

### UI
- "📷 Scansiona" in `ReceiptsPage`: compressione nel browser → scan → `/scontrini/scansione` (`ReceiptEditPage scan`).
- Revisione:
  - stato per riga scritto a parole (Riconosciuto / Proposto / Incerto / Nuovo prodotto / Confermato);
  - le righe incerte richiedono "Confermo" o un altro prodotto;
  - "Crea «nome suggerito»" per i prodotti nuovi;
  - negozio sconosciuto → avviso + `StoreForm` precompilato (`initial`: catena, punto vendita, indirizzo, P.IVA), mai negozio predefinito;
  - avvisi per data non letta, abbinamento AI mancante, somma diversa dal totale stampato; anteprima della foto.
- Al salvataggio carica la foto; se fallisce, porta al dettaglio dello scontrino con avviso e pulsante per riprovare.
- Dettaglio dello scontrino: foto (da `/api/receipts/:id/photo`) e "Aggiungi foto" / "Sostituisci foto".
- Le route `scontrini/nuovo|scansione|:id` hanno `key` diverse: senza, React riusava la pagina e lo stato della scansione sopravviveva.

### Test e verifiche
- 275 test Vitest (nuovi: `test/services/gemini.test.ts`, `coverageScore`, casi di normalizzazione reali) e 26 e2e.
- `e2e/scan.spec.ts` (scan finto con `page.route`):
  - stati, conferma obbligatoria (mutation test: rilevato), nuovo negozio e prodotto, `source: "scan"` e `rawText` salvati;
  - foto ≤ 300 KB webp/jpeg su R2 locale, upload fallito → recupero, ricaricamento della revisione.
- La creazione degli alias e la seconda scansione abbinata dagli alias sono coperte in `test/routes/scan.test.ts`.

### Eval reale (skill `receipt-eval`)
- `npm run eval:receipts -- [--model X] [--no-ai-match] [--only id] [--yes]` (`scripts/eval-receipts.ts`, `tsx`).
  - Comprime le foto con `src/image.ts` in Chromium tramite il dev server (deve essere attivo); cache in `image.scan.webp`.
  - Il catalogo dell'eval contiene i prodotti degli `expected.json`; la "seconda scansione" usa gli alias della verità.
- Fixture locali (gitignored, anche `expected.json`): `eurospin-1` (35 righe, 42,24 €), `rossotono-1` (4 righe, 11,67 €). Le foto originali erano HEIC: convertite con `sips`.
- Risultati 2026-10-03:

  | metrica | flash-lite (prima) | flash-lite (dopo) | 3.8-flash |
  |---|---|---|---|
  | righe, prezzi, totale, negozio | 100% | 100% | 100% |
  | data | 50% | 100% | 100% |
  | pezzi | 97,4% | 97,4% | 100% |
  | prodotto corretto | 94,9% | 100% | 100% |
  | alias alla 2ª scansione | 92,3% | 100% | 100% |
  | tempo medio | 6,4 s | 5,1 s | 16,4 s |

- Si resta su `gemini-3.5-flash-lite`: stessa qualità tranne i pezzi di una riga "2 PZ x", 3 volte più veloce e circa 500 richieste al giorno contro circa 20. Il 3.8-flash ha risposto 503 due volte prima di funzionare.
- Workers AI come riserva è rimandato (PLAN §5), quindi `--provider` non esiste.

### Verifiche del 2026-10-03
- Scala `verify` verde: typecheck, lint, 275 test, 26 e2e, build, scansione dei segreti, config, migrazioni.
- `security-auditor`: SECURE, nessun punto bloccante. Corretti i due MEDIUM (magic bytes, oggetto R2 orfano) e il LOW sulla cache. Resta da verificare l'accesso pubblico al bucket dopo la creazione. Il `database_id` D1 è nel repo da prima della Fase 3: non è una credenziale, ma lo decide l'utente.
- `phase-reviewer`: "non completa" per il secondo provider (vedi sopra) e per l'eval limitato a 2 scontrini, che sono anche quelli usati per tarare il prompt.
  - Aggiunti: test "una scansione non scrive su R2", e2e per la data non leggibile, negozio per indirizzo, tetto non consumato sui fallimenti.
  - Non coperto: test della compressione con foto ad alta entropia (il ciclo di riduzione non è esercitato; le foto reali escono a 196 KB e 135 KB).

## Fase 3: da fare

1. Workers AI come riserva: **rimandato** (decisione del 2026-10-03, motivata in PLAN §5).
2. Più scontrini per l'eval (obiettivo 5–10, catene diverse, sconti, prodotti a peso). Facoltativo: tarare la risoluzione.
3. **Produzione** (chiedere l'ok all'utente):
   - R2 è stato abilitato dall'utente: `npx wrangler r2 bucket create tracchino-receipts --jurisdiction eu`, poi verificare che non ci sia accesso pubblico (`r2 bucket dev-url get`);
   - `wrangler secret put GEMINI_API_KEY` leggendo la chiave da `.dev.vars` tramite pipe, senza stamparla;
   - backup D1 → `db:migrate:remote` (0002) → merge su `main` → deploy → smoke test → prova reale dal telefono.

## Note operative

- La chiave Gemini è stata rigenerata dall'utente (2026-10-03) e si trova in `.dev.vars`.
- Il dev server si avvia con `docker compose exec -d dev sh -c 'npm run db:migrate:local && npm run dev'` → http://localhost:5173.
- Foto degli scontrini dell'utente: `fixtures/receipts/<nome>/image.jpg` + `expected.json` (gitignored: il repo è pubblico; versionarli solo se l'utente lo decide).
