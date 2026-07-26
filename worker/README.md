# Worker `fanteam-data`

Motor de datos del proyecto: agrega Football-Data, API-Football, GNews, The Odds API y el feed público de Fantasy Premier League, y expone un payload JSON que la app consume al abrir y cada 15 minutos.

- **URL:** `https://fanteam-data.brandonleon480.workers.dev/` (cualquier ruta GET devuelve el payload; `/health` devuelve estado ligero)
- **Código:** `src/index.js` (respaldo del Worker desplegado)

## Versiones

- **Versión del código: v2.2.0** — clave de caché `v9`; añade la referencia pública FPL para xG, porterías a cero, puntos, minutos, partidos, selección y balance de transferencias, además de conservar The Odds API para capitanía y CS próxima GW.
- Cambios acumulados sobre la 2.0.0 original:
  1. **Caché adaptativa**: 15 min cuando hay partidos en ventana (kickoff entre −3 h y +4 h) y 3 h el resto de la semana. Sin esto, las alineaciones que el código captura quedaban atrapadas por el caché de 3 h y casi nunca llegaban a la app.
  2. **Lesiones con caducidad**: registros de más de 21 días se descartan (adiós lesionados zombis), `Questionable` → confianza 30 (duda) vs `Missing Fixture` → 5 (baja), y si un jugador tiene varios registros gana el más reciente.
  3. Clave de caché versionada (`__fanteam_cache_vN`): al subirla, el primer request tras el deploy reconstruye el payload sin esperar a que expire el caché viejo.
  4. **Referencia FPL**: consume `bootstrap-static`, normaliza Coventry `COV` → `CVC` y adjunta a `players[]` métricas históricas y transferencias bajo `reference`, sin credenciales y con errores observables en `errors.fpl`.

Prueba local (sin red ni credenciales): `node worker/test/smoke.mjs`

## Cómo funciona

- **Sin cron.** La frescura la gobierna el **caché de borde** (`caches.default`): la primera petición tras expirar el TTL reconstruye el payload consultando las 5 fuentes; el resto se sirve desde caché.
- **Fuentes** (todas en paralelo, con captura de errores por fuente en `errors{}`):
  - **API-Football** — lesiones de la temporada y fixtures de los próximos 8 días; si hay partidos a menos de 2 h del kickoff, también alineaciones confirmadas (titular → confianza 95, suplente → 30, lesionado → 5).
  - **Football-Data** — calendario/resultados completos de la PL (los 380 partidos).
  - **The Odds API** — momios h2h y totales (región UK).
  - **GNews** — 10 noticias de lesiones/alineaciones/sanciones.
  - **Fantasy Premier League público** — `bootstrap-static` con puntos, PP, minutos, titularidades, CS, xG/xGC, selección y transferencias de referencia; no sustituye el scoring FanTeam.
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

## Verificar los momios

`ODDS_API_KEY` está configurada como secret de producción y The Odds API responde con mercados Premier League. Después de cambiar el secret o desplegar, verifica el contrato con:

```bash
curl -s https://fanteam-data.brandonleon480.workers.dev/latest | \
  python3 -c "import json,sys;d=json.load(sys.stdin);print(d['version'],d['sources'],d['errors'],len(d['odds']))"
# esperado: v2.2.0 · sources.odds/fpl: true · errors.odds/fpl: null · odds y referencias presentes
```

Si el hostname principal todavía muestra una respuesta previa, espera su TTL o valida la Preview URL de la versión recién desplegada. La app normaliza los mercados `h2h` y `totals` de varias casas, elimina el margen implícito, usa el `last_update` de cada mercado para medir frescura y ajusta el valor esperado de capitán y vice; con datos ausentes o de más de 6 horas vuelve al modelo base.

## Sobre `players[]`

`players[]` deja de estar vacío en pretemporada porque incluye las referencias públicas FPL disponibles. Los registros con `reference` aportan rendimiento histórico; API-Football añade por separado confianza/minutos previstos/estado cuando existen lesiones o partidos a menos de 2 h. La app empareja por nombre exacto o apellido+club, conserva los minutos históricos en `player.reference.minutes` y mantiene `player.minutes` para la próxima participación; ignora cualquier coincidencia insegura.

## Secrets

| Secret | Fuente | Estado |
|---|---|---|
| `API_FOOTBALL_KEY` | api-football (api-sports.io) | ✅ activa |
| `FOOTBALL_DATA_KEY` | football-data.org | ✅ activa |
| `ODDS_API_KEY` | the-odds-api.com | ✅ activa |
| `GNEWS_API_KEY` | gnews.io | ✅ activa |
