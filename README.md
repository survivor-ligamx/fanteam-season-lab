# FanTeam Season Lab

Laboratorio de decisiones para el **juego de temporada de FanTeam** (Premier League 2026/27). Modela las reglas oficiales —580 jugadores, presupuesto 100M, cupos 2 GK · 5 DEF · 5 MID · 3 FWD, máximo 3 por club, 38 jornadas, wildcards— y convierte datos en vivo en recomendaciones concretas: a quién comprar, a quién vender, quién es capitán y cuándo activar la Wildcard.

**Producción:** https://survivor-ligamx.github.io/fanteam-season-lab/

> **Alcance de la plantilla:** la app es un planificador independiente. La plantilla mostrada es un borrador/recomendación guardado en este navegador; no inicia sesión, no envía cambios ni modifica una cuenta de FanTeam. Mientras GW1 siga abierta y la función esté activa, el borrador se revisa al abrir la web y cada 15 minutos: solo una sincronización fresca de API-Football/FPL puede reconstruirlo por lesiones o bajas confirmadas, o por una mejora relevante calculada con datos FPL. Las alineaciones publicadas después del cierre y GNews generan alertas, pero nunca cambian jugadores por sí solas. Cada actualización queda auditada en el estado local y se puede pausar. Cuando esté listo, debes copiar y confirmar manualmente en FanTeam los 15 jugadores, banca, capitán y vice.

---

## Arquitectura

```
┌──────────────────────────────┐        ┌─────────────────────────────────┐
│  GitHub Pages (index.html)   │  fetch │  Cloudflare Worker: fanteam-data │
│  App estática, sin build.    │ ◄──────┤  Agregador con caché adaptativa │
│  Modelo, optimizador y UI    │ /latest│  · Football-Data (resultados)    │
│  corren en el navegador.     │        │  · API-Football (lesiones)       │
│  Estado en localStorage.     │        │  · GNews (noticias)              │
└──────────────────────────────┘        │  · The Odds API (momios)         │
                                        │  · FPL público (xG/CS/rendimiento)│
                                        └─────────────────────────────────┘
```

- **`index.html`** — app estática sin build: contiene los datos de 580 jugadores, calendario, adaptadores del modelo, optimizadores y las 10 pestañas de la UI en español.
- **`src/season-storage.js`** — adaptador clásico para persistir estado, endpoint y caché con fallback en memoria cuando `localStorage` no está disponible.
- **`src/fanteam-scoring.js`** — motor puro FanTeam v1 para validar estadísticas, normalizarlas y calcular puntos por posición.
- **`src/fanteam-import.js`** — núcleo puro y namespaced para parsear CSV/JSON, emparejar jugadores y preparar actualizaciones de precios y resultados.
- **`src/fanteam-history.js`** — transición pura de resultados reales y evaluación histórica de precisión, capitanía y transferencias.
- **`src/fanteam-finance.js`** — núcleo puro de valoración, coste de compra, poder adquisitivo y límite de jugadores por club.
- **`src/fanteam-state.js`** — normalizador puro y compatible del estado de temporada: reconstruye respaldos y localStorage, sanea históricos, precios, resultados y decisiones, y devuelve los precios derivados sin mutar la entrada ni el catálogo.
- **`src/fanteam-data.js`** — ingestor puro del payload del Worker: resuelve clubes y jugadores, prepara confianza/minutos/estado, normaliza marcadores y deriva deadlines/GW sin tocar catálogo, estado, caché ni DOM.
- **`src/fanteam-deadlines.js`** — regla pura de cierres: toma el kickoff más temprano de cada jornada, resta 90 minutos y conserva el calendario incorporado como fallback.
- **`src/fanteam-wildcard-worker.js`** — ejecuta la búsqueda intensiva de Wildcard fuera del hilo principal; recibe únicamente un snapshot serializable de catálogo, puntuaciones y restricciones.
- **`src/fanteam-odds.js`** — núcleo puro de momios: valida frescura, asigna jornadas, elimina margen de `h2h`/`totals` y agrega probabilidades multicasa sin leer reloj, estado, caché, almacenamiento ni DOM.
- **`src/fanteam-projection.js`** — modelo puro de disponibilidad, proyección, horizontes, selección del mejor XI y capitanía con momios opcionales.
- **`src/fanteam-market.js`** — analítica pura de Mercado: conserva proyecciones/ranks/etiquetas, construye el programa 3GW, resume puntos/PP/PPM/minutos/partidos, calcula CS próxima GW con Poisson, detecta ventajas posicionales probables (sin alterar la posición FanTeam) y diferenciales de calidad usando selección FPL solo como proxy, identifica MID defensivos de bajo techo cuando una muestra madura combina poco xG y apenas 2–3 puntos por partido, y genera trackers sin acceder a DOM, red, reloj, almacenamiento ni estado global.
- **`src/fanteam-transfers.js`** — recomendador puro de cambios simples/dobles y transiciones de plantilla, saldo y transferencias libres.
- **`src/fanteam-week.js`** — cierre semanal puro y atómico: congela historial/valor, consume FT, avanza la jornada y finaliza GW38 sin mutar el estado.
- **`src/fanteam-planner.js`** — simulador puro del plan encadenado de seis jornadas y transición pura para aplicar su decisión actual, con presupuesto, FT y baseline sin transferencias.
- **`src/fanteam-planner-view.js`** — presentación pura del resumen, ruta, notas y acción del Planner 6GW; no accede al DOM ni al estado.
- **`src/fanteam-wildcard.js`** — optimizador puro y determinista de plantillas completas, con estado temporal para las dos ventanas de Wildcard.
- **`src/season-backup.js`** — módulo clásico y namespaced para crear/validar respaldos v5 y migrar respaldos históricos, cargable también mediante `file://`.
- **`legacy/index-v1.html`** — versión anterior de la app (solo referencia histórica).
- **`worker/`** — configuración y respaldo del código del Cloudflare Worker (ver `worker/README.md`).
- La app funciona sin backend (“modo seguro” con los datos incorporados) y se enriquece sola al conectar el Worker: el endpoint viene preconfigurado y se sincroniza al abrir y cada 15 minutos.

