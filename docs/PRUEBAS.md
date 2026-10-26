# Verificaciones y tareas pendientes

Última ejecución: 20-10-2026 · `npm test` → **4 archivos, 117 pruebas, todas correctas** ·
`npm run build` → correcto (≈ 145 KB de JavaScript comprimido, incluida la librería de Supabase).

## Contra el servidor real de Supabase (20-10-2026)

`npm run smoke` → **14/14 comprobaciones correctas**: 3 sesiones anónimas, sala creada, unión por
código, código inexistente, aviso en tiempo real (una sola señal por acción), cada jugador solo lee
su carta, nadie lee las de otro filtrando, no se pueden cambiar vidas ni insertar cartas, funciones
internas inaccesibles, partida completa de 3 jugadores ganada (10/10).

Prueba en la app real (navegador en tamaño móvil como anfitrión + `npm run bot` como segundo
jugador): el amigo aparece en la sala sin recargar; error por jugar tarde sincronizado al instante;
4 niveles con recompensas (+1 ★ en nivel 2, +1 ♥ en nivel 3); **recarga de la página en plena
partida → vuelve sola a la sala con la misma carta**; shuriken votado por ambos; abandonar →
el otro jugador ve «partida abandonada».

Problemas encontrados con el servidor real y corregidos:
1. Cada acción emitía 5–10 mensajes de tiempo real (uno por UPDATE intermedio de `rooms`), gastando
   cuota. Ahora se emite una única señal (`room_signals`) por acción.
2. La escucha de cambios se activa un instante después de «SUBSCRIBED»: la app re-sincroniza también
   al recibir esa confirmación.
3. Una partida abandonada no aparecía en el historial de quien se fue.

## Cómo se prueba

| Nivel | Qué | Dónde |
|---|---|---|
| Unitarias | Motor de reglas TypeScript | `src/game/engine.test.ts`, `src/game/scenarios.test.ts` |
| Conformidad | Los **mismos 19 escenarios** se ejecutan contra el motor TS y contra el SQL del servidor; también se compara la normalización de la configuración | `tests/scenarios.ts`, `tests/integration/conformance.test.ts` |
| Integración | La migración real sobre Postgres real (PGlite) con los roles, privilegios por defecto y `auth.uid()` de Supabase; cada llamada como un usuario distinto | `tests/integration/server.test.ts` |
| Extremo a extremo | 3 clientes reales contra tu Supabase: tiempo real, privacidad, permisos, partida completa | `npm run smoke` |
| Manual | Navegador en tamaño móvil (375×812) | ver abajo |

Se comprobó además que las pruebas detectan fallos: al introducir a propósito un error en la regla de
penalización del SQL (−2 vidas), fallaron 5 escenarios; se restauró el código.

## Las 22 pruebas pedidas

| # | Requisito | Estado | Prueba |
|---|---|---|---|
| 1 | Baraja 1–100 | ✅ | `baraja › tiene exactamente las cartas del 1 al 100` |
| 2 | Sin duplicados | ✅ | `baraja › no tiene duplicados…`; clave única `(room_id, card)` en SQL |
| 3 | Reparto por nivel y jugadores | ✅ | `reparto › …%i jugadores en todos los niveles`; partidas completas vía API |
| 4 | Privacidad de las manos | ✅ | `privacidad de las cartas` (5 pruebas SQL) + motor |
| 5 | No jugar una carta superior a la propia más baja | ✅ | escenario `NOT_LOWEST` (TS y SQL) |
| 6 | Jugadas correctas | ✅ | escenario «jugadas correctas en orden ascendente» |
| 7 | Error con una carta inferior | ✅ | escenario (TS y SQL) |
| 8 | Error con varias cartas inferiores | ✅ | escenarios 18/25/40 y «varias del mismo jugador» |
| 9 | Consumo de vidas | ✅ | `las vidas se consumen de una en una…`; `un error no puede descontar dos vidas…` |
| 10 | Shurikens | ✅ | escenarios clásico, revelación, rechazado, sin shurikens, vacía las manos |
| 11 | Descarte correcto | ✅ | escenarios de error y shuriken comprueban manos y descartes |
| 12 | Recompensas por nivel | ✅ | escenarios clásica y personalizada; partidas completas |
| 13 | Límites de vidas y shurikens | ✅ | escenario «no superan el máximo»; partidas completas (≤5, ≤3) |
| 13b | Escudo, Rebobinar y elección de comodín | ✅ | escenarios compartidos (TS y SQL): escudo aceptado/rechazado/activo/caduca con el nivel, rebobinar aceptado/rechazado/última vida/nivel vacío/jugador que sale, elección por mayoría, cambio de voto, comodín único, todos al máximo, dos elecciones seguidas; empate al azar, caducidad de 20 s, forzar nivel (motor y servidor); actualización desde la versión anterior con una votación en curso |
| 14 | Victoria final | ✅ | escenario y partidas completas de 2, 3 y 4 jugadores (TS y SQL) |
| 15 | Derrota sin vidas | ✅ | escenario «derrota al quedarse sin vidas» |
| 16 | Peticiones duplicadas | ✅ | `action_id` repetido, doble pulsación, voto repetido, «listo» repetido |
| 17 | Dos jugadores a la vez | ⚠️ parcial | Probado el orden de procesamiento y la versión creciente. PGlite usa **una** conexión, así que el bloqueo `FOR UPDATE` con conexiones simultáneas reales solo se ejercita en Supabase (`npm run smoke`, partida real) |
| 18 | Desconexión y reconexión | ✅ servidor / ⏳ móvil real | Reconexión con la misma sesión recupera mano y sitio; anfitrión inactivo cede el rol; expulsión. Falta probar con móviles reales |
| 19 | Acceso no autorizado a una sala | ✅ | ajeno a la sala, rol `anon`, fuerza bruta de códigos, sala llena / empezada |
| 20 | Consultar cartas ajenas | ✅ | lectura directa de `hands`, filtro por otro jugador, fila de tiempo real, foto del estado |
| 21 | Alterar el estado desde el cliente | ✅ | 10 escrituras directas prohibidas, funciones internas inaccesibles, configuración maliciosa normalizada |
| 22 | Partidas de 2, 3 y 4 | ✅ | partidas completas por jugador en TS y vía API SQL |

