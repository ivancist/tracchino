# Stato di avanzamento

Leggere questo file all'inizio di una nuova sessione, insieme a `CLAUDE.md` e `PLAN.md`.
Ultimo aggiornamento: 2026-10-03

## Fasi

| Fase | Stato | Produzione |
|---|---|---|
| 0 Setup e accesso | ✅ completa | sì |
| 1 Spesa manuale | ✅ completa (audit + review) | sì |
| 2 Statistiche | ✅ completa (audit + review) | sì (`9e62c5d`) |
| 3 Scansione scontrino AI | 🟡 in corso sul branch `phase-3-scan` | no |
| 4 Nutrizione e barcode | da fare | — |
| 5 Diario | da fare | — |
| 6 Analisi e simulazioni | da fare | — |

## Fase 3: fatto (branch `phase-3-scan`, 255 test verdi)

- Migrazione `0002_ai_usage` (solo additiva, non ancora applicata in produzione) per il tetto di 30 scansioni al giorno.
- `shared/receipt-text.ts`: `normalizeRawText` (chiave degli alias) e `piecesHint` ("UOVA 6P" → 6), con test.
- `shared/text.ts`: `normalizeText` ora separa lettere e cifre ("N5" → "n 5").
- `worker/services/ai/`: interfaccia `ReceiptAi`, client Gemini (`responseSchema`, temperature 0, output validato con Zod, timeout 45 s, 429 → messaggio chiaro).
  - Modello in `wrangler.jsonc` `GEMINI_MODEL` = `gemini-3.5-flash-lite`.
  - Disponibili sull'account anche `gemini-3.8-flash`, `gemini-3.5-flash` e altri.
- `worker/services/matching.ts`: `findCandidates` (alias esatto per catena → fuzzy su nomi e alias di altre catene), `decide` (alias / proposed / uncertain / none, con o senza AI), `matchStore` (P.IVA, poi nome della catena).
- `POST /api/receipts/scan` (`worker/routes/scan.ts`): immagine raw (jpeg/webp/png ≤ 2 MB), tetto giornaliero, estrazione, abbinamento, secondo giro AI con fallback testuale. Il provider è iniettabile: `createApp({ ai })`.
- Salvataggio scontrino: `source: "scan"`, alias per catena creati o confermati in batch (`confirmations` +1 alla creazione; una correzione sovrascrive e riporta a 1).
- Foto: `PUT/GET /api/receipts/:id/photo` su R2 privato (`RECEIPT_PHOTOS`, bucket `tracchino-receipts`, giurisdizione UE). Eliminare lo scontrino elimina la foto. `ReceiptDetail.hasPhoto`.
- Test: `test/routes/scan.test.ts` (AI finta), `test/services/matching.test.ts`, `test/shared/receipt-text.test.ts`. Mutation test sull'alias: rilevato.
- Frontend iniziato:
  - `src/image.ts` comprime la foto (≤ 2000 px, grigi, WebP o JPEG, ≤ 300 KB);
  - `src/api.ts` invia anche Blob;
  - `src/queries.ts` ha `scanReceipt`, `uploadReceiptPhoto` e `setPendingScan`/`takePendingScan`.

## Fase 3: da fare

1. **UI scansione**
   - Pulsante "Scansiona" in `ReceiptsPage` (input file `accept="image/*" capture="environment"`) → compressione → `scanReceipt` → `setPendingScan` → route di revisione (es. `/scontrini/scansione`), che usa `ReceiptEditor` con lo stato iniziale preso dalla scansione.
2. **Revisione in `ReceiptEditPage`**
   - Badge per riga con testo, non solo colore:
     - 🟢 riconosciuto (alias);
     - 🟡 da confermare (proposed);
     - 🔴 incerto: la riga richiede un "Confermo" esplicito, oppure il cambio di prodotto;
     - 🔴 nuovo: pulsante "Crea «suggestedName»".
   - Riga "Sullo scontrino: rawText" (già presente).
   - Negozio non riconosciuto → banner + `StoreForm` precompilato (nome, indirizzo, P.IVA). `StoreForm` va esteso con `initial`.
   - Anteprima della foto. Avviso se `aiMatching` è false.
   - Salvataggio con `source: "scan"`, poi `uploadReceiptPhoto(id, blob)`. Se l'upload fallisce, lo scontrino resta salvato e dal dettaglio si può ricaricare la foto.
   - Nel dettaglio di uno scontrino esistente: miniatura `/api/receipts/:id/photo` se `hasPhoto`, altrimenti "Aggiungi foto".
3. **E2E**: `page.route("**/api/receipts/scan")` con un `ScanResult` di fixture (niente Gemini, niente quota). Verificare:
   - stati e badge;
   - conferma obbligatoria delle righe incerte;
   - creazione del prodotto suggerito;
   - salvataggio → alias creato;
   - foto caricata (body intercettato ≤ 300 KB, tipo webp o jpeg; immagine sintetica generata in pagina).
4. **Eval reale** (skill `receipt-eval`): `scripts/eval-receipts.ts` sulle foto in `fixtures/receipts/<nome>/image.jpg` con `expected.json` scritto a mano. Confronto `gemini-3.5-flash-lite` vs `gemini-3.8-flash`, sequenziale e attento alla quota. Poi tarare prompt e risoluzione.
5. **Verifiche finali**: skill `verify`, subagent `security-auditor` (nuove route scan/photo, R2) e `phase-reviewer` sulla Fase 3.
6. **Produzione** (chiedere l'ok all'utente):
   - l'utente deve **abilitare R2 nella dashboard Cloudflare** (oggi `wrangler r2 bucket create` fallisce con code 10042), poi `npx wrangler r2 bucket create tracchino-receipts --jurisdiction eu` e verifica che non ci sia accesso pubblico (`r2 bucket dev-url get`);
   - `wrangler secret put GEMINI_API_KEY` leggendo la chiave da `.dev.vars` tramite pipe, senza stamparla;
   - backup D1 → `db:migrate:remote` (0002) → merge su `main` → deploy → smoke test.

## Note operative

- La chiave Gemini è stata rigenerata dall'utente (2026-10-03) e si trova in `.dev.vars`.
- Il dev server si avvia con `docker compose exec -d dev sh -c 'npm run db:migrate:local && npm run dev'` → http://localhost:5173.
- Foto degli scontrini dell'utente: `fixtures/receipts/<nome>/image.jpg` (gitignored).