## Contrato del Worker (`GET /latest`)

| Campo | Tipo | Uso en la app |
|---|---|---|
| `ok`, `service`, `version` | metadatos | validación de respuesta |
| `updatedAt` | ISO date | frescura mostrada en la UI |
| `currentGW` | number | jornada activa (nunca retrocede la local) |
| `players[]` | `{id? \| name+club, confidence?, minutes?, status?, reference?}` | actualiza confianza/minutos/estado y adjunta referencia FPL saneada (`points`, `pointsPerGame`, `minutes`, `starts`, `cleanSheets`, xG/xGC y transferencias) con emparejamiento seguro |
| `results[]` / `liveFixtures[]` | `{home, away, status, kickoff, goals}` | marcadores en vivo, estados y **deadlines reales** (primer kickoff de cada jornada) |
| `odds[]` | `{home, away, kickoff, bookmakers[].markets[]}` | normaliza `h2h` y `totals` sin margen para ajustar el valor esperado de capitán/vice; fallback al modelo base si faltan datos frescos |
| `news[]` | `{title, description, url, source, publishedAt}` | pestaña Noticias con análisis de relevancia (clubes, jugadores, lesiones) |
| `sources{}` / `errors{}` | booleans / strings | panel de observabilidad en Motor automático |

`FanTeamData` interpreta este contrato de forma pura y devuelve planes de actualización, referencias históricas, marcadores, deadlines y jornada detectada. Mantiene `player.minutes` como estimación de la próxima participación y guarda minutos históricos, puntos y demás métricas FPL bajo `player.reference`. `FanTeamOdds` recibe el reloj y los deadlines por inyección, comprueba la frescura de cada mercado, deriva la jornada y normaliza/agrega probabilidades sin margen. Los adaptadores de `index.html` conservan los efectos: mutar `PLAYERS`/`SYNC`, mantener las cachés de momios y Mercado, leer el reloj, avanzar el estado sin retroceder, hacer fetch, guardar caché/localStorage y renderizar la UI.

## Modelo de proyección

`proyección(p, gw) = (base_pos + pendiente_pos × (precio − 4)) × mult_fixture × rol_confianza × disponibilidad`

