# 🗺️ Roadmap V2 — Capacidades Avanzadas (PyroStudio)

Este documento define la planificación y especificación técnica de las nuevas capacidades avanzadas de **PyroStudio**. Continúa la evolución del sistema tras completar exitosamente el **Roadmap de Estabilidad (Fases 0–8)** y el **Roadmap de Rendimiento (Fases 1–11)**.

---

## 📊 Resumen de Fases

| Fase | Título | Estado | Impacto Principal |
| :---: | :--- | :---: | :--- |
| **1** | **Asistente AI Local y Privado (Ollama & OpenAI-Compatible)** | ✅ | Generación y corrección de consultas con 100% de privacidad y cero fuga de datos fuera del equipo local |
| **2** | **Multi-Query y Múltiples Result Sets en el Editor SQL** | ⬜ | Soporte completo para scripts con múltiples `SELECT`; sub-pestañas de resultados independientes y métricas por sentencia |
| **3** | **Virtualización Continua y Paginación Infinita en el Grid (`DataGridCanvas`)** | ⬜ | Navegación continua en tablas de 100,000+ filas por bloques dinámicos sin desbordar la memoria del WebView |
| **4** | **Monitor de Telemetría y Salud en Tiempo Real (*Live Dashboard*)** | ⬜ | Observabilidad en vivo (QPS, Buffer Pool Hit Rate, Conexiones, Bloqueos e InnoDB Ops) con refresco periódico ligero |

---

## 🎯 Especificación Detallada por Fases

---

### Fase 1 — Asistente AI Local y Privado (Ollama & OpenAI-Compatible) ✅
**Objetivo:** Permitir a desarrolladores y empresas utilizar asistencia de IA inteligente (generación de SQL, explicación de errores, análisis de índices y sugerencia de optimizaciones) sin enviar esquemas, metadatos ni consultas a servicios en la nube de terceros.

- **Implementación y Arquitectura:**
  - `src-tauri/src/db/ai/ollama.rs`:
    - Normalización inteligente de endpoints (`normalize_ollama_endpoint`), tolerando cualquier sintaxis (`http://localhost:11434`, `http://localhost:11434/`, `http://localhost:11434/v1` o IP de LAN).
    - Descubrimiento automático de modelos instalados (`list_local_models`) consultando primero `/api/tags` de Ollama y con fallback a `/v1/models` para servidores OpenAI-compatibles (LM Studio, vLLM, LocalAI).
  - `src-tauri/src/db/ai/mod.rs` & `provider.rs`:
    - Adición del proveedor `AiProviderType::Custom` para pasarelas locales o empresariales sin requerir API key obligatoria.
    - Verificación estricta de Modo Privado (`is_local_endpoint`), garantizando que solo direcciones loopback o LAN privada puedan utilizarse cuando el Modo Privado está activo.
  - `src-tauri/src/db/service.rs`, `db/mod.rs` & `lib.rs`:
    - Comando Tauri `list_local_ai_models` para introspección de modelos sin problemas de CORS del navegador.
  - `src/components/AiSettingsModal.tsx` & `src/stores/aiStore.ts`:
    - Botón interactivo «Detectar modelos» que sondea y muestra los modelos locales instalados.
    - Badges interactivos para seleccionar modelos con un solo clic.
    - Ocultamiento de campos de API key para Ollama (100% offline y sin claves).
  - Pruebas unitarias completas en Rust (`ollama::tests`) y Vitest (`aiService.test.ts` y `aiStore.test.ts`).

---

### Fase 2 — Multi-Query y Múltiples Result Sets en el Editor SQL ⬜
**Objetivo:** Ejecutar scripts SQL complejos con múltiples sentencias `SELECT` y mostrar cada conjunto de resultados de manera limpia e individual, alcanzando paridad total con IDEs como DataGrip o DBeaver.

- **Arquitectura y Capas Afectadas:**
  - `src-tauri/src/db/`:
    - Adaptar el servicio de ejecución para recolectar múltiples `QueryResult` o sentencias por lote cuando el usuario ejecuta un script completo (`Run Script` / `Execute All`).
    - Detección precisa de la sentencia causante en caso de error, conservando los resultados generados previamente.
  - `src/components/QueryEditorTab.tsx`:
    - Modelo de estado para soportar un arreglo `results: QueryResult[]`.
    - Barra de sub-pestañas de resultados: `[Resultado 1 (usuarios)]`, `[Resultado 2 (pedidos)]`, `[Mensajes / Salida]`.
    - Cada sub-pestaña monta una instancia virtualizada de `DataGridCanvas` con su propia barra de ordenamiento, filtros rápidos y exportación.
    - Desglose de telemetría por consulta individual (tiempo de ejecución en milisegundos y filas afectadas).
