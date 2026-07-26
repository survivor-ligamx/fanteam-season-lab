# Worker `fanteam-data`

Motor de datos del proyecto: agrega Football-Data, API-Football, GNews, The Odds API y el feed público de Fantasy Premier League, y expone un payload JSON que la app consume al abrir y cada 15 minutos.

- **URL:** `https://fanteam-data.brandonleon480.workers.dev/` (`/` y `/latest` devuelven el payload; `/health` devuelve estado ligero; las demás rutas responden 404)
- **Código:** `src/index.js` (respaldo del Worker desplegado)

## Versiones

- **Versión del código: v2.3.1 (parche de resiliencia)** — clave de payload `v11`; añade caché independiente de API-Football, snapshot stale seguro, cooldown exponencial para HTTP 429, soporte de `Retry-After` y corte del fan-out de alineaciones.
- Cambios acumulados sobre la 2.0.0 original:
  1. **Caché adaptativa y segura**: 15 min cuando hay partidos en ventana (kickoff entre −3 h y +4 h), 3 h el resto de la semana y 2 min bajo una clave separada cuando alguna fuente falla, para no sustituir una respuesta sana.
  2. **Protección global de cuota API-Football**: un Durable Object serializa los refreshes para la credencial compartida, conserva un snapshot completo durante 15 min y puede reutilizar fixtures/lesiones hasta 6 h si el upstream falla. Las alineaciones stale se descartan. Un HTTP 429 respeta `Retry-After`, activa backoff exponencial acotado para la política local y evita nuevas llamadas durante el cooldown; las alineaciones se consultan por kickoff y se detienen en el primer límite.
  3. **Lesiones con caducidad**: registros de más de 21 días se descartan (adiós lesionados zombis), `Questionable` → confianza 30 (duda) vs `Missing Fixture` → 5 (baja), y si un jugador tiene varios registros gana el más reciente.
  4. Claves de caché versionadas (`__fanteam_cache_vN` y `__fanteam_api_football_vN`): al subirlas, el primer request tras el deploy reconstruye el payload o snapshot sin esperar al caché viejo.
  5. **Referencia FPL**: consume `bootstrap-static`, normaliza Coventry `COV` → `CVC` y adjunta a `players[]` métricas históricas y transferencias bajo `reference`, sin credenciales y con errores observables en `errors.fpl`.

Prueba local (sin red ni credenciales): `node worker/test/smoke.mjs`

## Cómo funciona

- **Sin cron.** La frescura general la gobierna el **caché de borde** (`caches.default`): la primera petición tras expirar el TTL reconstruye el payload y el resto se sirve desde caché. API-Football añade un Durable Object (`API_FOOTBALL_COORDINATOR`) para serializar globalmente los refreshes, cooldowns y snapshots de la credencial compartida.
- **Fuentes** (las cinco fuentes se consultan en paralelo, con captura de errores por fuente; API-Football protege internamente su cuota):
  - **API-Football** — lesiones de la temporada y fixtures de los próximos 8 días; si hay partidos a menos de 2 h del kickoff, también alineaciones confirmadas (titular → confianza 95, suplente → 30, lesionado → 5). Fixtures, lesiones y alineaciones completas alimentan un snapshot coordinado globalmente; si aparece un 429 se sirven fixtures/lesiones del último snapshot válido, se descartan alineaciones stale y `sourceMeta.apiFootball`/`errors.apiFootballCache` mantienen la observabilidad.
  - **Football-Data** — calendario/resultados completos de la PL (los 380 partidos).
  - **The Odds API** — momios h2h y totales (región UK).
  - **GNews** — 10 noticias de lesiones/alineaciones/sanciones.
  - **Fantasy Premier League público** — `bootstrap-static` con puntos, PP, minutos, titularidades, CS, xG/xGC, selección y transferencias de referencia; no sustituye el scoring FanTeam.
- **CORS limitado** a GitHub Pages, `file://`, localhost y orígenes adicionales configurados mediante `CORS_ORIGINS`; solo GET/OPTIONS.

## Deploy (dos caminos)

**A) Desde el repo con wrangler (recomendado):**

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

**B) Pegar en el dashboard (solo después de crear la migración y binding con Wrangler):** Workers & Pages → `fanteam-data` → *Edit code* → reemplazar con el contenido de `src/index.js` → *Save and deploy*.

> La primera publicación de esta versión crea el Durable Object mediante la migración `v1` declarada en `wrangler.toml`; por eso debe hacerse con Wrangler. Después del deploy, `/health` debe mostrar `version: 2.3.1` y `build: api-football-resilience-v1`, y `/latest` debe mostrar `sourceMeta.apiFootball.coordinator: durable-object`. El smoke de producción rechaza el fallback regional y `coordinator-error`.

> Tras cambiar el código, el caché de borde puede seguir sirviendo la respuesta vieja hasta que expire su TTL. El código versiona la clave de caché (`__fanteam_cache_vN`): al subir de versión la clave cambia y el primer request ya reconstruye.

## Verificar los momios

`ODDS_API_KEY` está configurada como secret de producción y The Odds API responde con mercados Premier League. Después de cambiar el secret o desplegar, verifica el contrato con:

```bash
curl -s https://fanteam-data.brandonleon480.workers.dev/latest | \
  python3 -c "import json,sys;d=json.load(sys.stdin);print(d['version'],d['sources'],d['errors'],len(d['odds']))"
# esperado: v2.3.1 · sources.odds/fpl: true · errors.odds/fpl: null · odds y referencias presentes
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
