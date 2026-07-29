# Auditoría de `src/fanteam-premium.css`

- Tamaño actual: **41688 bytes**
- Reglas de estilo evaluadas: **349**
- Alcance: la hoja solo la carga `index.html` (las páginas Premier usan `src/premier-pages.css`)
- Fuentes de uso: `index.html` + tokens de todos los scripts de `src/` que manipulan esa página + safelist de clases generadas por interpolación
- Legacy `legacy/index-v1.html` referencia la hoja: **no**

## Resultado

La auditoría estática conservadora (todos los tokens alfanuméricos de la fuente cuentan como posible uso, con cero falsos negativos) demuestra que prácticamente toda la hoja sigue viva. Solo **3 selectores** son demostrablemente inalcanzables porque ningún jugador del catálogo de 580 puede generarlos:

- `.club-WOL` (regla completa)
- `.club-WHU` (selector dentro de `.club-AVL, .club-WHU, .club-BUR`)
- `.club-BUR` (selector dentro de `.club-AVL, .club-WHU, .club-BUR`)

Reducción: **41,688 → 41,575 bytes (113 bytes)**. Todo lo demás se conserva, incluidas clases dinámicas, estados interactivos, responsive, impresión y accesibilidad.

## Safelist documentada

- `club-*` para los 20 clubes del catálogo (se genera con `club-${player.club}`): club-ARS, club-AVL, club-BHA, club-BOU, club-BRE, club-CHE, club-CRY, club-CVC, club-EVE, club-FUL, club-HUL, club-IPS, club-LEE, club-LIV, club-MCI, club-MUN, club-NEW, club-NFO, club-SUN, club-TOT
- Clases de estado aplicadas desde JS (`show`, `active`, `sortOn`, `pill easy/medium/hard`, `diffEasy/diffMedium/diffHard`, `sourceState live/err`, `dataHealth healthy/partial/stale/base`, `tag*`, `lineup GK/DEF/MID/FWD`, `choice green/blue/amber/differential`, `cap/vice/captain` en jugadores y líderes): conservadas por aparecer como literales en la fuente.

## Reproducibilidad

- Analizador: `scripts/audit-css.mjs` (`--report` imprime este análisis, `--apply` reharía el recorte).
- Presupuesto anti-regresión: `test/frontend/css-audit.test.mjs` exige tamaño ≤ 41,700 bytes, ausencia de los 3 selectores retirados y presencia de las clases vivas clave.