- **Horizonte 3GW** pondera `[1, .65, .35]`; **horizonte 6GW** pondera `[1, .85, .7, .55, .4, .28]`.
- La confianza de titularidad se actualiza en vivo desde el Worker (`players[]`); la disponibilidad castiga confianza ≤ 25.
- `FanTeamProjection` encapsula la fórmula, las ocho formaciones válidas, el EV de capitán y los horizontes. Recibe calendario, jugadores y las probabilidades puras de `FanTeamOdds` mediante adaptadores para que ambos núcleos sean deterministas y sigan funcionando con `file://`.
- Los horizontes se detienen en GW38: ningún cálculo del tramo final arrastra jornadas inexistentes más allá de mayo de 2027.

## Módulo de optimización

- `FanTeamFinance` concentra la valoración actual, coste de compra, plusvalía, poder adquisitivo y máximo de tres jugadores por club. Consulta el estado y los precios mediante adaptadores para conservar actualizaciones en vivo sin acoplar el núcleo a la UI o `localStorage`.
- `FanTeamTransfers` encapsula la búsqueda de cambios simples y dobles, conserva los umbrales y restricciones de presupuesto/club, y calcula las transiciones puras de plantilla, saldo y transferencias libres. Recibe jugadores, horizonte y validadores mediante adaptadores; el estado y la aplicación de decisiones siguen en la app.
- `FanTeamWeek` cierra una jornada de forma pura y atómica: añade el pronóstico y corte de valor ya capturados, consume las FT pendientes, avanza a la siguiente jornada o finaliza GW38 y limpia la decisión sin mutar el estado. El cálculo del XI, la persistencia, los avisos y el renderizado permanecen como adaptadores.
- `FanTeamHistory` aplica de forma inmutable los resultados preparados por `FanTeamImport` y evalúa MAE, RMSE, sesgo, cobertura, capitanía con fallback al vice y retorno ponderado de transferencias. El reloj, archivos, persistencia y presentación permanecen como adaptadores.
- `FanTeamPlanner` encadena esas transiciones durante un máximo de seis jornadas, recalcula XI y capitanía, compara la ruta con el baseline de la plantilla inicial y aplica de forma pura la decisión actual sin mutar el estado. `FanTeamPlannerView` convierte el resultado en resumen, ruta, nota y modelo de acción sin tocar DOM ni eventos; la persistencia, los avisos y el renderizado final permanecen como adaptadores en la aplicación.
- **Tabla de optimización (Mercado):** Proy. GW / 3GW / 6GW, **Valor 3GW** (3GW ÷ precio), rank por posición y etiqueta **GEMA · PREMIUM · TRAMPA · EVITAR**. Añade xG/xG90/xGC90, CS de temporada, Pts, PP, PPM (puntos ÷ precio FanTeam), minutos, partidos y balance de transferencias desde la referencia pública FPL; cuando hay resultados FanTeam importados, estos tienen prioridad para Pts/PP/minutos/partidos y la fuente se etiqueta en la tabla. Los datos ausentes se muestran como `—`, sin estimaciones inventadas.
- **Programa y CS próxima GW:** muestra chips para las siguientes tres jornadas con local/visitante, rival y dificultad. La probabilidad CS de la próxima GW solo se calcula si existen mercados frescos `h2h` + total 2.5: deriva el lambda total, calibra lambdas local/visitante y aplica Poisson (`P(CS)=e^-lambda rival`); si faltan momios suficientes muestra `—`.
- **Market tracker:** combina los cortes de precio FanTeam importados con compras/ventas netas y selección de referencia FPL, manteniendo claramente separadas ambas fuentes.
- **Seguimiento de precios y valor:** importa precios actuales mediante JSON o CSV (`id,name,club,price`) con emparejamiento seguro; conserva el coste de adquisición, calcula valor actual, plusvalía/pérdida, saldo y poder de compra. Cada importación distinta guarda un corte local por jugador (máximo 64), permite ordenar por última subida/bajada y muestra los principales movimientos en Historial.
- **Optimizador de Wildcard (Comodines):** `FanTeamWildcard` construye de forma determinista la mejor plantilla de 15 desde cero — greedy inicial + *hill climbing* (1-swap y 2-swap) maximizando el XI a 6 jornadas con banca ponderada al 8%, bajo el poder de compra actual (valor de plantilla + saldo), cupos y máximo 3 por club. La UI envía un snapshot serializable al Web Worker same-origin para no bloquear el hilo principal, revalida los 15 IDs, coste, cupos, clubes y score contra el estado vigente, y usa el optimizador síncrono como fallback seguro si `Worker` no existe, falla, expira o devuelve datos inválidos. La Wildcard 1 solo se aplica entre los cierres de GW1 y GW19, y la Wildcard 2 entre los cierres de GW19 y GW38; cada una caduca al final de su ventana. Aplicarla reemplaza atómicamente los 15 jugadores, actualiza saldo y precios de compra, reinicia las transferencias libres y consume el comodín sin penalización de −4.
- **Planner encadenado 6GW:** `FanTeamPlanner` parte de la plantilla y las transferencias libres actuales, aplica virtualmente cada recomendación antes de calcular la siguiente jornada, recalcula XI/capitán/vice, acumula las FT y compara la proyección total contra conservar el equipo. Solo permite aplicar el primer movimiento; el resto se recalcula con datos nuevos.
- **Mejor XI:** 8 formaciones evaluadas; capitán y vice por valor esperado, combinando la proyección base con probabilidades `h2h` y `totals` normalizadas de varias casas. La frescura se mide con `last_update` de cada mercado; si no hay mercados con menos de 6 horas, utiliza automáticamente la proyección base.

