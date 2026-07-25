# Worker `fanteam-data`

Motor de datos del proyecto: agrega Football-Data, API-Football, GNews y The Odds API con un cron y expone `GET /latest` (JSON, ~88 KB) que la app consume al abrir y cada 15 minutos.

- **URL:** `https://fanteam-data.brandonleon480.workers.dev/latest`
- **Versión desplegada:** 2.0.0

## ⚠️ Respaldo pendiente

El código del Worker **vive solo en el dashboard de Cloudflare** — un borrado accidental no tiene respaldo. Para versionarlo aquí:

1. Abre el Worker en el dashboard de Cloudflare (**Workers & Pages → fanteam-data → Edit code**).
2. Copia el contenido completo a `worker/src/index.js` en este repo.
3. Ajusta `wrangler.toml` (cron real y nombres de secrets según el código).
4. A partir de entonces, despliega desde el repo:

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

## 🐛 Arreglar los momios (`errors.odds: "HTTP 401"`)

`/latest` reporta hoy `sources.odds: false` y `errors.odds: "HTTP 401"`: la API key de The Odds API es inválida, expiró o no está configurada como secret.

1. Consigue/verifica tu key en https://the-odds-api.com/ (el plan gratuito da 500 requests/mes; con cron cada 6 h sobra).
2. Configúrala como **secret** del Worker (el nombre debe coincidir con el que lee el código, p. ej. `ODDS_API_KEY`):
   - **Con wrangler:** `npx wrangler secret put ODDS_API_KEY`
   - **En el dashboard:** Workers & Pages → fanteam-data → Settings → Variables and Secrets → Add → tipo *Secret*.
3. Redespliega (o guarda) y dispara una actualización (espera el cron o ejecuta el trigger manual si el código expone uno).
4. Verifica:

```bash
curl -s https://fanteam-data.brandonleon480.workers.dev/latest | \
  python3 -c "import json,sys;d=json.load(sys.stdin);print(d['sources'],d['errors'],len(d['odds']))"
# esperado: sources.odds: true · errors.odds: null · odds con elementos
```

Con los momios activos, el siguiente paso en la app es el **capitán por valor esperado** (proyección × probabilidad de victoria/goles).

## 📥 Poblar `players[]` (siguiente mejora de datos)

`players[]` llega vacío, así que la confianza de titularidad nunca se mueve. El Worker ya consulta API-Football (lesiones): hay que mapear esas lesiones/alineaciones a objetos `{name, club, confidence, minutes?, status?}` — la app los empareja de forma segura por id, nombre exacto o apellido+club (`applyPlayerUpdates`) e ignora lo que no reconoce.
