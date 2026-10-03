# Stato di avanzamento

Leggere questo file all'inizio di una nuova sessione, insieme a `CLAUDE.md` e `PLAN.md`.
Ultimo aggiornamento: 2026-10-03 (pezzi, scorte nell'elenco prodotti, pulsanti fluttuanti)

## Riprendere da qui

- **Produzione = `main` = `e9ffca7`** (versione Worker `44d4d3f9`). Nessun branch aperto: si lavora su un branch nuovo e si fa fast-forward su `main`.
- Migrazioni applicate in produzione: `0000`…`0007` (ultime: `0006_shopping_list`, `0007_stock_adjustments`). Backup pre-migrazione in `backups/` (gitignored).
- Tutte le fasi 0–7 del piano sono online. Aggiunte successive, richieste dall'utente e online:
  - valori nutrizionali: grassi saturi, fibre e sale (form, OFF, diario, analisi);
  - diario: totali per pasto (kcal, costo, macro) e "↻ Ripeti" pasto precedente con modifiche (marca, quantità, togliere voci);
  - porzioni: una voce salvata conserva il peso della porzione di allora.
- Prove reali dall'iPhone (scansione scontrino, barcode): **fatte dall'utente** (2026-10-03).
- Ancora aperto (dettagli in fondo):
  - più scontrini per l'eval;
  - Workers AI rimandato;
  - bundle > 500 kB (facoltativo).
- e2e: ogni spec usa date e tag propri (Statistiche 2000–2019, Diario 1946–1989, Analisi 1902–1934, tag casuali). I nuovi spec che scrivono dati devono fare lo stesso.

## Fasi

| Fase | Stato | Produzione |
|---|---|---|
| 0 Setup e accesso | ✅ completa | sì |
| 1 Spesa manuale | ✅ completa (audit + review) | sì |
| 2 Statistiche | ✅ completa (audit + review) | sì (`9e62c5d`) |
| 3 Scansione scontrino AI | ✅ completa (audit + review; Workers AI rimandato) | sì (`ac6deac`) |
| 4 Nutrizione e barcode | ✅ completa (audit + review) | sì (`7e4ab67`) |
| 5 Diario | ✅ completa (audit + review) | sì (`820286a`) |
| 6 Analisi e simulazioni | ✅ completa (audit + review) | sì (`334df0d`) |
| 7 Lista della spesa e scorte | ✅ completa (audit + review) | sì (`fa0e13f`) |

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

## Fase 3: in produzione (2026-10-03)

- Bucket R2 `tracchino-receipts` (UE) creato: `r2.dev` disabilitato, nessun dominio personalizzato.
- Secret `GEMINI_API_KEY` impostato (pipe da `.dev.vars`, mai stampato).
- Backup `backups/d1-2026-10-03-pre-0002.sql`, poi migrazione 0002 applicata in remoto.
- Fast-forward di `main` a `ac6deac`, deploy (binding D1 e R2 UE presenti).
- Smoke test senza login: `/`, `/api/me`, `/api/receipts`, `/api/receipts/1/photo`, `POST /api/receipts/scan` → 302 verso Access.

### Ancora aperto
1. ~~Prova reale dal telefono~~: fatta dall'utente (2026-10-03).
2. Più scontrini per l'eval (obiettivo 5–10: catene diverse, sconti, prodotti a peso, righe "2 X"); poi eventuale taratura della risoluzione.
3. Workers AI come riserva: rimandato (PLAN §5).

## Fase 4: fatto (branch `phase-4-nutrition`)

- `shared/barcode.ts`: `isValidGtin` (cifra di controllo; UPC-E espanso) e `cleanBarcode`.
- `shared/off.ts`: `mapOffProduct`, risposta OFF v2 → precompilazione.
  - Nome (it, poi generico), prima marca, formato da `product_quantity` o dal testo ("1,5 L", "33cl", "6 x 125 g").
  - kcal, oppure kJ / 4,184; numeri come stringhe con la virgola.
  - Valori impossibili scartati con avviso.
- `shared/nutrition.ts`: `nutritionWarnings` (macro > 100 g, somma > 100 g, zuccheri > carboidrati, kcal ≠ 4P + 9G + 4C oltre il 20% o 20 kcal).
- `GET /api/off/:barcode` (`worker/routes/off.ts`):
  - codice già in catalogo → `existingProductId`, senza chiamare OFF;
  - altrimenti OFF v2 con i soli campi utili, User-Agent identificativo (solo l'URL del repo), timeout 8 s;
  - errori: 404 se OFF non conosce il codice, 502 per errori o assenza di risposta, 400 per codice non valido. `createApp({ offFetch })` per i test.
- Schema prodotto: `barcode` validato e ripulito; `nutritionSource: "off"` dichiarato dal client solo per valori OFF invariati. `Product.nutritionSource` esposto.
- UI:
  - `BarcodeScanner`: `BarcodeDetector`, oppure zxing (chunk separato, circa 120 KB gzip) da `getUserMedia`, oppure codice digitato; la fotocamera si chiude sempre.
  - Pagina Prodotti "📷 Barcode": codice noto → prodotto; nuovo → form precompilato da OFF (stato di navigazione); assente → form con avviso.
  - `ProductForm`: campo barcode con Scansiona / Cerca, «Usa X» se il codice esiste già (anche dalla riga dello scontrino), avvisi di plausibilità in tempo reale, "Fonte: Open Food Facts / modificati a mano".
  - Header delle pagine: a 360 px i pulsanti vanno sotto il titolo invece di spezzarlo.
- Test: `test/shared/off-nutrition.test.ts` (28), `test/routes/off.test.ts` (8), `e2e/barcode.spec.ts` (6 × 2).
  - L'e2e comprende zxing che decodifica un EAN-13 vero disegnato sulla fotocamera finta, cioè il percorso di Safari iOS.
  - Mutation test sulla fonte OFF: rilevato.
- Verifica reale una tantum con Nutella (3017620422003): il formato della risposta corrisponde; un codice sconosciuto → 404.
- Nessuna migrazione: lo schema aveva già barcode, valori e `nutrition_source`.

### Verifiche del 2026-10-03
- Scala `verify` verde: 322 test, 40 e2e, build, scansione dei segreti, config, migrazioni.
- `security-auditor`: SECURE, solo punti LOW. Corretti:
  - la fotocamera restava accesa se il dialog si chiudeva mentre il browser chiedeva il permesso;
  - OFF: i redirect non vengono seguiti e la risposta è limitata a 512 KB.
- `phase-reviewer`: completa. Corretti:
  - `""` da OFF diventava 0 (ora `null`);
  - una ricerca lenta poteva sovrascrivere valori appena digitati;
  - unità ml senza formato;
  - 200 non-JSON → 502 invece di 404; messaggio per il 429;
  - UPC-E normalizzato a 13 cifre;
  - "1.000 g", "1 litro", "500 grammi";
  - parametro della route validato con lo schema Zod `barcodeCode`.
- Rischio "barcode non validi già salvati" verificato: in produzione non ci sono prodotti.
- Bug trovato dall'e2e: chiudere un dialog annidato (scanner) chiudeva anche quello esterno (nuovo prodotto), perché l'evento `close` risale l'albero React. Ora `Dialog` reagisce solo alla propria chiusura.

### In produzione (2026-10-03)
- Fast-forward di `main` a `7e4ab67`, deploy; smoke test senza login (`/`, `/api/me`, `/api/products`, `/api/off/…`, `/api/receipts/1/photo`) → 302.
- Ancora aperto: prova reale dall'iPhone (zxing con la fotocamera vera, permesso fotocamera su `workers.dev`).


## Fase 5: fatto (branch `phase-5-diary`)

- Nessuna migrazione: `portions` e `diary_entries` erano già nello schema iniziale.
- `shared/diary.ts`:
  - `nutrientsFor`, `sumKnown`/`sumNutrients` (somma dei noti e numero di mancanti);
  - `unitCost` (media 90 giorni o ultimo prezzo, da centesimi e grammi grezzi, `estimated`), `costCents` (un solo arrotondamento), `portionAmount`.
- API:
  - `GET /api/diary?date&costMode` (voci con valori e costo per voce, totali, costo del giorno);
  - `GET /api/diary/frequent`;
  - `POST/PATCH/DELETE /api/diary`: grammi oppure porzione × quantità, la porzione deve essere del prodotto;
  - `GET/POST /api/products/:id/portions`, `PATCH/DELETE /api/portions/:id`.
- UI:
  - pagina Diario (`/diario?data=`): navigazione tra i giorni, riquadri (kcal, costo, P/G/C/zuccheri) con "≥", "n.d." e voci senza dato; pasti con subtotale kcal; tocco su una voce → modifica o elimina;
  - dialog: pasto, alimento (frequenti in cima, creazione al volo), Grammi o Porzioni (con nuova porzione al volo), anteprima;
  - modalità del costo nel browser;
  - sezione Porzioni nella scheda prodotto; barra in basso con Diario e "Altro".
- Bug trovato dall'e2e: aprendo il dialog prima che i prodotti fossero caricati, il picker offriva solo "Crea" (duplicati). Ora la pagina precarica i prodotti e il picker compare solo a lista pronta.
- Test: `test/shared/diary.test.ts` (12, valori calcolati a mano), `test/routes/diary.test.ts` (12), `e2e/diary.spec.ts` (3 × 2).

### Verifiche del 2026-10-03
- `security-auditor`: SECURE, solo punti LOW. Corretto: eliminando una porzione restava `portion_qty` senza `portion_id`. Aggiunti test PATCH (porzione di un altro prodotto, id non numerico).
- `phase-reviewer`: completa. Corretti o aggiunti:
  - finestra N configurabile (`windowDays`, 30/90/180/365);
  - test sul confine dei 90/91 giorni e a cavallo d'anno, unione di prodotti con diario e porzioni, PATCH porzioni (lo storico resta in grammi), acquisto scontato al 100% → costo 0 noto;
  - testo "come è calcolato".
- Bug trovato dall'e2e: cambiando un'impostazione del costo il riquadro si chiudeva durante il ricaricamento. Ora le impostazioni stanno fuori dal blocco dei dati.
- Scala `verify` verde: 355 test, 46 e2e.

### In produzione (2026-10-03)
- Fast-forward di `main` a `820286a`, deploy; smoke test senza login (`/diario`, `/api/diary…`, `/api/products/1/portions`, `DELETE /api/portions/1`) → 302.

## Fase 6: fatto (branch `phase-6-analysis`)

- `shared/analysis.ts`:
  - `dietSummary` (giorni registrati, medie, stima settimanale, voci senza costo);
  - `nutrientValue` (cent per 100 kcal / 10 g di proteine, da centesimi e grammi grezzi);
  - `consumptionVsPurchases`;
  - `simulate` (A → B × fattore; differenza solo sulle voci toccate, `null` se manca un dato).
- API:
  - `GET /api/analysis?from&to&costMode&windowDays`: dieta e valore dei prodotti; periodo predefinito dal primo giorno del diario; massimo 3700 giorni;
  - `GET /api/analysis/simulate?…&fromProduct&toProduct&factor`.
- UI: Statistiche → "Spesa | Dieta" (`?vista=dieta`).
  - Riquadri: costo medio al giorno, settimana stimata, kcal e proteine medie, costo per 100 kcal.
  - Valore dei prodotti, ordinabile per più mangiati, € per 100 kcal o € per 10 g di proteine.
  - "Cosa succede se…" con la differenza totale e per giorno registrato.
- `src/costPreference.ts`: preferenza del costo comune a Diario e Analisi.
- Test: `test/shared/analysis.test.ts` (10, valori a mano: A → A = 0, pasta → riso +6 cent / −16,2 kcal, 1,5× +27, metà −16), `test/routes/analysis.test.ts` (8), `e2e/analysis.spec.ts` (2 × 2).
  - Mutation test (la simulazione ignora il prodotto sostitutivo): rilevato da test unitari, di integrazione ed e2e.
- Bug di test trovato: gli e2e di Diario e Analisi scrivevano scontrini in anni casuali che potevano cadere nelle settimane usate dall'e2e Statistiche (flaky).
  - Ora intervalli separati: Statistiche 2000–2019, Diario 1935–1989, Analisi 1902–1934.
  - Pulizia degli scontrini a fine test; D1 locale ripulito.
  - Suite completa ×2: 100/100.

### Verifiche del 2026-10-03
- `security-auditor`: SECURE, solo punti LOW. Corretti: acquisti raggruppati per prodotto una sola volta; `from` dopo il `to` predefinito → 400.
- `phase-reviewer`: completa con riserve. Corretti:
  - frequenza vera ("mangiato in X giorni su Y registrati · comprato in Z giorni");
  - costo per 100 kcal della dieta solo su voci con costo e kcal (prima mescolava le due popolazioni);
  - valori per prodotto non arrotondati (0,053 €);
  - simulazione: unità diverse → 400, minimo 1 g;
  - test: kcal 0, diario vuoto, `costMode=last`, fattore 10,01.
- Scala `verify` verde: 378 test, 50 e2e.

### In produzione (2026-10-03)
- Fast-forward di `main` a `334df0d`, deploy; smoke test senza login (`/statistiche`, `/api/analysis`, `/api/analysis/simulate`) → 302.

## Fibre e grassi saturi (2026-10-03, in produzione)

- Migrazione `0003_fiber_saturated`: due colonne nullable `saturated_fat_100`, `fiber_100` su `products`. Solo `ALTER TABLE ADD`, senza CHECK (un CHECK ricostruirebbe `products`, da cui `portions` dipende in CASCADE); la validazione 0–100 è in Zod. In produzione dal 2026-10-03, con l'ok dell'utente: backup `backups/d1-2026-10-03-pre-0003.sql`, migrazione applicata (colonne verificate), fast-forward di `main` a `87cfc59`, deploy, smoke test → 302, select di prova in remoto riuscita.
- Ovunque: form prodotto ("di cui saturi", "Fibre"), mapping OFF (`saturated-fat_100g`, `fiber_100g`), unione di prodotti, diario (riquadri e totali), analisi e simulazione.
- Plausibilità:
  - saturi ≤ grassi (+0,5 g);
  - le fibre entrano nella somma ≤ 100 g;
  - kcal stimate con 2 kcal/g di fibre (UE), solo se le fibre sono note.
- Test: 381 Vitest, 50 e2e verdi.

## Sale (2026-10-03, in produzione)

- Migrazione `0004_salt`: colonna nullable `salt_100` su `products` (solo `ALTER TABLE ADD`). In produzione dal 2026-10-03, con l'ok dell'utente: backup `backups/d1-2026-10-03-pre-0004.sql`, migrazione applicata (colonna verificata), fast-forward di `main` a `1c69cb5`, deploy, smoke test → 302.
- Ovunque, come per le fibre: form ("Sale (g)"), OFF (`salt_100g`, altrimenti `sodium_100g` × 2,5; 2 decimali), unione di prodotti, diario (riquadro con 2 decimali), analisi e simulazione.
- Plausibilità: il sale entra nella somma ≤ 100 g (0 kcal, ma è massa).
- Test: 382 Vitest, 50 e2e verdi.

## Diario: totali per pasto e "Ripeti" (2026-10-03)

- Ogni pasto mostra kcal e costo, più P, G (saturi), C (zuccheri), fibre e sale, con "≥" se manca qualche dato; i valori ignoti sono omessi.
- "↻ Ripeti" per pasto: i pasti dello stesso tipo dell'ultimo anno, quelli identici raggruppati ("Uguale in N giorni"; `groupRecentMeals`/`mealKey` in `shared/diary.ts`).
  - Si sceglie un pasto e, per ogni voce, la si toglie, si cambia prodotto (in cima lo stesso gruppo, cioè le altre marche) o si cambia quantità.
  - Cambiando prodotto, la porzione decade e restano i grammi.
  - Salvataggio atomico.
- Peso delle porzioni nel tempo: una voce salvata conserva i grammi di allora.
  - Ridimensionare "1 vasetto" vale solo per le voci nuove e per i pasti ripetuti; l'anteprima di "Ripeti" mostra il peso attuale.
  - Modificando una voce passata con la stessa porzione si usa il peso di allora (`savedPortionGrams`: 2 vasetti = 2 × il vecchio peso); un'altra porzione o un altro prodotto → peso attuale. Il form lo segnala.
- API: `GET /api/diary/meals?meal&before&limit`, `POST /api/diary/batch` (massimo 50 voci, tutte valide o nessuna salvata). Nessuna migrazione.
- e2e: tag casuali (prima un tag poteva essere prefisso di un altro → flaky) e intervalli di date: Diario 1946–1989, Analisi 1902–1934, Statistiche 2000–2019. Suite ×2: 104/104.

## Scansione: righe uguali unite e righe di quantità (2026-10-03)

Segnalazione dell'utente sullo scontrino `eurospin-1`: passata e ceci comparivano due volte; "2 PZ x 1,99" finiva sul tonno (1,19) invece che sullo sgombro (3,98).
- `worker/services/scan-lines.ts`:
  - `attachQuantityLines`: il modello trascrive la riga di quantità come voce a sé (`kind: "quantity"`, `unitPriceCents`), il Worker la aggancia al prodotto sotto, poi a quello sopra, solo se il conto torna;
  - `fixPieces`: pezzi con prezzo unitario che non torna → spostati sulla riga vicina che torna, oppure scartati; poi `piecesHint`;
  - `mergeDuplicateLines`: stessa chiave `normalizeRawText` → una riga sola (importi e sconti sommati; i pezzi sommati sono stati poi corretti in confezioni, vedi sotto).
- Causa trovata con l'output grezzo: il modello leggeva "2 PZ x" come seguito del tonno e da lì **spostava di una riga tutti i prezzi successivi** (eval: prezzi 51%). Chiedere nel prompt di "verificare il conto" non bastava; trascrivere la riga a parte sì.
- Eval: i pezzi in più ora contano come errore (prima no), metrica `merged` (righe unite uguali alla verità unita), output grezzo e negozio letto salvati nel risultato.
  - Risultato `gemini-3.5-flash-lite`: 100% su prezzi, pezzi, righe unite, prodotti, alias e totale; eurospin ripetuto 3 volte, sempre 100%.
  - In una run la P.IVA di rossotono è stata letta male (catena 50%); in 3 ripetizioni sempre giusta: variabilità del modello.
- Test: `test/services/scan-lines.test.ts` (13), caso Eurospin in `test/routes/scan.test.ts`. Mutazioni (aggancio senza conto, nessuna unione) rilevate.
- Scala `verify` verde: 405 test, 52 e2e, build, segreti, config, migrazioni. Nessuna migrazione.

## Confezioni distinte dai pezzi e porzione "Confezione" (2026-10-03)

Correzione chiesta dall'utente dopo la versione precedente (sopra), che sommava le righe uguali nei **pezzi**: "confezioni e pezzi sono due cose diverse; 2 confezioni di uova sono 2 confezioni da 6 pezzi".
- I dati di produzione lo confermavano: "Carote bio 500 g" con 6 pezzi e "Scalogno 250 g" con 8 pezzi erano pezzi nella confezione, ma l'app li leggeva come confezioni (3 kg e 2 kg).
- Migrazione `0005_packages` (solo additiva):
  - colonna `receipt_items.packages`;
  - righe degli scontrini scansionati → 1 confezione, i pezzi restano;
  - righe manuali di prodotti confezionati → i vecchi pezzi diventano confezioni;
  - porzione "Confezione" per i prodotti g/ml confezionati che non ce l'hanno.
  - Provata su una copia dei dati di produzione (schema 0000–0004 + export dei dati): 40 righe e 38 voci di diario invariate, tutte le righe a 1 confezione con i loro pezzi, 27 prodotti confezionati con una sola "Confezione" (22 nuove + 5 dell'utente), nessun doppione.
- `shared/pricing.ts`: `totalPieces` = confezioni × pezzi; peso = confezioni × peso della confezione (i pezzi non lo cambiano); €/pz sui pezzi totali. Statistiche, diario e analisi passano dallo stesso calcolo.
- Scansione: il modello restituisce `quantity` (righe "2 PZ x" o "2 X 1,29") → confezioni; pezzi per confezione solo da `piecesHint`; le righe uguali sommano le confezioni.
- UI: riga dello scontrino con Prezzo, Confezioni, Pezzi (per conf.), Peso (2 × 2 su telefono); elenco acquisti "2 conf. × 6 pz".
- Porzione "Confezione" automatica (`syncPackagePortion` in `worker/routes/products.ts`): alla creazione, o quando il peso della confezione cambia; segue il nuovo peso solo se coincideva col vecchio.
- Test: 416 Vitest (nuovi `test/routes/package-portion.test.ts`, `totalPieces`, carote 1 × 500 g con 6 pezzi, uova 2 × 6 per negozio), 52 e2e (confezioni e pezzi nella revisione e nel salvato, uova 2 × 6, porzione "Confezione" nel diario). Mutazioni (peso × pezzi, unione che somma i pezzi) rilevate.
- Eval reale ×2: 100% su prezzi, confezioni/pezzi, righe unite, prodotti, alias, totale.
- Riga dello scontrino: con più di una confezione mostra anche il prezzo per confezione ("0,89 €/conf.", `perPackageCents`), richiesto dall'utente.
- In produzione dal 2026-10-03, con l'ok dell'utente: backup `backups/d1-2026-10-03-pre-0005-final.sql`, migrazione applicata (40 righe a 1 confezione, pezzi invariati, 27 "Confezione", nessun doppione), fast-forward di `main` a `87bb24e`, deploy, smoke test → 302.

## Fase 7: lista della spesa e scorte (branch `phase-7-shopping`)

Richiesta dell'utente; scelte dell'utente: scorta solo da acquisti nell'app (nessuna correzione a mano), suggerimenti per urgenza con quantità dal consumo tipico, proposte da accettare, prodotti fuori dal diario solo a mano.
- `shared/pantry.ts`:
  - `estimateStock`: acquisti dal primo nell'app − diario da allora, acquisto prima del consumo nello stesso giorno, mai sotto 0;
  - `consumptionRate`: 30 giorni, giorni registrati dalla prima volta che è stato mangiato, mediana del giorno tipico; `isReliable` (≥ 3 giorni);
  - `forecast` (finito / entro 2 / entro 7 giorni), `suggestedPackages`, `monthlyUse` (30 giorni, costo come nel diario).
- `shared/shopping.ts` `applyPurchases`: uno scontrino nuovo scala la lista (stesso prodotto, poi stesso gruppo; il resto passa alla voce successiva).
- Migrazione `0006_shopping_list` (solo una tabella nuova, con CHECK; cascade sull'eliminazione del prodotto).
- API: `GET/POST /api/shopping-list` (stesso prodotto → confezioni sommate; massimo 500 voci), `PATCH/DELETE /api/shopping-list/:id`, `GET /api/pantry?costMode&windowDays`. `POST /api/receipts` aggiorna la lista nello stesso batch; l'unione di prodotti sposta e accorpa le voci.
- UI: scheda "Lista" (6 schede: larghezza in base all'etichetta, verificato a 360 px), viste "Lista" (Da comprare, aggiunta di prodotti o testo libero, Suggeriti per urgenza con confezioni modificabili, ✓ per togliere) e "Scorte e consumi".
- Verifica sui dati reali (sola lettura): yogurt 1 kg − 4 × 200 g = 200 g, finisce domani; chia 90 g e avena 300 g, 6 giorni; tonno 224 g in 5 giorni = 44,8 g/giorno. Gli stessi valori sono nei test unitari.
- Test: `test/shared/pantry.test.ts` (19), `test/shared/shopping.test.ts` (6), `test/routes/shopping.test.ts` (17), `e2e/shopping.spec.ts` (suggerito → aggiunto → scontrino → esce; consumi 6 al mese e 26,40 €; etichette della barra a 360 px). Mutazioni (scorta negativa, giorni registrati dall'inizio della finestra, gruppo ignorato) rilevate.
- `security-auditor`: SECURE, due LOW: tetto di 500 voci aggiunto; commento sulla lettura prima del batch corretto (utente singolo, accettato).
- `phase-reviewer`: "non completa" per il tonno finito con meno di 3 giorni di diario, che non veniva suggerito. Corretto (scorta 0 → "finito" sempre). Corretti anche: unione di due prodotti entrambi in lista (una voce sola), etichette tagliate a 360 px. Aggiunti test: `costMode=last`, prodotto senza confezione, eliminazione a cascata.
- Scala `verify` verde: 465 test, 54 e2e, build, segreti, config, migrazioni.
- In produzione dal 2026-10-03, con l'ok dell'utente: backup `backups/d1-2026-10-03-pre-0006.sql`, migrazione applicata (tabella vuota, dati invariati), fast-forward di `main` a `fa0e13f`, deploy, smoke test (`/lista`, `/api/shopping-list`, `/api/pantry`, POST/DELETE) → 302.

## Navigazione riorganizzata e correzione della scorta (branch `ui-reorg`)

Richiesta dell'utente ("c'è tanto disordine"); dettagli e scelte in PLAN Fase 7.
- Barra: Diario, Spesa (`/spesa` lista, `/spesa/scontrini`), Statistiche (+ vista Consumi), Altro (`/altro`: Prodotti, Negozi, icona Account). `/`, `/lista`, `/account` reindirizzano. Prodotti e Negozi hanno "indietro" verso Altro.
- Scheda prodotto: `PackageSummary` (confezione, prezzo a confezione, €/kg, ultimo acquisto) e `StockSection` (scorta, correzione, frequenza e consumi) in `src/components/ProductOverview.tsx`, poi prezzi, porzioni, dati.
- Elenco prodotti: scorta per prodotto, etichetta "Finito" (`.badge.finished`, token `--finished`/`--finished-soft`).
- Testi di scorte e consumi in `src/pantryText.ts` (usati da lista, elenco, scheda prodotto e Consumi).
- Correzione della scorta: migrazione `0007_stock_adjustments` (tabella nuova), `POST /api/pantry/:id/stock` (ne resta solo l'ultima), `estimateStock` riparte dalla correzione (stesso giorno: conta ciò che è registrato dopo, via `created_at`). `/api/pantry` copre anche i prodotti con una correzione; `rate` ora è un oggetto (con `eatenDays`) o `null`.
- Errori miei corretti durante il lavoro: Prettier (non usato nel progetto) aveva riformattato `StatsPage.tsx`, ripristinato; D1 locale senza la 0007 → e2e falliti, migrazione locale applicata.
- Test: 475 Vitest (correzioni: stesso giorno prima/dopo, senza acquisti, ultima vince, prodotto finito suggerito, 400/404, cascade), 54 e2e (navigazione e redirect, account solo in Altro, Spesa → Consumi → scheda prodotto → correzione → "Finito" nell'elenco). Mutazione sulla regola dello stesso giorno: rilevata.
- `security-auditor`: SECURE, due LOW: storico delle correzioni (ora si tiene solo l'ultima) e migrazione da applicare con l'ok dell'utente.
- In produzione dal 2026-10-03, con l'ok dell'utente: backup `backups/d1-2026-10-03-pre-0007.sql`, migrazione applicata (tabella vuota, dati invariati), fast-forward di `main` a `e9ffca7`, deploy, smoke test (`/`, `/diario`, `/spesa`, `/spesa/scontrini`, `/altro`, `/api/pantry`, POST stock) → 302.
- Prossimo passo chiesto dall'utente: rivedere la UI della sezione Diario.

## Pezzi, scorte nell'elenco, consumi nelle statistiche (branch `fixes-pieces-ui`)

Richieste dell'utente dopo la riorganizzazione.
- Causa dei pezzi non contati: nessun prodotto aveva il "Peso medio a pezzo"; l'utente aveva messo il peso nella porzione "Pezzo" (banane 120, zucchine 150, uova 65, nettarine 145). Migrazione `0008_piece_weight` (solo dati): copia il peso dalla porzione "Pezzo" al prodotto e crea "Pezzo" dove c'è il peso. Provata su una copia dei dati di produzione: 4 prodotti aggiornati, 31 porzioni invariate.
- `syncDefaultPortions` (Confezione e Pezzo) e `pieceWeightFromPortion` (una porzione "Pezzo" imposta il peso) in `worker/routes/products.ts`.
- `/api/pantry` copre anche tutti i prodotti comprati (fagioli non ancora mangiati: 480 g); nuovi campi `avgPieceAmount`, `lastPurchase`.
- `shared/pantry-text.ts`: `leftText` (pezzi per i prodotti a pezzi, grammi per i confezionati), `lastPriceText` (a confezione, a pezzo o al kg), `stockText`; test in `test/ui/pantry-text.test.ts`.
- UI: elenco prodotti con prezzo e scorta; pulsanti fluttuanti negli scontrini (icona SVG della fotocamera); vista Consumi tolta, dati in Statistiche → Spesa; regola CSS per lo spazio tra campi, elenchi e pulsanti consecutivi; suggerimento del campo "Peso medio a pezzo".
- Problemi dell'ambiente trovati: il dev server aveva il Worker fermo a una versione vecchia (un ricaricamento fallito durante i mutation test) → riavviato; lo screenshot a pagina intera dell'elenco prodotti falliva perché il D1 locale contiene migliaia di prodotti degli e2e; con "Tutto" le statistiche falliscono durante la suite perché altri spec scrivono scontrini dal 1902 (periodo troppo lungo) → lo spec usa "30 giorni".
- Test: 484 Vitest, 54 e2e. Mutazione (porzione "Pezzo" che non imposta il peso) rilevata.

## Tutte le fasi del piano sono in produzione. Ancora aperto
1. Più scontrini reali per l'eval (obiettivo 5–10: catene diverse, sconti, prodotti a peso, righe "2 X").
2. Workers AI come riserva della scansione: rimandato (PLAN §5).
3. Facoltativo: il bundle principale supera i 500 kB (warning di Vite); si può dividere per pagina con `lazy` nelle route.

## Note operative

- La chiave Gemini è stata rigenerata dall'utente (2026-10-03) e si trova in `.dev.vars`.
- Il dev server si avvia con `docker compose exec -d dev sh -c 'npm run db:migrate:local && npm run dev'` → http://localhost:5173.
- Foto degli scontrini dell'utente: `fixtures/receipts/<nome>/image.jpg` + `expected.json` (gitignored: il repo è pubblico; versionarli solo se l'utente lo decide).
