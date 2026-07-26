---
inclusion: auto
---

# Reglas de Wildcard FanTeam 2026/27

- La temporada dispone de exactamente dos Wildcards independientes; no son transferencias normales ni se acumulan entre ventanas.
- Wildcard 1: solo puede usarse después del cierre de GW1 y antes del cierre de GW19. Si no se usa antes del cierre de GW19, caduca.
- Wildcard 2: solo puede usarse después del cierre de GW19 y antes del cierre de GW38. Si no se usa antes del cierre de GW38, caduca.
- Las fechas de cierre deben obtenerse de los deadlines sincronizados cuando existan y usar `GW_DEADLINES` como fallback offline.
- Usar una Wildcard significa reconstruir y reemplazar de forma atómica la plantilla completa de 15 jugadores; nunca debe registrarse como utilizada sin aplicar una plantilla completa válida.
- La nueva plantilla debe conservar exactamente 2 GK, 5 DEF, 5 MID y 3 FWD, tener 15 IDs únicos, respetar el máximo de 3 jugadores por club y no superar el poder de compra actual.
- Al aplicar la plantilla completa se actualizan saldo y precios de compra, se limpia la decisión semanal y las transferencias libres acumuladas pasan a 0. No se aplican penalizaciones de -4.
- Una Wildcard usada o caducada no puede volver a activarse. La UI debe distinguir claramente estados futura, disponible, usada y caducada.
- Cualquier refactor del optimizador debe preservar determinismo, orden de iteración, desempates, presupuesto, cuotas y compatibilidad `file://`.
