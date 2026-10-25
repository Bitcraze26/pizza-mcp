# pizza-mcp

Server [MCP](https://modelcontextprotocol.io) per calcolare le dosi dell'impasto della pizza con il metodo diretto. A partire da numero e peso dei panetti, idratazione, farine e programma di lievitazione restituisce i grammi di **ogni farina, acqua, sale e lievito**, con le percentuali del fornaio.

Si può usare in due modi, con lo stesso codice e lo stesso tool:

- **in locale via stdio** (Node.js), per Claude Code, Claude Desktop o qualsiasi client MCP;
- **su Cloudflare Workers** come endpoint MCP remoto Streamable HTTP, senza server da mantenere.

## Cosa fa

- Calcola il peso totale dell'impasto dai panetti (`panetti × peso`).
- Usa le percentuali del fornaio: la **farina totale è 100%**, mentre acqua, sale e lievito sono percentuali sul peso della farina.
- Gestisce **una o più farine** con le rispettive percentuali (se la somma non è 100, normalizza automaticamente).
- Stima il **lievito** in base a ore e temperatura, anche con una parte di lievitazione in frigorifero.
- Supporta lievito **fresco**, **secco attivo** e **istantaneo**, con conversione automatica.
- Restituisce sia un riepilogo leggibile in italiano sia un oggetto JSON strutturato.

## Installazione

Richiede Node.js 18 o superiore.

```bash
npm install
npm run build
```

## Configurazione in locale (stdio)

Registra il server con il percorso assoluto di `dist/index.js` (sostituisci `C:\percorso\pizza-mcp` con la cartella in cui hai clonato il progetto):

```bash
claude mcp add pizza-mcp -- node "C:\percorso\pizza-mcp\dist\index.js"
```

Per renderlo disponibile in tutti i progetti aggiungi `--scope user`:

```bash
claude mcp add --scope user pizza-mcp -- node "C:\percorso\pizza-mcp\dist\index.js"
```

In alternativa, aggiungi al file `.mcp.json` del progetto:

```json
{
  "mcpServers": {
    "pizza-mcp": {
      "command": "node",
      "args": [
        "C:\\percorso\\pizza-mcp\\dist\\index.js"
      ]
    }
  }
}
```

Se il client non avvia il server su Windows, prova la variante con `cmd`:

```bash
claude mcp add pizza-mcp -- cmd /c node "C:\percorso\pizza-mcp\dist\index.js"
```

## Deploy su Cloudflare Workers

Il Worker espone un endpoint MCP **Streamable HTTP stateless** su `/mcp`: ogni richiesta crea un server e un trasporto nuovi, quindi non servono Durable Objects né sessioni. Il tool è puro e non conserva stato.

1. Accedi a Cloudflare (una volta sola):

   ```bash
   npx wrangler login
   ```

2. Prova il Worker in locale:

   ```bash
   npm run dev:worker
   ```

   Il server risponde su `http://localhost:8788` (`/health` per lo stato, `/mcp` per MCP).

3. Pubblica:

   ```bash
   npm run deploy
   ```

   Wrangler stampa l'URL pubblico, del tipo `https://pizza-mcp.<sottodominio>.workers.dev`.

4. Collega l'endpoint remoto a Claude Code:

   ```bash
   claude mcp add --transport http pizza-mcp https://pizza-mcp.<sottodominio>.workers.dev/mcp
   ```

L'endpoint è pubblico e senza autenticazione: chiunque conosca l'URL può chiamare il tool di calcolo. Se ti serve, puoi aggiungere un controllo su `Authorization` nel `fetch` di `src/worker.ts` o proteggere l'endpoint con Cloudflare Access.

Per cambiare nome del Worker, porta o compatibility date modifica `wrangler.jsonc`.

## Tool: `calculate_dough`

### Parametri

| Parametro | Tipo | Default | Descrizione |
|---|---|---|---|
| `balls` | intero ≥ 1 | obbligatorio | Numero di panetti |
| `ball_weight_g` | numero > 0 | obbligatorio | Peso di ogni panetto in grammi |
| `hydration_percent` | 30–120 | `62` | Idratazione in % sulla farina |
| `salt_percent` | 0–10 | `2.5` | Sale in % sulla farina |
| `flours` | array | una farina al 100% | Elenco `{ name, percent }`; le percentuali sono sul totale farina |
| `yeast_type` | `fresh` \| `dry` \| `instant` | `fresh` | Tipo di lievito |
| `yeast_percent` | 0–10 | — | Se indicato, forza la % di lievito (del tipo scelto) e ignora il modello tempo/temperatura |
| `room_hours` | 0–240 | `24` (0 se usi solo il frigo) | Ore a temperatura ambiente |
| `room_temperature_c` | −5–45 | `20` | Temperatura ambiente in °C |
| `fridge_hours` | 0–360 | `0` | Ore in frigorifero |
| `fridge_temperature_c` | −5–15 | `4` | Temperatura del frigo in °C |

Per una lievitazione solo in frigo indica `fridge_hours` e lascia `room_hours: 0` (o aggiungi 1–2 ore a temperatura ambiente per l'appretto).

### Esempio

> Calcola l'impasto per 6 panetti da 250 g, 62% di idratazione, 70% Tipo 00 e 30% farina integrale, 22 ore in frigo a 4 °C più 2 ore a 20 °C, con lievito fresco.

Il server restituisce (estratto):

| Ingrediente | Grammi | % sulla farina |
|---|---:|---:|
| Farina (totale) | 909,7 | 100% |
| ↳ Tipo 00 W300 | 636,8 | 70% |
| ↳ Farina integrale | 272,9 | 30% |
| Acqua | 564 | 62% |
| Sale | 22,7 | 2,5% |
| Lievito di birra fresco | 3,54 | 0,39% |

Totale impasto: 1500 g (6 × 250 g). Lievitazione: 22 h a 4 °C + 2 h a 20 °C ≈ 9,3 h equivalenti a 20 °C.

### Output

Il tool restituisce due contenuti testuali: un riepilogo Markdown in italiano e il risultato completo in JSON. Il JSON include anche:

- `targetDoughGrams` e `doughGrams` (verifica del peso totale);
- percentuali del fornaio e grammi per ogni farina;
- `yeast.source` (`model` oppure `override`), grammi e percentuale di lievito, equivalente in lievito fresco;
- `fermentation.effectiveHoursAt20C`, `averageTemperatureFactor` e `modelClamped`;
- `warnings` con avvisi su idratazione, sale, appretto, fermentazioni estreme e lievito da pesare con precisione.

## Modello di calcolo

### Percentuali e peso

Con farina totale = 100%:

```
peso_impasto = panetti × peso_panetto
farina = peso_impasto / (1 + idratazione/100 + sale/100 + lievito/100)
acqua  = farina × idratazione/100
sale   = farina × sale/100
lievito = farina × lievito/100
```

Dividendo il peso dell'impasto per la somma delle percentuali (incluso il lievito) si ottiene una ricetta che torna esattamente al peso dei panetti desiderato.

### Stima del lievito

Il modello normalizza l'attività del lievito a 20 °C con un fattore Q10 = 2: ogni 10 °C in più raddoppia la velocità di fermentazione, ogni 10 °C in meno la dimezza.

```
ore_equivalenti = Σ (ore_i × 2^((T_i − 20)/10))
lievito_fresco_% = 3,6 / ore_equivalenti
```

La stima viene limitata tra 0,05% e 4% di lievito fresco; se viene applicato un limite il risultato contiene un avviso.

Valori indicativi:

| Lievitazione | Lievito fresco stimato |
|---|---:|
| 8 h a 20 °C | ~0,45% |
| 24 h a 20 °C | ~0,15% |
| 48 h a 20 °C | ~0,08% |
| 24 h a 4 °C + 2 h a 20 °C | ~0,36% |
| 48 h a 4 °C + 2 h a 20 °C | ~0,20% |
| 72 h a 4 °C + 2 h a 20 °C | ~0,14% |

Conversioni usate:

- 1 g di lievito secco attivo ≈ 2,5 g di lievito fresco;
- 1 g di lievito istantaneo ≈ 3 g di lievito fresco.

### Limiti

- Il modello è una **stima**: usa la temperatura ambiente, non la temperatura reale dell'impasto, e non tiene conto della forza della farina, della temperatura dell'acqua o dell'umidità. Regola il risultato in base alla tua esperienza; puoi forzare la percentuale con `yeast_percent`.
- Il calcolo riguarda il **metodo diretto**. Non è pensato per biga, poolish, lievito madre o altri prefermenti.
- I grammi di lievito molto piccoli richiedono una bilancia con precisione di 0,1 g (il tool lo segnala).

## Sviluppo

```bash
npm test          # test unitari del motore di calcolo
npm run smoke     # test end-to-end del server stdio (richiede npm run build)
npm run dev       # avvia il server stdio da sorgente con tsx
npm run dev:worker # avvia il Worker in locale su http://localhost:8788
npm run smoke:worker # test end-to-end dell'endpoint HTTP (con dev:worker attivo)
npm run typecheck # controllo dei tipi senza generare file
npm run deploy    # pubblica su Cloudflare Workers
```

La logica di calcolo è in `src/calc.ts`, la formattazione del riepilogo in `src/format.ts`, la registrazione del tool in `src/server.ts`, l'entry point stdio in `src/index.ts` e l'entry point Cloudflare in `src/worker.ts`.

## Licenza

MIT