## Verificación manual en navegador (tamaño móvil 375×812)

- ✅ Pantalla de inicio, aviso cuando el modo online no está configurado.
- ✅ Modo práctica: cuenta atrás, jugar carta, bots que juegan con ritmo, error por esperar demasiado,
  nivel superado, bots «listos», paso al nivel 2, votación de shuriken y su ejecución.
- ✅ Sala de espera, votación de shuriken, error con descartes y pantalla de derrota, con estados de
  ejemplo generados por el motor (`npm run dev` y abrir `/?preview=lobby`, `mistake`, `vote`, `lost`
  o `won`; esta herramienta no se incluye en la web publicada).
- Errores encontrados y corregidos durante esta revisión:
  1. La cuenta atrás no aparecía al empezar (la pantalla se montaba después del evento).
  2. Los bots nunca se marcaban «listos» (se ignoraban cambios de estado sin evento).
  3. La esquina girada de la carta hacía que el 16 pareciera un 91.
  4. «Tú propone…» → «Has propuesto…».
  5. `get_my_history` ordenaba por una columna renombrada (lo detectó una prueba).

## Criterios de aceptación

| Criterio | Estado |
|---|---|
| Crear sala desde el móvil | ✅ en navegador con tamaño móvil contra Supabase real · ⏳ en un móvil físico |
| Entrar desde un enlace compartido | ✅ unión por código contra el servidor real · ⏳ abrir el enlace en otro móvil |
| Partida real con ≥ 2 jugadores | ✅ (`npm run smoke` con 3 y app + bot con 2) |
| Reparto correcto | ✅ |
| Cada jugador ve solo sus cartas | ✅ (servidor) |
| Jugadas en orden mediante acciones reales | ✅ (servidor) |
| Detección de errores | ✅ |
| Vidas y shurikens | ✅ |
| Recompensas y progresión | ✅ |
| Victoria y derrota | ✅ |
| Todos reciben las actualizaciones | ✅ |
| La reconexión no rompe el estado | ✅ (recarga en plena partida) · ⏳ pantalla bloqueada en móvil real |
| No se pueden duplicar jugadas ni manipular recursos | ✅ |
| Funciona en iPhone y Android | ⏳ probado en emulación móvil, no en dispositivos reales |
| Publicado en una URL accesible | ✅ <https://auri-981.github.io/unisono/> (sala creada, partida y error detectado desde la web pública) |
| Instrucciones completas de despliegue | ✅ `docs/DESPLIEGUE.md` |
| Sin pagos dentro de las cuotas gratuitas | ✅ (planes Free de Supabase y GitHub Pages) |

## Pendiente

- [x] Crear el proyecto de Supabase y ejecutar la migración.
- [x] Ejecutar `npm run smoke` contra él.
- [x] Publicar en GitHub Pages: <https://auri-981.github.io/unisono/>
- [ ] Probar con 2–4 móviles reales (iPhone + Android), incluida reconexión y pantalla bloqueada.
- [ ] (Opcional) Activar CAPTCHA de Supabase si la web se comparte públicamente.

## Ideas para más adelante

Botón de «pausa / concentración» en mitad de un nivel, efectos de sonido más trabajados, segundo
idioma, emparejamiento público, perfiles persistentes (convirtiendo la sesión anónima en cuenta),
empaquetado como app con Capacitor.
