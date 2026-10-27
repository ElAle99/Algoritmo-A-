# Bacalar ampliado — entrega y regreso con A* propio

La ampliación convive con **Modo Simulación (SVG)** y **Centro · demostración anterior**. Dentro de **Modo Bacalar Real**, el selector de red abre por defecto **Bacalar ampliado · UPB + Cenote Azul**. No se utiliza Google Directions, OSRM ni ningún servicio externo para resolver rutas.

## Cobertura medida, fuente y versión

| Medida                                             | Valor de la instantánea incluida |
| -------------------------------------------------- | -------------------------------- |
| Elementos OSM crudos                               | 13,621                           |
| Vías OSM utilizadas                                | 441                              |
| Nodos de cálculo, después de compresión            | **883**                          |
| Aristas dirigidas                                  | **2,355**                        |
| Tramos físicos únicos                              | **1,324**                        |
| Longitud física, sin duplicar sentidos             | **169.267 km**                   |
| Puntos de interés del catálogo parcial             | **485**                          |
| Condiciones de superficie/regularidad OSM          | **53**                           |
| Tramos sin dato explícito de sentido               | **1,019**                        |
| Tramos sin dato explícito de acceso                | **1,324**                        |
| Relaciones de restricción de giro en este extracto | **0**                            |

Se hizo una única consulta regional a la API oficial de OpenStreetMap el **27 de octubre de 2026 a las 18:04:50 UTC** (13:04 en Cancún), después de que una consulta acotada a Overpass agotara su tiempo. No se usa la Map API como backend recurrente. La consulta y respuesta se preservan en:

- `public/data/bacalar-regional-osm.json`: respuesta cruda de OSM.
- `public/data/regional-provenance.json`: URL original, caja solicitada, fecha y generador.
- `public/data/bacalar-regional-graph.json`: grafo versionado, SHA-256 del archivo crudo, catálogo, condiciones y resultados de validación.
- `public/data/regional-validation.json`: mediciones y rutas de los tres perfiles en ambas direcciones, con sus identificadores de aristas.

La caja de extracción es sur **18.630**, oeste **−88.440**, norte **18.725**, este **−88.365**. Se escogió para incluir el tejido urbano, periferia y las conexiones cartografiadas hacia los dos destinos; no es un radio de uno o dos kilómetros. La envolvente efectivamente ocupada por nodos importados es:

```text
Sur:   18.6301623
Oeste: -88.4398065
Norte: 18.7243587
Este:  -88.3652204
```

Mide aproximadamente **10.47 × 7.86 km**, o **82.29 km² de envolvente**. Eso no significa que toda esa superficie esté recorrida por calles, que todas sus componentes estén conectadas o que OSM no tenga omisiones. No representa todo el municipio de Bacalar. Sin cierres y permitiendo explícitamente datos ausentes, una comprobación de conectividad dirigida encuentra **864 nodos alcanzables desde la pizzería, 866 desde los que se puede volver y 863 con ambas conexiones**. No se inventan conexiones para los restantes. Las vías fuera del recorte no forman parte del problema de optimización. La capa de calles y las rutas usan el mismo grafo local; un borde discontinuo señala su envolvente. El fondo remoto puede mostrar cartografía de contexto adicional, que no implica cobertura de cálculo.

