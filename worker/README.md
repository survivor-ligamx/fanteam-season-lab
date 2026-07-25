# Worker `fanteam-data`

Motor de datos del proyecto: agrega Football-Data, API-Football, GNews y The Odds API y expone un payload JSON que la app consume al abrir y cada 15 minutos.

- **URL:** `https://fanteam-data.brandonleon480.workers.dev/` (cualquier ruta GET devuelve el payload; `/health` devuelve estado ligero)
- **Código:** `src/index.js` (respaldo del Worker desplegado)

## Cómo funciona

- **Sin cron.** La frescura la gobierna el **caché de borde** (`caches.default`): la primera petición tras expirar el TTL reconstruye el payload consultando las 4 fuentes; el resto se sirve desde caché.
- **Fuentes** (todas en paralelo, con captura de errores por fuente en `errors{}`):
  - **API-Football** — lesiones de la temporada y fixtures de los próximos 8 días; si hay partidos a menos de 2 h del kickoff, también alineaciones confirmadas (titular → confianza 95, suplente → 30, lesionado → 5).
  - **Football-Data** — calendario/resultados completos de la PL (los 380 partidos).
  - **The Odds API** — momios h2h y totales (región UK).
  - **GNews** — 10 noticias de lesiones/alineaciones/sanciones.
- **CORS abierto** (`*`), solo GET/OPTIONS.

## Deploy (dos caminos)

**A) Desde el repo con wrangler (recomendado):**

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

**B) Pegar en el dashboard:** Workers & Pages → `fanteam-data` → *Edit code* → reemplazar con el contenido de `src/index.js` → *Save and deploy*.

> Tras cambiar el código, el caché de borde puede seguir sirviendo la respuesta vieja hasta que expire su TTL. El código versiona la clave de caché (`__fanteam_cache_vN`): al subir de versión la clave cambia y el primer request ya reconstruye.

## 🐛 Arreglar los momios (`errors.odds: "HTTP 401"`)

El secret `ODDS_API_KEY` **existe pero la key es inválida o expiró** (si faltara, el error diría `ODDS_API_KEY no configurada`).

1. Consigue/verifica tu key en https://the-odds-api.com/ (plan gratuito: 500 requests/mes — de sobra con el caché actual).
2. Repón el secret:
   - **Con wrangler:** `npx wrangler secret put ODDS_API_KEY`
   - **En el dashboard:** Workers & Pages → fanteam-data → Settings → Variables and Secrets → editar `ODDS_API_KEY` (tipo *Secret*).
3. Espera a que expire el caché (o despliega la v2.1.0, que cambia la clave de caché) y verifica:

```bash
curl -s https://fanteam-data.brandonleon480.workers.dev/latest | \
  python3 -c "import json,sys;d=json.load(sys.stdin);print(d['version'],d['sources'],d['errors'],len(d['odds']))"
# esperado: sources.odds: true · errors.odds: null · odds con eventos
```

Con los momios activos, el siguiente paso en la app es el **capitán por valor esperado** (proyección × probabilidad de victoria/goles).

## Sobre `players[]` vacío

En pretemporada es **comportamiento esperado**: no hay lesiones activas reportadas ni partidos a menos de 2 h (alineaciones). Con la temporada en marcha, `players[]` se puebla solo. La app empareja por nombre exacto o apellido+club (`applyPlayerUpdates`) e ignora lo que no reconoce con seguridad.

## Secrets

| Secret | Fuente | Estado |
|---|---|---|
| `API_FOOTBALL_KEY` | api-football (api-sports.io) | ✅ activa |
| `FOOTBALL_DATA_KEY` | football-data.org | ✅ activa |
| `ODDS_API_KEY` | the-odds-api.com | ⚠️ HTTP 401 — reponer |
| `GNEWS_API_KEY` | gnews.io | ✅ activa |
