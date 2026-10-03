# Tracchino — Piano di progetto

Webapp personale (un solo utente) per registrare la spesa, i valori nutrizionali dei prodotti e un diario alimentare, e per analizzare quanto costa mangiare in un certo modo.

Ultimo aggiornamento: 2026-10-03

---

## 1. Decisioni prese

| Tema | Decisione |
|---|---|
| Hosting | Cloudflare Workers con Static Assets: un unico Worker serve la SPA e `/api/*` |
| Frontend | React + TypeScript + Vite, PWA installabile (senza modalità offline) |
| API | Hono sul Worker, validazione con Zod |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM, migrazioni versionate |
| Autenticazione | Cloudflare Access (Zero Trust Free) con login Google, ammessa solo la mia email (configurata come secret, non nel repo pubblico) |
| Connessione | Sempre online, nessuna sincronizzazione offline |
| Storico Google Sheet | Non si importa, si parte da zero |
| Inserimento spesa | Per scontrino: negozio + data, poi le righe |
| Nutrizione | Barcode → Open Food Facts, oppure inserimento manuale (per 100 g / 100 ml) |
| Diario | In grammi oppure con porzioni salvate per prodotto |
| Scansione scontrino | Modello AI vision (Gemini come principale, Workers AI come riserva) + dizionario di alias per catena |
| Costi | 0 € (vedi §7) |

---

## 2. Sicurezza e accesso

Obiettivo: con "Ispeziona elemento" non si deve poter leggere nessun dato e non deve comparire nessuna credenziale.

1. **Cloudflare Access davanti a tutto il dominio**, `/api/*` compreso. Senza login non viene servito nemmeno l'HTML. Policy: `Allow → Emails → <mia email>`, Identity Provider Google. Sessione lunga (es. 1 mese) per non dover rifare il login dal telefono.
2. **Controllo anche nel Worker (difesa in profondità)**: un middleware Hono verifica l'header `Cf-Access-Jwt-Assertion` con `jose`:
   - firma tramite JWKS `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
   - `aud` uguale all'Application AUD tag
   - `email` uguale a quella ammessa
   Se uno di questi controlli fallisce, risponde `401`. Così le API restano chiuse anche se Access fosse configurato male.
3. **Nessun segreto nel frontend**: la chiave Gemini e il resto stanno in `wrangler secret`. Il bundle JS contiene solo codice UI.
4. **Dominio**: `tracchino.<account>.workers.dev`, coperto interamente da un'applicazione Access (Access supporta i domini `workers.dev`). I preview URL delle versioni vanno disattivati (`preview_urls = false`), così non esistono indirizzi alternativi scoperti.
5. **Foto su R2**: bucket privato, senza accesso pubblico né `r2.dev`; le foto si leggono solo tramite API autenticata.
6. **Niente CORS**: frontend e API sono sullo stesso origin.
7. **Sviluppo locale**: `wrangler dev` con una variabile `DEV_AUTH_BYPASS=true`, che vale **solo** in locale (assente in `wrangler.toml` di produzione).
8. **Backup**: D1 Time Travel (ripristino a un punto nel tempo) + export manuale `wrangler d1 export` + un endpoint `/api/export` (CSV/JSON).

> Nota: per attivare Zero Trust Free, Cloudflare può chiedere un metodo di pagamento anche se il piano è gratuito. Lo verifichiamo durante il setup.

---

## 3. Modello dati (bozza)

Importi in **centesimi (interi)**, quantità in **grammi / millilitri (interi)**, date ISO `YYYY-MM-DD`.

```
chains            id, name                                   -- Esselunga, Coop, Lidl…
stores            id, chain_id, name, address?, vat_number?  -- singolo punto vendita
product_groups    id, name                                   -- "Banane" (raggruppa marche diverse)
products          id, group_id?, name, brand?, barcode? UNIQUE,
                  unit ('g'|'ml'|'pz'),
                  package_amount?        -- g/ml per confezione (es. pasta 500)
                  avg_piece_amount?      -- g medi per pezzo (es. banana 120)
                  kcal_100, protein_100, fat_100, carbs_100, sugars_100  (nullable)
                  nutrition_source ('off'|'manual')?, created_at