Los datos y derivados están sujetos a **ODbL 1.0**, con atribución visible a **© OpenStreetMap contributors**. [Licencia OSM](https://www.openstreetmap.org/copyright), [política de API](https://operations.osmfoundation.org/policies/api/), [condiciones del fondo OpenFreeMap](https://openfreemap.org/tos/).

## Destinos y límites del acceso final

| Destino                            | Referencia                                       | Nodo donde termina la ruta motorizada                                    |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| Don Mostado Pizza                  | OSM node/4348648594                              | 3744961664, calle cercana al negocio                                     |
| Universidad Politécnica de Bacalar | OSM way/790801027                                | 8204984607, terminal de highway=service de la vía OSM 882282674          |
| Cenote Azul                        | OSM node/2580447954 y área de agua way/251886683 | 7262028817, Boulevard Costera, junto a la conexión peatonal de escaleras |
| Centro / Parque Principal          | OSM way/370821514                                | 9336022209, vía exterior                                                 |

La [UPB publica su dirección en Avenida 39, entre calles 56 y 46-A](https://www.upb.edu.mx/). El polígono OSM tiene un error ortográfico en el nombre y conserva una dirección anterior entre 50 y 54. Se informa la diferencia en la tarjeta de fuente; no se modifica OSM ni se afirma que el extremo del camino sea la puerta principal actual. Su coordenada vial es **18.7017204, −88.4003654** y se conecta mediante una vía de servicio que ya está en OSM, no mediante una línea inventada sobre el terreno.

Para el [Cenote Azul, registro OSM](https://www.openstreetmap.org/node/2580447954), el punto de interés está en **18.6470061, −88.4129825**. La ruta termina en el nodo vial **18.647316, −88.4132302**. La vía OSM 778109571 es `highway=steps`, `ramp=no`, y queda excluida para la motocicleta. No se anima el vehículo atravesando las escaleras o el agua. El acceso actual al recinto no está certificado por este proyecto.

Los puntos preestablecidos están anclados a identificadores viales reales. Para lugares genéricos o clics manuales se exige estar a menos de 30 m de un tramo OSM; se elige un extremo conectado de ese tramo e informa el ajuste. **No se añade una arista fuera de la calle**, ni se dibuja un conector como si pudiera atravesar edificios, muros o lagunas. La última aproximación al establecimiento queda fuera del recorrido. Si no hay un acceso cartografiado suficientemente cercano, se pide elegir el punto sobre la calle.

## Grafo dirigido, acceso y giros

`src/geo/graph.ts` conserva el adaptador anterior y acepta opciones regionales. `src/regional/network.ts` aplica la política ampliada:

- Solo se conectan vías por nodos OSM compartidos. Un cruce visual sin nodo común no crea intersección.
- Se conservan las geometrías internas y se comprimen vértices que no son intersecciones ni anclas necesarias. Cada arista guarda su vía original, sentido y etiquetas.
- Se interpretan `oneway=yes/no/-1`, equivalentes numéricos, rotondas y `oneway:motorcycle`. Las flechas del mapa se dibujan solo para sentidos únicos registrados.
- Acceso con precedencia `motorcycle → motor_vehicle → vehicle → access`; se excluyen prohibiciones conocidas, privados y usos agrícolas/forestales no compatibles con el reparto. Se consideran restricciones direccionales `*:forward/backward`, barreras bloqueadas y excepciones expresas para motocicletas.
- `destination/customers` no se emplea como atajo de paso: se habilita conservadoramente el componente restringido cuando un extremo está dentro de él, no solo en un cruce público colindante.
- Se excluyen superficies marcadas `smoothness=impassable` y sentidos reversibles/alternantes no evaluados. Las condiciones `*:conditional` no se evalúan por hora o calendario; las vías afectadas se excluyen conservadoramente y el modelo informa esta limitación.
- Se conservan `highway`, `maxspeed`, `surface`, `smoothness`, `turn:lanes` y demás etiquetas, consultables con **Datos de vía**. La inexistencia de etiquetas no es evidencia de pavimento, sentido, velocidad o acceso legal.

Las restricciones `no_*` y `only_*` con `from way → via node → to way`, incluida la excepción para motocicleta, se modelan sobre estados **(nodo, arista de llegada)**. Sin ese estado ampliado, cerrar un nodo una sola vez podría descartar una llegada necesaria para un giro válido. No se invierte una ruta para el regreso.

Las relaciones `via way`, estructuras incompletas y condiciones no evaluadas se identifican y sus vías de procedencia se excluyen de forma conservadora. `turn:lanes` contiene indicaciones por carril; no se inventa una prohibición general a partir de un texto de carriles. No se modelan cambios de carril ni la geometría fina del giro.

**Este extracto no trae relaciones de giro.** La implementación se comprueba con fixtures sintéticos identificados como pruebas; no se afirma que en Bacalar no existan prohibiciones reales. Tampoco se certifican semáforos, puertas abiertas, cilindrada permitida, condiciones actuales ni normativa vial no cartografiada.

La opción **Permitir vías sin sentido/acceso verificado en OSM** hace explícita una hipótesis del modelo: sin `oneway` se permiten ambos sentidos para la simulación, pero se marcan como no verificados. Desactivarla produce, con esta instantánea sin etiquetas de acceso suficientes, una búsqueda sin ruta. Ese resultado significa insuficiencia bajo esa política, no una afirmación de imposibilidad física. Los conteos de datos ausentes también se muestran para cada ruta.

## Perfiles, costos y heurísticas

Sea `L(e)` la suma Haversine de todos los segmentos de una arista, en metros; `v(e)` su velocidad en m/s; `λ ≥ 0` el factor de penalización; y `P(e) ≥ 0` la suma de incidencias aplicables al tramo físico.

| Perfil                | Costo de una arista     | Heurística                                                  |
| --------------------- | ----------------------- | ----------------------------------------------------------- |
| Más corta             | `L(e)`                  | Haversine directa al destino                                |
| Más rápida estimada   | `L(e) / v(e)`           | Haversine directa / máxima velocidad usada en todo el grafo |
| Menor riesgo conocido | `L(e) × (1 + λ × P(e))` | Haversine directa al destino                                |

Las heurísticas son admisibles y consistentes: la longitud de una polilínea no es menor que la distancia geográfica directa; la penalización no es negativa; y ninguna velocidad excede el máximo utilizado en la heurística de tiempo. El costo mostrado `f = g + h` usa **metros**, **segundos** o **metros ponderados**, según el perfil. No se mezcla una tarifa monetaria con estas magnitudes.

`maxspeed`, incluidas etiquetas por dirección y valores en mph, se convierte cuando es numérico. Si falta o no se interpreta, se aplica un supuesto visible por clase: motorway 90, trunk 70, primary 50, secondary 40, tertiary 35, residential/unclassified 25, service 15, living_street/track 10 y road 20 km/h. No son límites legales inventados ni tráfico real. El tiempo excluye esperas, semáforos, paradas, lluvia y congestión. La animación usa esos tiempos por tramo con un reloj virtual acelerable; pausar no cambia la ruta o distancia recorrida.

Pesos de incidencia antes de multiplicar por severidad 1–3: bache pequeño 0.5; grande 2; bache OSM sin tamaño 1; pavimento deteriorado 1; sin pavimentar 0.5; obra 2; zona de riesgo reportada 3. Se suman por tramo y se multiplican por `λ`. Una calle cerrada se **excluye**, no se representa con un costo meramente alto. El perfil de riesgo optimiza este índice explícito, no una probabilidad de accidente ni seguridad real. Los datos ausentes no se consideran evidencia de seguridad.

## Incidencias y persistencia

**Reportar incidencia** activa un clic sobre la vía y guarda ubicación, identificador físico, categoría, severidad, fecha ISO, fuente, estado de verificación y observaciones. Se usa localStorage versionado como mecanismo local equivalente; no hay servidor ni escritura en OSM. Hay un límite de 1,000 reportes y los errores de persistencia se informan.

Se distinguen **OSM**, **usuario sin verificar**, **confirmado por usuario (sin inspección oficial)** y **simulación** mediante texto y color/borde. El usuario puede excluir reportes sin verificar y simulaciones del costo. Los reportes se pueden eliminar explícitamente. Se asocian al SHA-256 de la instantánea: los de otra versión o sin versión se conservan y se señalan, pero no alteran rutas hasta volver a registrarlos sobre la red actual. Así no se atribuye una incidencia a otro segmento tras una actualización. Limpiar cierres manuales no borra el historial de reportes de calles cerradas; estos se retiran desde su registro.

Las 53 condiciones automáticas proceden de `surface/smoothness` y no se inventan baches porque una calle esté sin pavimentar. Solo `hazard=pothole(s)` permite generar un registro de bache OSM sin inventar su tamaño. La fecha de esos registros es de extracción, no de inspección física, y así se indica en las observaciones.

## Entrega, regreso y cierres durante el recorrido

1. Selecciona destino/perfil/política. El Web Worker calcula la traza; **Explorar A*** reproduce cada expansión o **Ver resultado** salta a su final real. Los controles siguiente/anterior restauran los estados efectivos.
2. Inicia la entrega sobre la geometría elegida. Se muestra distancia física, costo objetivo, tiempo estimado y progreso. La exploración no mueve a la moto.
3. Al llegar aparece **¡Pizza entregada!** y **Regresar a la pizzería**. Ese botón intercambia los extremos y solicita otra búsqueda independiente. **Iniciar regreso** anima la nueva ruta en verde. Si falla la vuelta, no hay botón para simularla.
4. El resumen separa distancia/tiempo de ida y regreso, total, estados explorados, cierres encontrados y evitados y diferencias de segmentos. “Cierres evitados” cuenta cierres examinados por la búsqueda; no se inventa un número basado solo en el total de reportes.
5. Si se cierra o penaliza una vía mientras se entrega, se captura la distancia recorrida y se pausa. Si la moto está en medio de un tramo, se crea un **nodo temporal exactamente sobre la geometría existente** y una arista residual orientada hacia su extremo permitido. Esa arista conserva etiquetas, costos, vía OSM y restricción de giro al llegar a la intersección. No se agrega una conexión transversal.
6. Se mantiene la ruta anterior gris y se busca desde ese punto. El usuario debe revisar el resultado y pulsar **Continuar por la nueva ruta**. Lo ya recorrido se suma al resumen del trayecto, sin afirmar que todo el trayecto modificado siga siendo óptimo desde el origen inicial.
7. Si se cierra el propio tramo ocupado y no hay continuación modelada, se detiene el viaje. No se inventa un giro en U, una marcha atrás o un salto a la intersección. Reabrir el tramo permite volver a calcular desde esa posición.

## Rendimiento y actualización

El núcleo `src/astar.ts` es único para SVG, centro y región. La selección del mínimo usa `src/heap.ts`, con entradas inmutables y descarte de entradas obsoletas; no ordena linealmente toda la lista abierta para expandir cada nodo. Los costos y vecinos se consultan en índices por identificador.

El worker regional guarda una traza de deltas proporcional a expansiones y mejoras; no clona todo el conjunto de registros en cada iteración. `TracePlayer` reconstruye el snapshot solicitado y permite retroceder. El índice espacial por celdas evita recorrer toda la ciudad en cada clic. Las capas GeoJSON permanecen en MapLibre y solo se actualizan cuando cambian sus datos. Las tablas de listas abierta/cerrada se paginan en grupos de 80 filas; no se crean miles de componentes React para los nodos. El modo **Presentación** oculta paneles de configuración y mantiene mapa, fórmula, nodo seleccionado, controles y resultados.

La aplicación lee un grafo ya generado; no consulta OSM al iniciar. El fondo OpenFreeMap sí requiere conexión, y existe un fondo local simplificado de la red. Actualización explícita:

```powershell
# Regenerar desde el extracto incluido, sin red:
npm.cmd run data:build
# Una consulta Overpass regional; un fallo no reemplaza el grafo publicado:
npm.cmd run data:update
# O importar un extracto local compatible y legítimo:
npm.cmd run data:update -- --input ruta/al/extracto.json
# Revisar el informe y validar antes de la exposición:
npm.cmd test
npm.cmd run build
```

La actualización valida los anclajes antes de publicarla. Si un identificador de acceso cambia en OSM, se debe revisar el preset; no se inventa un reemplazo. Reinicia la aplicación después de actualizar y revisa fecha/fuente/informe. No hay descarga masiva de teselas ni consultas repetidas por paneo.

## Validación ejecutada

**62 pruebas aprobadas**: se mantienen las 32 anteriores y se agregan 30 para cobertura, destinos, sentidos, accesos, giros, condiciones, perfiles, velocidades, reportes, persistencia, cierres, heurísticas, óptimos y recálculo. Una prueba usa una cadena sintética de **8,000 estados** para verificar heap y traza compacta; eso no se presenta como un recuento de nodos reales de Bacalar.

Para UPB y Cenote Azul se calcularon ida y regreso con los tres perfiles y se comparó el costo con un Dijkstra independiente sobre los mismos movimientos permitidos. La consistencia heurística se comprueba sobre las transiciones del grafo regional. Las geometrías resultantes suman exactamente las longitudes de las aristas elegidas.

| Destino / perfil              |  Ida (m) | Regreso (m) | Tiempo ida / regreso (estimado) |
| ----------------------------- | -------: | ----------: | ------------------------------- |
| UPB / más corta               | 4,178.81 |    3,922.68 | 8.72 / 8.23 min                 |
| UPB / más rápida estimada     | 4,299.90 |    4,049.25 | 7.77 / 7.30 min                 |
| UPB / riesgo conocido, λ=1    | 4,194.79 |    3,938.66 | 8.76 / 8.27 min                 |
| Cenote / más corta            | 4,289.31 |    4,098.98 | 5.55 / 5.77 min                 |
| Cenote / más rápida estimada  | 4,293.25 |    4,276.90 | 4.89 / 5.21 min                 |
| Cenote / riesgo conocido, λ=1 | 4,289.31 |    4,098.98 | 5.55 / 5.77 min                 |

Los resultados son para la instantánea incluida, sin cierres manuales y con las 53 condiciones OSM. Se permiten vías con datos ausentes de forma explícita; no son recomendaciones certificadas de conducción.

En Chrome se verificaron ambos viajes completos, color de regreso verde, reporte persistente, perfil de riesgo, paso anterior real, fuentes GeoJSON, coincidencia coordenada por coordenada contra las vías OSM originales, cierre durante movimiento sin salto de posición visible, presentación y ancho móvil de 390 px. El comando reproducible es:

```powershell
npm.cmd run dev
# En otra terminal, con Chrome local:
node scripts/browser-check.mjs --regional
# Regresiones anteriores:
node scripts/browser-check.mjs --bacalar
node scripts/browser-check.mjs
```

`CHROME_PATH` y `TEST_URL` permiten elegir ejecutable y servidor. El audio está implementado y habilitado por interacción; no se comprobó su audibilidad en altavoces. No se realizó una inspección vial, certificación legal, inventario exhaustivo de calles ni benchmark de GPU física. La compilación puede mostrar la advertencia de tamaño de MapLibre, que se carga dinámicamente solo en las modalidades geográficas.
