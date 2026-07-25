# FanTeam Season Lab

Herramienta de decisiones para el **juego de temporada de FanTeam — Premier League 2026/27**. Detecta la jornada actual, sincroniza datos en vivo y recomienda alineación, capitán, transferencias y uso de wildcards, todo en español y sin backend propio.

**Web:** https://survivor-ligamx.github.io/fanteam-season-lab/

## Arquitectura

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  GitHub Pages           │  fetch  │  Cloudflare Worker           │
│  index.html (SPA)       │ ──────► │  fanteam-data (v2)           │
│                         │  JSON   │  /latest                     │
│  · 580 jugadores base   │         │  · API-Football (lesiones)   │
│  · Proyecciones y       │         │  · football-data (partidos)  │
│    recomendaciones      │         │  · Noticias (RSS/medios)     │
│  · Estado en            │         │  · Momios (pendiente)        │
│    localStorage         │         │  · Cron de actualización     │
└─────────────────────────┘         └──────────────────────────────┘
```

- **Frontend** (`index.html`): página estática autocontenida (HTML + CSS + JS, sin dependencias). Se publica con GitHub Pages desde `main`. Todo el estado del usuario (plantilla, transferencias, wildcards, historial) vive en `localStorage` bajo la clave `fanteam-season-lab-v1`.
- **Motor de datos** (Worker `fanteam-data`): corre en Cloudflare Workers en `https://fanteam-data.brandonleon480.workers.dev`. Agrega fuentes externas y expone un solo endpoint JSON que la página consulta al abrir y cada 15 minutos.

## Contrato del Worker — `GET /latest`

| Campo | Tipo | Descripción |
|---|---|---|
| `ok`, `service`, `version` | meta | Identificación del servicio |
| `updatedAt` | ISO date | Última corrida del cron |
| `currentGW` | number | Jornada detectada (1–38) |
| `players[]` | array | Actualizaciones de jugadores: `{id\|name+club, confidence, price, minutes}`. La app las aplica con matching por id, nombre y club |
| `results[]` | array | Los 380 partidos con estado y marcador; la app los mapea a jornadas con `pairToGW` |
| `liveFixtures[]` | array | Partidos en vivo |
| `odds[]` | array | Momios (fuente pendiente de configurar) |
| `news[]` | array | Noticias `{title, description, url, source, publishedAt}`; la app detecta lesiones y ajusta avisos |
| `sources{}` | object | Estado de cada fuente (`apiFootball`, `footballData`, `odds`, `news`) |
| `errors{}` | object | Último error por fuente (ej. `odds: "HTTP 401"`) |

## Reglas del juego modeladas

- Plantilla de 15: **2 GK / 5 DEF / 5 MID / 3 FWD**, presupuesto **100 M**, máximo **3 por club**.
- 8 formaciones válidas para el XI; capitán y vice por proyección.
- Transferencias acumulables (máx. 2) con umbral para gastar o guardar; 2 wildcards.
- Deadlines de las 38 jornadas precargados (`GW_DEADLINES`); la jornada se detecta sola.

## Desarrollo y deploy

- **Frontend:** editar `index.html` y hacer push a `main`. GitHub Pages publica automáticamente.
- **Worker:** el código vive en Cloudflare (dashboard → Workers → `fanteam-data`). *Pendiente: versionarlo en este repo (carpeta `/worker` con `wrangler.toml`) para tener respaldo y deploy reproducible con `wrangler deploy`.*
- No hay build ni dependencias: abrir `index.html` en el navegador también funciona en local (con datos base, y en vivo si el Worker responde).

## Pendientes conocidos

- [ ] Worker: poblar `players[]` (lesiones → `confidence`, precios → `price`).
- [ ] Worker: corregir credencial de momios (`errors.odds: HTTP 401`) y consumirlos en la app.
- [ ] Worker: respaldar el código en este repo (`/worker`).
- [ ] App: tabla de optimización en Mercado (proyección por jornada, horizonte 3–6 GW, puntos por millón).
- [ ] App: optimizador de plantilla completa para Wildcard (100 M, cuotas, máx. 3 por club).
- [ ] App: exportar/importar temporada (hoy el estado vive en un solo navegador).
