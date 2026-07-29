# Auditoría conservadora de `src/fanteam-premium.css`

Este reporte se genera con:

```bash
node scripts/audit-css.mjs --coverage
```

La ejecución usa Chrome DevTools Protocol a través de Playwright para recorrer las pestañas principales. Combina esa cobertura con referencias estáticas de HTML y JavaScript. La herramienta no borra selectores: conserva los estados dinámicos, responsive, accesibilidad, impresión y cualquier regla incierta.