## Importación FanTeam v1

`FanTeamImport` concentra la parte pura de las importaciones: interpreta CSV/JSON, normaliza encabezados, resuelve jugadores primero por ID y después por coincidencia única de nombre+club, y prepara planes validados antes de modificar el estado. La lectura de archivos, los snapshots de mercado, la persistencia y el renderizado permanecen en la aplicación. Es un script clásico sin dependencias de build y funciona mediante HTTP o `file://`.

## Motor de scoring FanTeam v1

El importador puede recibir `points` oficiales o calcularlos desde estadísticas crudas. Para calcularlos, cada fila necesita `gw`, `id` (o `name+club`), `minutes` y al menos una columna de scoring. Las acciones omitidas se interpretan como `0`; para evitar registros incompletos conviene partir de la plantilla exportada:

- `goals`, `assists`, `fantasyAssists`, `shotsOnTarget`
- `saves`, `penaltiesSaved`, `cleanSheet`, `goalsConceded`
- `fullMatch`, `penaltiesMissed`, `ownGoals`, `yellowCards`, `redCards`
- `penaltiesConceded`, `freeKickGoalsConceded`, `positiveImpacts`, `negativeImpacts`

El motor aplica aparición y 60+ minutos, valores de gol/tiro a puerta por posición, porterías a cero, atajadas, goles recibidos, partido completo para MID/FWD, disciplina e impactos de ±0.3. `fullMatch` se infiere con 90+ minutos si no se proporciona. `delete: true` elimina un resultado cargado. Si una fila incluye estadísticas y `points`, prevalece el cálculo y se informa cualquier diferencia frente al valor reportado.

> `assists` y `fantasyAssists` son contadores separados: una misma acción no debe incluirse en ambos campos.

## Calibración con puntos reales

Al confirmar una jornada, la app congela el XI, capitán, vice, transferencias y proyección individual de los 580 jugadores. En **Historial** puedes descargar una plantilla e importar puntos oficiales o estadísticas de jornadas ya confirmadas. El formato directo usa `gw,id,name,club,points,minutes,played`; el formato calculado usa las columnas del motor de scoring. En JSON/CSV, `delete: true` elimina un resultado previamente cargado.

La evaluación calcula:

- **MAE, RMSE y sesgo** entre puntos proyectados y reales para todos los registros importados.
- **Puntuación real del XI + capitán**, usando al vice si el capitán figura como `played: false`.
- **Acierto de capitán** y puntos de arrepentimiento frente al mejor jugador real del XI.
- **Retorno de transferencias a 3GW**, con las mismas ponderaciones `[1, .65, .35]` del modelo.

Los marcadores del Worker no incluyen todas las acciones necesarias. Por eso los puntos oficiales o las estadísticas crudas deben proceder de FanTeam u otra exportación fiable y se conservan localmente.

## Respaldo de temporada

Tu temporada (plantilla, historial, jornada, wildcards, saldo, precios, pronósticos congelados y puntos reales) vive en `localStorage`. `FanTeamState` normaliza ese estado de forma pura y devuelve por separado los precios base/actuales; un adaptador mínimo de `index.html` los aplica al catálogo mutable antes de persistir o renderizar. En **Plantilla → Controles** puedes **exportar un JSON v5** de respaldo e **importarlo** en cualquier navegador/dispositivo. Los respaldos v1/v2/v3/v4 siguen siendo compatibles mediante migración automática.