product_aliases   id, chain_id, raw_text_norm, product_id, confirmations, last_seen
                  UNIQUE(chain_id, raw_text_norm)
receipts          id, store_id, date, total_printed_cents?, source ('manual'|'scan'), photo_key?, notes?
receipt_items     id, receipt_id, product_id, raw_text?,
                  pieces?, amount?            -- n° pezzi e/o g/ml totali (li inserisci tu)
                  price_full_cents, discount_cents DEFAULT 0,
                  price_paid_cents            -- = full - discount
portions          id, product_id, name, amount   -- "1 banana" = 120 g
diary_entries     id, date, meal ('colazione'|'pranzo'|'cena'|'snack'),
                  product_id, amount, portion_id?, portion_qty?
```

Valori derivati, calcolati dalle query e non salvati:
- **€/kg (o €/l)** = `price_paid / amount`. **€/pezzo** = `price_paid / pieces`.
- Quantità della riga (`shared/pricing.ts`, fissata dai test):
  - `amount` inserito → **misurata**;
  - `pieces` × `package_amount` → **confezione**: è esatta, non stimata (2 × pasta 500 g = 1 kg);
  - `package_amount` senza `pieces` → si assume 1 confezione ed è **stimata** (nella UI "≈"): se ne hai comprate 2 e non lo scrivi, il €/kg risulta dimezzato;
  - `pieces` × `avg_piece_amount` → **stimata** (6 banane × ~120 g);
  - altrimenti la quantità è sconosciuta (`null`, mai 0).
  - Con `package_amount` e `avg_piece_amount` entrambi presenti vince la confezione.
  - Le aggregazioni (Fase 2) partono da prezzo pagato e quantità grezzi, non dai €/kg già arrotondati.
- **Costo per grammo di un prodotto** (per il diario): media ponderata degli acquisti degli ultimi N giorni, con l'ultimo prezzo pagato come alternativa (impostabile).

Aliases per **catena** e non per singolo negozio: lo stesso Esselunga in due città stampa le stesse abbreviazioni.

---

## 4. Funzionalità per fase

### Fase 0 — Setup e accesso
- Repo, Vite + React + TS, Hono, Drizzle, `wrangler.toml` con binding D1.
- Prima migrazione dello schema.
- Configurazione Access + middleware JWT, deploy, verifica dal telefono e dal PC.
- Pagina "chi sono" che mostra l'email autenticata (test end-to-end dell'autenticazione).
- **Fatto quando**: da una finestra in incognito senza login non si ottiene nulla né dalla pagina né da `/api/*`.

### Fase 1 — Spesa manuale
- Gestione catene, negozi e prodotti (crea, modifica, unisci duplicati).
- Nuovo scontrino: negozio + data, poi righe con **autocomplete del prodotto** (ricerca fuzzy), prezzo, sconto, pezzi e quantità.
- Creazione di un nuovo prodotto direttamente dalla riga.
- Il totale si aggiorna man mano. Elenco degli scontrini con modifica ed eliminazione.
- UI pensata prima per il telefono (tastiera numerica, target grandi), usabile anche da desktop.
- Decisioni (2026-10-02):
  - "Unisci duplicati" vale per i **prodotti** (unità diverse non si uniscono). Catene e negozi hanno nomi univoci e si rinominano; per spostare uno scontrino su un altro negozio lo si modifica. L'unione di negozi verrà aggiunta solo se serve.
  - I gruppi si creano dal form prodotto e si rinominano o eliminano in fondo alla pagina Prodotti.
  - Le righe completamente vuote vengono ignorate. Il totale conta solo le righe complete e segnala quelle escluse.
  - Il prezzo si precompila con l'ultimo pagato in quel negozio (escluso lo scontrino in modifica) **solo per i prodotti confezionati** (`package_amount` impostato). Sfusi (banane a peso) e prodotti a pezzi in confezioni variabili (uova da 6 o da 12) mostrano solo il suggerimento "ultima volta X · €/pz". **Pezzi e quantità non vengono mai precompilati né memorizzati sul prodotto.**
  - Uova e simili sono un solo prodotto "a pezzi": nella riga si indica il numero di uova (6, 12, o 12 per 2×6), e si confronta il prezzo per uovo.
  - Sicurezza: le scritture sono accettate solo dalla stessa origine (`Sec-Fetch-Site`/`Origin`), solo con `Content-Type: application/json`, fino a 256 KB.
- **Verifiche**: test sul calcolo di `price_paid`, €/kg ed €/pezzo (compresi i casi con quantità mancanti o stimate); test delle route CRUD (input non valido → 400); un e2e "crea uno scontrino con 3 righe → compare nell'elenco con il totale giusto".

### Fase 2 — Statistiche spesa (le stesse del foglio Google)
- Spesa per giorno e per settimana (ISO, lunedì–domenica), con grafici.
- Media e mediana giornaliera e settimanale, totale dello storico, calcolate su **tutti i giorni (e tutte le settimane) del periodo**, compresi quelli senza spesa (valore 0). Il periodo predefinito va dal primo scontrino a oggi, ed è filtrabile. Le mediane si calcolano in TS nel Worker (SQLite non ha `MEDIAN`; i volumi sono piccoli).
- Per prodotto o gruppo: andamento del €/kg nel tempo e **confronto tra negozi** (dove conviene comprare le banane).
- Frequenza di acquisto per prodotto.
- Decisioni (2026-10-02):
  - Media e mediana **settimanali su tutte le settimane** del periodo, comprese quelle parziali all'inizio e alla fine (scelta confermata). Nel grafico le settimane parziali sono attenuate, solo come promemoria visivo.
  - Confronto tra negozi: Σ pagato / Σ quantità (ponderato), su **una sola metrica**, cioè l'unità prevalente degli acquisti (€/kg, €/l o €/pz). €/kg ed €/l non si mescolano mai; "≈" segnala le quantità stimate.
  - Grafico del prezzo nel tempo: al massimo 3 negozi (la palette è validata per 3), sempre incluso il più conveniente.
  - Grafico giornaliero solo per periodi fino a 3 mesi; il grafico settimanale c'è sempre.
- **Verifiche**: dataset di fixture con risultati calcolati a mano (media e mediana con numero di giorni pari e dispari, settimane a cavallo di mese e anno, giorni senza spesa); test di confronto tra negozi con quantità stimate.

### Fase 3 — Scansione scontrino con AI (dettaglio in §5)
- Foto → estrazione → abbinamento con gli alias → schermata di revisione obbligatoria → salvataggio.
- **Verifiche**: test unitari di normalizzazione e fuzzy match; test della pipeline con il provider AI mockato; **eval** su scontrini reali in `fixtures/receipts/` (immagine + JSON atteso) con metriche di accuratezza su negozio, data, prezzi e righe abbinate (skill `receipt-eval`); test "la seconda scansione dello stesso scontrino abbina tutto con gli alias"; test R2 (la foto si salva solo alla conferma, eliminare lo scontrino la elimina, `/api/receipts/:id/photo` senza autenticazione → 401); test che la compressione resti sotto i 300 KB.

### Fase 4 — Nutrizione e barcode
- Scansione barcode dalla fotocamera: `BarcodeDetector` nativo, con `@zxing/browser` come fallback (Safari iOS).
- Proxy `/api/off/:barcode` verso Open Food Facts: nome, marca, valori per 100 g, salvati come precompilazione da confermare.
- Inserimento manuale dei valori per i prodotti sfusi.
- Decisioni (2026-10-03):
  - Il barcode si valida con la cifra di controllo (EAN-8/13, UPC-A/E, GTIN-14) sia nel form sia nell'API.
  - Un codice già nel catalogo apre quel prodotto (o lo usa nella riga dello scontrino) senza interrogare OFF.
  - I dati OFF riempiono solo i campi vuoti; i valori nutrizionali si sostituiscono solo su richiesta esplicita.
  - `nutrition_source = 'off'` finché i valori importati restano invariati; una modifica a mano → `manual`.
  - Gli avvisi di plausibilità sono informativi e non bloccano il salvataggio: le etichette possono essere strane (fibre, polioli). Tolleranza kcal: 20% o 20 kcal.
  - zxing si carica solo quando la fotocamera si apre su un browser senza `BarcodeDetector`.
- **Verifiche**: test del mapping da risposta OFF a prodotto (con campi mancanti, valori in kJ, unità ml); controllo di plausibilità dei valori (macro per 100 g ≤ 100 g; kcal ≈ 4·P + 9·G + 4·C con tolleranza → avviso).

### Fase 5 — Diario alimentare
- Inserimento per pasto: prodotto (autocomplete, prima i più frequenti e recenti), poi grammi **oppure** porzione × quantità.
- Gestione delle porzioni salvate per prodotto.
- Riepilogo giornaliero: kcal, proteine, grassi, carboidrati, zuccheri e **costo stimato** della giornata.
- Decisioni (2026-10-03):
  - Costo per grammo dagli scontrini: Σ pagato / Σ quantità (quantità come in `shared/pricing.ts`, stime comprese, segnalate con "≈") sugli acquisti degli **N giorni prima del giorno del diario** (N = 90 predefinito; 30/90/180/365 dalla pagina). Se non ce ne sono, l'ultimo prezzo fino a quel giorno (o il primo acquisto, per giorni precedenti). In alternativa si sceglie "ultimo prezzo". Le preferenze sono salvate nel browser (nessuna migrazione).
  - Il costo del giorno è la somma dei costi delle voci, ognuno arrotondato al centesimo (coincide con l'elenco a schermo).
  - Gli acquisti senza quantità nota non danno un costo per grammo; prodotto mai comprato → "n.d.".
  - Totali: somma dei valori noti con "≥" e il numero di voci senza dato; tutto ignoto → "n.d." (mai 0).
  - Porzione × quantità si salva come grammi (`amount`) più il riferimento alla porzione: modificare o eliminare la porzione non cambia lo storico.
  - Autocomplete: prima i prodotti mangiati più spesso negli ultimi 90 giorni, poi quelli comprati più spesso.
  - Barra in basso: Scontrini, Diario, Statistiche, Prodotti, Altro (Negozi e Account).
- **Verifiche**: test del calcolo dei macro (grammi e porzioni) e del costo per grammo (media ponderata e ultimo prezzo, prodotto mai acquistato → costo "n.d." e non 0).

### Fase 6 — Analisi e simulazioni
- Frequenza di consumo vs frequenza di acquisto per prodotto.
- Costo medio giornaliero e settimanale della dieta, costo per 100 kcal e per 10 g di proteine di ogni prodotto.
- **Simulazione**: "se sostituisco A con B (o cambio le quantità) nel periodo X" → differenza di costo e di macro.
- Decisioni (2026-10-03):
  - In Statistiche, vista "Dieta" accanto a "Spesa", con gli stessi periodi (predefinito: dal primo giorno del diario a oggi).
  - Le medie della dieta contano **solo i giorni registrati**: un giorno senza diario non è un giorno a costo 0 (diverso dalla spesa, dove i giorni senza scontrini valgono 0). A settimana = 7 × media giornaliera, indicata come stima.
  - Costi come nel diario (stessa modalità e finestra); le voci senza costo sono escluse e contate.
  - Costo per 100 kcal e per 10 g di proteine di ogni prodotto, al costo dell'ultimo giorno del periodo, non arrotondato al centesimo (sotto i 10 cent si mostrano 3 decimali). Il costo per 100 kcal della dieta usa solo le voci che hanno sia costo sia kcal.
  - La simulazione rifiuta prodotti in grammi contro prodotti in millilitri; un fattore piccolo lascia almeno 1 g.
  - Consumo e acquisti nello stesso periodo: grammi mangiati (e in quanti giorni) e grammi comprati ("≥" se alcune righe non hanno quantità, "≈" se stimate).
  - Simulazione: sostituire A con B (oppure A con A) moltiplicando i grammi per un fattore (0–10]. La differenza si calcola solo sulle voci toccate; è "n.d." se una di esse non ha il dato. Viene mostrata anche la media per giorno registrato.
- **Verifiche**: test della simulazione su un diario di fixture (sostituire A con A dà differenza 0; i risultati coincidono con il calcolo a mano).

---

## 5. Scansione scontrino — progetto dettagliato

### Flusso
1. **Foto**: `<input type="file" accept="image/*" capture="environment">`. Il client ridimensiona l'immagine (lato lungo circa 2000 px, JPEG ~0.8) prima dell'upload.
2. **`POST /api/receipts/scan`**: il Worker invia l'immagine al modello vision con **output strutturato (JSON schema)**:
   ```
   { store: { name, address?, vat_number? }, date, total?,
     lines: [{ raw_text, price, qty_hint?, weight_hint?, unit_price_hint?,
               discount?: { raw_text, amount } }] }
   ```
   I pezzi stampati nel testo della riga (es. "UOVA FRESCHE 6P") li estrae l'AI come `qty_hint` a ogni scansione: non vengono salvati nell'alias, perché lo stesso prodotto può comparire con confezioni diverse.
   Il prompt chiede di agganciare le righe di sconto ("SCONTO", "-0,50", "PROMO") alla riga del prodotto a cui si riferiscono, e di riportare quantità o peso **solo se stampati**.
3. **Riconoscimento del negozio**: prima per P.IVA (affidabile), poi per somiglianza su nome e indirizzo. Se il negozio non esiste ancora lo crei in revisione.
4. **Abbinamento delle righe** (vedi sotto).
5. **Schermata di revisione** già compilata (obbligatoria, niente salvataggio automatico):
   - 🟢 abbinamento da alias, 🟡 proposta (fuzzy/AI) da confermare, 🔴 nessuna proposta o nuovo prodotto.
   - Per ogni riga puoi cambiare il prodotto, correggere prezzo e sconto e aggiungere pezzi o peso.
   - **Controllo di coerenza**: la somma delle righe meno gli sconti viene confrontata con il totale stampato; se non coincidono compare un avviso.
6. **Salvataggio**: scontrino + righe; per ogni riga confermata si crea o aggiorna l'alias `(chain_id, raw_text_norm) → product_id` (con `confirmations++`).

### Abbinamento abbreviazioni → prodotti
`raw_text_norm` = maiuscolo, spazi compressi, punteggiatura normalizzata, codici IVA o reparto finali rimossi.

1. **Alias esatto** sulla catena → 🟢 automatico.
2. **Similarità testuale** (trigrammi / Jaro-Winkler) contro nomi prodotto, alias della stessa catena e alias di altre catene → top 5 candidati con punteggio.
3. **Secondo giro AI (solo testo, economico)**: per le righe non 🟢 si inviano `raw_text`, catena e i candidati. Il modello sceglie un candidato o "nuovo prodotto" (con un nome proposto) e indica una confidenza.
4. Colore finale: punteggio alto e accordo tra fuzzy e AI → 🟡 preselezionato; disaccordo o punteggio basso → 🔴.

### Provider AI
Interfaccia `ReceiptExtractor` con due implementazioni intercambiabili:

| | Gemini API (principale) | Workers AI (riserva) |
|---|---|---|
| Modello | Gemini Flash / Flash-Lite (versione corrente) | `llama-4-scout-17b-16e-instruct` o `mistral-small-3.1-24b-instruct` |
| Free tier | Flash-Lite ~500 richieste/giorno, Flash ~20/giorno (set. 2026) | 10.000 neuroni/giorno; uno scontrino costa nell'ordine delle decine o centinaia di neuroni |
| Note | OCR migliore, output JSON strutturato nativo. I dati gratuiti possono essere usati da Google per migliorare i modelli (accettato) | Nessuna chiave esterna, ma qualità OCR su scontrini italiani da verificare |

Il tuo consumo: 3 scontrini al giorno × 2 chiamate = circa 6 richieste al giorno, entro i limiti di entrambi. Il nome del modello sta in configurazione (`AI_PROVIDER`, `GEMINI_MODEL`), perché i nomi cambiano spesso. Nel Worker c'è anche un limite di sicurezza (es. 30 scansioni al giorno).

**Decisione (2026-10-03)**: Workers AI come riserva è **rimandato**. Gemini Flash-Lite ha estratto e abbinato al 100% i primi scontrini reali, il client riprova una volta su 500/503 e la quota è circa 80 volte l'uso previsto. L'interfaccia `ReceiptAi` resta pronta: la riserva si aggiunge se compaiono indisponibilità ripetute o problemi di quota.

**Da verificare in Fase 3**: limiti effettivi del free tier in AI Studio per l'account e la regione (Italia), e un confronto di qualità tra i due provider su 5–10 scontrini reali di negozi diversi.

### Foto dello scontrino — compressa e salvata su R2
- **Compressione nel client, prima dell'upload**: lato lungo circa 2000 px, scala di grigi, WebP (fallback JPEG) con qualità ~0.7. Obiettivo: ≤ 300 KB a foto. **La stessa immagine** va all'AI e su R2, così ciò che salvi corrisponde a ciò che il modello ha letto. La risoluzione si tara con `receipt-eval`: la si riduce finché l'accuratezza non cala.
- **Storage**: bucket R2 **privato** (nessun dominio pubblico, nessun `r2.dev`), binding `RECEIPT_PHOTOS`. Chiave `receipts/<receipt_id>.webp`. La foto si carica solo al salvataggio dello scontrino confermato: le scansioni abbandonate non lasciano file orfani.
- **Accesso**: solo tramite `GET /api/receipts/:id/photo`, dietro il middleware di autenticazione. Nella schermata di revisione e nel dettaglio dello scontrino la foto si vede accanto alle righe.
- **Eliminazione**: cancellare lo scontrino cancella anche la foto.
- **Spazio**: 3 foto al giorno × 300 KB ≈ 330 MB all'anno, contro i 10 GB gratuiti di R2.
- Schema: `receipts.photo_key?`.

---

## 6. Struttura del repository

```
/src              frontend React (routes, components, hooks, api client)
/worker           Hono app: routes/, middleware/auth.ts, services/ (stats, matching, ai/)
/db               schema Drizzle + migrations/
/shared           tipi e schemi Zod condivisi tra frontend e Worker
wrangler.toml
```

Livelli di verifica (dettagli in `CLAUDE.md` e nella skill `verify`):
1. `tsc --noEmit` (strict) + ESLint
2. Vitest per la logica pura (normalizzazione, fuzzy match, statistiche, calcolo costi)
3. Vitest + `@cloudflare/vitest-pool-workers` per le route, su un D1 locale reale con le migrazioni applicate; compresi i **test di autenticazione** (JWT assente, firma errata, `aud` errato, email diversa → 401)
4. Playwright e2e sui flussi principali, viewport mobile e desktop
5. Build di produzione + controllo che nel bundle non ci siano segreti
6. Dopo il deploy: smoke test di `/api/*` senza login → deve rispondere 401/302

---

## 7. Costi (tutto sul piano gratuito)

| Servizio | Limite free | Uso previsto |
|---|---|---|
| Workers | 100k richieste/giorno | poche centinaia |
| D1 | 5 GB, 5M letture/giorno, 100k scritture/giorno | MB, poche migliaia |
| Access (Zero Trust Free) | 50 utenti | 1 |
| Gemini API free | ~20–500 richieste/giorno a seconda del modello | ~6 |
| Workers AI | 10k neuroni/giorno | riserva |
| Open Food Facts | gratuito (rispettare il rate limit, User-Agent identificativo) | pochi |
| R2 (foto scontrini) | 10 GB, 1M scritture e 10M letture al mese | ~330 MB/anno |
| Dominio | `*.workers.dev` protetto da Access | — |

---

## 8. Decisioni sui punti aperti (2026-10-02)

1. **Media e mediana**: calcolate su tutti i giorni e tutte le settimane del periodo, compresi quelli a 0.
2. **Dominio**: `*.workers.dev` + Access.
3. **Gruppi di prodotto**: sì, facoltativi. Statistiche per prodotto e per gruppo.
4. **Foto degli scontrini**: compresse nel client e salvate su R2 privato (§5).

## 9. Da verificare durante il setup
- Se Zero Trust Free chiede una carta di pagamento.
- Limiti effettivi del free tier Gemini in AI Studio per l'Italia.
- Che Access copra davvero sia la pagina sia `/api/*` su `workers.dev` (test in incognito + `curl`).
