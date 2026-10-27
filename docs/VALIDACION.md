# Validación — Bacalar Smart Delivery

Este documento conserva la validación de la modalidad central anterior. La ampliación regional, con 62 pruebas y los viajes UPB/Cenote Azul, se documenta en [REGIONAL.md](REGIONAL.md); sus cifras reproducibles están en `public/data/regional-validation.json`.

Validación realizada el 27 de octubre de 2026 con Node.js 24 y Chrome local en Windows. Se mantuvo el proyecto React existente y la modalidad SVG.

## Resultados ejecutados

| Comprobación                                                                   | Resultado                                                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd test`                                                                 | 32 pruebas aprobadas en 3 archivos                                                                                      |
| Pruebas originales SVG                                                         | 9 aprobadas; incluye 300 ciudades contra BFS                                                                            |
| Grafo geográfico                                                               | 19 aprobadas; incluye comparación contra Dijkstra                                                                       |
| Overpass y persistencia                                                        | 4 aprobadas; caché, concurrencia, respuesta parcial y fallos                                                            |
| `npm.cmd run build`                                                            | Compilación TypeScript y Vite aprobada                                                                                  |
| TypeScript con `--noUnusedLocals --noUnusedParameters`                         | Aprobado                                                                                                                |
| `node scripts/browser-check.mjs`                                               | Flujo SVG original aprobado en Chrome                                                                                   |
| `node scripts/browser-check.mjs --bacalar`                                     | Flujo Bacalar, WebGL, fuentes GeoJSON, cierres, entrega, modo móvil y cambios de modalidad aprobados                    |
| `node scripts/browser-check.mjs --online` con `TEST_URL=http://127.0.0.1:4173` | Teselas vectoriales reales, capa de agua turquesa, ruta y entrega aprobadas sobre `dist/` servido mediante Vite preview |

Las pruebas de navegador finalizaron sin errores de consola de la aplicación. Chrome se ejecutó con renderizado de software para WebGL en la comprobación automatizada; no se hizo un benchmark de rendimiento de GPU física.

## Correspondencia exacta entre A* y el mapa

La ruta normal de **Don Mostado Pizza → Vico’s** calcula **1,009.5904515815407 m**, **10 aristas dirigidas** y **19 expansiones**. Los puntos originales se ajustan 30.3083 m y 27.8910 m a los nodos transitables OSM 3744961664 y 3744961933, respectivamente. Esos ajustes no se suman al costo vial ni se animan como calles.

La prueba unitaria contrasta la suma de costos y geometrías con Dijkstra independiente. En Chrome se lee el GeoJSON de la **fuente real `route` de MapLibre**, se extraen los identificadores de las aristas elegidas por A*, y se reconstruyen las coordenadas de esas mismas vías desde el archivo OSM crudo. La lista completa de coordenadas coincide exactamente. También se comprueba que la capa está renderizada, no solo que exista el objeto de datos.

No se consultó un motor de rutas externo. OpenFreeMap únicamente proporcionó el fondo vectorial. La motocicleta interpola esa misma línea; el rumbo se anima por separado para no interpolar posiciones cortando las esquinas.

## Interacciones verificadas en Chrome

- Avanzar y retroceder restaura costos, registros y nodo actual; la capa de nodos refleja esa instantánea.
- Ocultar y mostrar la exploración modifica la visibilidad de la capa técnica.
- La entrega se puede pausar y reanudar; la distancia queda constante durante la pausa, termina al 100% y admite seguimiento de cámara.
- Un clic sobre una calle cierra su identificador físico; limpiar cierres la reabre.
- El escenario 2 conserva la ruta anterior y obtiene una ruta que no incluye el tramo bloqueado.
- Con la red del navegador desconectada, Overpass falla de forma controlada y el catálogo local se conserva; el escenario 3 sigue calculándose, termina sin ruta y no habilita entrega.
- La búsqueda encuentra un comercio real del extracto y muestra su categoría.
- Crear, guardar, usar de destino y eliminar un punto personalizado funciona sin escribir en OSM.
- Es posible volver al SVG con sus 64 nodos y abrir de nuevo Bacalar.
- La página no presenta desbordamiento horizontal a 390 px; se guardaron capturas y se inspeccionó el diseño.
- En producción, las teselas OpenFreeMap y la laguna se dibujaron realmente; la capa de agua tiene el color personalizado `#a9ddd9`.

## Alcance y comprobaciones no realizadas

- No se verificó físicamente el sonido emitido por altavoces; se implementa con Web Audio y habilitación por clic.
- Overpass no estuvo disponible para renovar el extracto durante su preparación. El catálogo real se obtuvo mediante una única consulta acotada a la API oficial de OSM; su respuesta y procedencia se conservan. La integración de actualización Overpass sí se probó con respuestas simuladas, concurrencia, caché y fallo de red en navegador.
- No se comprobó exhaustivamente la vigencia de cada comercio ni condiciones de tránsito reales. El extracto es parcial y no interpreta relaciones de giro o restricciones horarias.
- Vite advierte del tamaño del bloque de MapLibre. Se carga dinámicamente al entrar a Bacalar; la advertencia no es un error de compilación. El worker también se incluye como recurso local de producción.

La captura `bacalar-online.png` se obtuvo de la compilación final servida localmente, no de un mockup.