En **Mercado y precios** puedes descargar una plantilla JSON con los 580 jugadores y volver a importarla actualizada. También se acepta CSV con encabezados `id,name,club,price`; el ID tiene prioridad y el fallback nombre+club solo se aplica cuando la coincidencia es única.

## Desarrollo y deploy

- **App:** edita `index.html` y haz push a `main` — GitHub Pages publica automáticamente. Sin build.
- **Pruebas:** requiere Node `^20.19`, `^22.13` o `>=24`. Ejecuta `npm install` una vez. `npm test` corre las regresiones del dominio en JSDOM y el smoke del Worker; `npm run test:e2e:install` instala Chromium, `npm run test:e2e` ejecuta el smoke local y `npm run test:production` valida la aplicación realmente desplegada. `npm run test:all` combina las suites locales. También puedes usar `npm run test:frontend` o `npm run test:worker` por separado.
- **CI:** GitHub Actions ejecuta `npm ci`, las regresiones y el smoke Chromium en cada pull request y push a `main`; conserva trazas, capturas y video cuando falla el navegador. El workflow de producción se dispara con cambios del frontend/Worker y diariamente: verifica contrato/CORS del Worker y prueba GitHub Pages con `FanTeamDeadlines` y el Web Worker real.
- **Worker:** ver `worker/README.md` (deploy con `wrangler deploy`, secrets con `wrangler secret put`).
- Prueba local: abre `index.html` en el navegador; el “modo seguro” funciona sin red.

## Estado y pendientes

- ✅ App nueva publicada con módulo de optimización completo.
- ✅ Código del Worker v2.3.1 respaldado en `worker/src/index.js`, con caché de payload v11, Durable Object para coordinar API-Football, snapshot stale sin alineaciones vencidas, backoff para 429, lesiones con caducidad, referencia pública FPL y suite smoke (`node worker/test/smoke.mjs`).
- ✅ `players[]`: combina referencias FPL de rendimiento/xG/CS/transferencias con lesiones y alineaciones API-Football; cada registro se empareja de forma segura sin mezclar los minutos históricos con la estimación de la próxima aparición.
- ✅ Worker v2.3.1 preparado para Cloudflare; The Odds API alimenta mercados, FPL alimenta la analítica de Mercado y API-Football conserva datos válidos durante límites transitorios de cuota.
- ✅ Capitán y vice por valor esperado con momios normalizados y fallback automático al modelo base.
- ✅ Planner encadenado de 6 jornadas con acumulación de transferencias, XI/capitanía recalculados y comparación contra no hacer movimientos.
- ✅ Seguimiento de valor con precios de compra, historial individual de hasta 64 cortes importados, ranking de subidas/bajadas, plusvalía/pérdida, saldo, poder de compra y respaldos compatibles.
- ✅ Puntos reales por jornada con motor de scoring FanTeam v1, pronósticos congelados, MAE/RMSE/sesgo, acierto de capitán y retorno de transferencias a 3GW.
- ✅ El optimizador de Wildcard corre en un Web Worker real bajo HTTP, valida nuevamente el resultado en el dominio principal y conserva fallback síncrono para `file://`, navegadores sin Worker, errores, timeout o respuestas inválidas.
- ✅ Los cierres se derivan del kickoff oficial más temprano menos 90 minutos, con fuente visible en la UI, fallback incorporado por jornada y avance monotónico de GW.
- ✅ Suite de regresión frontend con escenarios sobre render, scoring, migraciones v1-v5, precios, respaldo, recomendador, planner, aplicación/validación de decisiones, mejor XI y optimizador de Wildcard; incluye integración focalizada para Worker válido/ausente/inválido y deadlines derivados/fallback. `npm test` también ejecuta el smoke del Worker.
- ✅ Smoke E2E en Chromium para carga HTTP y `file://`, navegación, XI/banca, planner, mercado, ejecución real del Web Worker de Wildcard y exportación/importación de respaldos. Un smoke diario adicional valida contrato/CORS del Worker y la app desplegada en GitHub Pages.
