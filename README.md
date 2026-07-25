# FanTeam Season Lab

Laboratorio de decisiones para el **juego de temporada de FanTeam** (Premier League 2026/27). Modela las reglas oficiales —580 jugadores, presupuesto 100M, cupos 2 GK · 5 DEF · 5 MID · 3 FWD, máximo 3 por club, 38 jornadas, wildcards— y convierte datos en vivo en recomendaciones concretas: a quién comprar, a quién vender, quién es capitán y cuándo activar la Wildcard.

**Producción:** https://survivor-ligamx.github.io/fanteam-season-lab/

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
                                        └─────────────────────────────────┘
```

- **`index.html`** — monolito autocontenido: datos incorporados de los 580 jugadores y el calendario, modelo de proyección, optimizadores y las 10 pestañas de la UI en español. Sin dependencias ni build: GitHub Pages lo sirve tal cual.
- **`legacy/index-v1.html`** — versión anterior de la app (solo referencia histórica).
- **`worker/`** — configuración y respaldo del código del Cloudflare Worker (ver `worker/README.md`).
- La app funciona sin backend (“modo seguro” con los datos incorporados) y se enriquece sola al conectar el Worker: el endpoint viene preconfigurado y se sincroniza al abrir y cada 15 minutos.

## Contrato del Worker (`GET /latest`)

| Campo | Tipo | Uso en la app |
|---|---|---|
| `ok`, `service`, `version` | metadatos | validación de respuesta |
| `updatedAt` | ISO date | frescura mostrada en la UI |
| `currentGW` | number | jornada activa (nunca retrocede la local) |
| `players[]` | `{id? \| name+club, confidence?, minutes?, status?}` | actualiza confianza/minutos/estado con emparejamiento seguro por id, nombre o apellido+club |
| `results[]` / `liveFixtures[]` | `{home, away, status, kickoff, goals}` | marcadores en vivo, estados y **deadlines reales** (primer kickoff de cada jornada) |
| `odds[]` | `{home, away, kickoff, bookmakers[].markets[]}` | normaliza `h2h` y `totals` sin margen para ajustar el valor esperado de capitán/vice; fallback al modelo base si faltan datos frescos |
| `news[]` | `{title, description, url, source, publishedAt}` | pestaña Noticias con análisis de relevancia (clubes, jugadores, lesiones) |
| `sources{}` / `errors{}` | booleans / strings | panel de observabilidad en Motor automático |

## Modelo de proyección

`proyección(p, gw) = (base_pos + pendiente_pos × (precio − 4)) × mult_fixture × rol_confianza × disponibilidad`

- **Horizonte 3GW** pondera `[1, .65, .35]`; **horizonte 6GW** pondera `[1, .85, .7, .55, .4, .28]`.
- La confianza de titularidad se actualiza en vivo desde el Worker (`players[]`); la disponibilidad castiga confianza ≤ 25.

## Módulo de optimización

- **Tabla de optimización (Mercado):** Proy. GW / 3GW / 6GW, **Pts/M€** (valor = 3GW ÷ precio), rank por posición y etiqueta **GEMA · PREMIUM · TRAMPA · EVITAR**. Para tu plantilla también muestra precio de compra y variación; es ordenable por cualquier columna (clic en el encabezado o selector).
- **Seguimiento de precios y valor:** importa precios actuales mediante JSON o CSV (`id,name,club,price`) con emparejamiento seguro; conserva el coste de adquisición, calcula valor actual, plusvalía/pérdida, saldo y poder de compra, y guarda un corte al confirmar cada jornada.
- **Optimizador de Wildcard (Comodines):** construye la mejor plantilla de 15 desde cero — greedy inicial + *hill climbing* (1-swap y 2-swap) maximizando el XI a 6 jornadas con banca ponderada al 8%, bajo el poder de compra actual (valor de plantilla + saldo), cupos y máximo 3 por club. Corre en el navegador en <1 s.
- **Planner encadenado 6GW:** parte de la plantilla y las transferencias libres actuales, aplica virtualmente cada recomendación antes de calcular la siguiente jornada, recalcula XI/capitán/vice, acumula las FT y compara la proyección total contra conservar el equipo. Solo permite aplicar el primer movimiento; el resto se recalcula con datos nuevos.
- **Mejor XI:** 8 formaciones evaluadas; capitán y vice por valor esperado, combinando la proyección base con probabilidades `h2h` y `totals` normalizadas de varias casas. La frescura se mide con `last_update` de cada mercado; si no hay mercados con menos de 6 horas, utiliza automáticamente la proyección base.

## Respaldo de temporada

Tu temporada (plantilla, historial, jornada, wildcards, saldo, precios de compra, precios importados e historial de valor) vive en `localStorage`. En **Plantilla → Controles** puedes **exportar un JSON v2** de respaldo e **importarlo** en cualquier navegador/dispositivo. Los respaldos anteriores siguen siendo compatibles mediante migración automática.

En **Mercado y precios** puedes descargar una plantilla JSON con los 580 jugadores y volver a importarla actualizada. También se acepta CSV con encabezados `id,name,club,price`; el ID tiene prioridad y el fallback nombre+club solo se aplica cuando la coincidencia es única.

## Desarrollo y deploy

- **App:** edita `index.html` y haz push a `main` — GitHub Pages publica automáticamente. Sin build.
- **Worker:** ver `worker/README.md` (deploy con `wrangler deploy`, secrets con `wrangler secret put`).
- Prueba local: abre `index.html` en el navegador; el “modo seguro” funciona sin red.

## Estado y pendientes

- ✅ App nueva publicada con módulo de optimización completo.
- ✅ Código del Worker v2.1.1 respaldado en `worker/src/index.js`, con caché adaptativa, lesiones con caducidad y suite smoke (`node worker/test/smoke.mjs`).
- ✅ `players[]`: el Worker ya lo puebla con lesiones y alineaciones (vacío en pretemporada es esperado; se activa solo con la temporada).
- ✅ v2.1.1 desplegada en Cloudflare; The Odds API activa y validada con mercados de Premier League.
- ✅ Capitán y vice por valor esperado con momios normalizados y fallback automático al modelo base.
- ✅ Planner encadenado de 6 jornadas con acumulación de transferencias, XI/capitanía recalculados y comparación contra no hacer movimientos.
- ✅ Seguimiento de valor con precios de compra, importación JSON/CSV, plusvalía/pérdida, saldo, poder de compra, cortes semanales y respaldos v2 compatibles.
- ⬜ Puntos reales por jornada y tracking de aciertos del modelo.