- **Criterios de Aceptación:**
  - Ejecutar `SELECT 1; SELECT 2;` genera dos pestañas de resultados independientes sin colisiones de estado ni bloqueos de UI.
  - Un error en la sentencia N detiene la ejecución (si `stopOnError` está activo) y resalta visualmente la línea fallida en el editor, manteniendo visibles los resultados de las sentencias 1 a N-1.

---

### Fase 3 — Virtualización Continua y Paginación Infinita en el Grid (`DataGridCanvas`) ⬜
**Objetivo:** Eliminar el límite duro de 5,000 filas interactivas permitiendo explorar millones de filas mediante carga progresiva bajo demanda en el scroll.

- **Arquitectura y Capas Afectadas:**
  - `src-tauri/src/db/`:
    - Comando de paginación keyset interactiva (`fetch_table_chunk`), aprovechando la clave primaria (simple o compuesta) para lecturas continuas $O(1)$ sin el coste degradante de `OFFSET`.
    - Modo fallback por cursor o bloque relativo para consultas arbitrarias sin clave primaria.
  - `src/components/DataGridCanvas.tsx` & `src/components/TableViewer.tsx`:
    - Detección de umbral de desplazamiento vertical en el canvas de Glide Data Grid (ej. cuando el usuario alcanza el 80% del scroll visible).
    - Carga en segundo plano del siguiente bloque de filas (ej. 500 filas) y anexado transparente al búfer en memoria.
    - Indicador sutil de carga de filas en la barra de estado inferior: `Cargadas 1,500 de ~84,200 filas`.
- **Criterios de Aceptación:**
  - Desplazamiento continuo en tablas de 100,000+ filas manteniendo 60 FPS estables.
  - El consumo de memoria del WebView permanece acotado y estable al no cargar todas las filas de golpe.
  - Capacidad de cancelar la carga en curso al cambiar de pestaña o aplicar un filtro nuevo.

---

### Fase 4 — Monitor de Telemetría y Salud en Tiempo Real (*Live Dashboard*) ⬜
**Objetivo:** Monitoreo dinámico y no intrusivo de las métricas vitales del motor de base de datos durante el desarrollo y pruebas de carga.

- **Arquitectura y Capas Afectadas:**
  - `src-tauri/src/db/`:
    - Comando optimizado de recolección de métricas de bajo overhead (`get_live_engine_metrics`) mediante `SHOW GLOBAL STATUS WHERE Variable_name IN (...)` y `SHOW ENGINE INNODB STATUS`.
  - `src/components/DashboardTab.tsx`:
    - Modo "En Vivo" (Live Mode) con selector de intervalo de refresco (1s, 2s, 5s o Pausado).
    - Tarjetas de métricas con micro-gráficas (*sparklines*) de tendencia histórica (últimos 60 puntos de muestra):
      - **QPS (Queries Per Second):** Tasa instantánea de consultas procesadas.
      - **Buffer Pool Hit Ratio:** Eficiencia de caché en memoria de InnoDB (alerta si cae por debajo del 95%).
      - **Conexiones Activas vs. Límite:** Visualización del porcentaje de uso del pool de conexiones del servidor.
      - **Operaciones InnoDB:** Desglose en tiempo real de filas leídas, insertadas, actualizadas y eliminadas por segundo.
      - **Hilos y Bloqueos:** Monitoreo de hilos en ejecución (`Threads_running`) y cerrojos de tabla/fila en espera.
- **Criterios de Aceptación:**
  - El monitoreo se desactiva automáticamente cuando la pestaña está oculta o en segundo plano para ahorrar CPU.
  - Cero impacto perceptible en el rendimiento del servidor gracias a consultas acotadas de metadatos.
  - Alertas visuales discretas según las directrices de `AGENTS.md` (sin modales intrusivos ni popups nativos).

---

## 🛡️ Reglas y Directrices de Implementación

1. **Cumplimiento estricto de [AGENTS.md](file:///C:/Users/Carlos%20G/Desktop/Repos/PyroStudio/AGENTS.md):**
   - No utilizar diálogos nativos (`alert()`, `confirm()`, `prompt()`).
   - Usar tokens semánticos y primitivas de `src/components/ui/styles.ts`.
   - Garantizar paridad entre Modo Tabla y Modo Consulta para componentes reutilizados.
2. **Pruebas Automatizadas:**
   - Cada fase debe incluir pruebas unitarias en Rust (`cargo test`) y en frontend (`npm test`).
   - Verificación estricta de compilación (`npm run build`) y formateo (`cargo fmt --check`).
