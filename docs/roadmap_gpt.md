# Roadmap técnico y de producto — PyroStudio

> Documento de trabajo derivado de la auditoría estática del repositorio. Define prioridades, alcance, criterios de aceptación y una secuencia de implementación para reducir riesgos sin introducir regresiones.
>
> **Repositorio:** [cgarciagl/PyroStudio](https://github.com/cgarciagl/PyroStudio)  
> **Rama revisada:** `main`  
> **Commit de referencia de la auditoría:** `1a54f8ae3442e74a8cda25d1ca3c548118d8e017`  
> **Fecha de referencia:** 2026-11-02  
> **Stack observado:** Tauri 2, Rust, SQLx, React 19 y TypeScript.

---

## 1. Propósito y reglas de ejecución

Este roadmap convierte los hallazgos de la auditoría en un plan de trabajo ordenado. La prioridad inmediata no es añadir más funcionalidades, sino reforzar la confiabilidad de las operaciones que pueden afectar datos reales, especialmente restauración de respaldos y publicación de versiones.

### Principios obligatorios

1. **Preservar lo que ya funciona.** Cada cambio debe ser acotado y justificar por qué afecta a los archivos que modifica.
2. **Inspeccionar antes de implementar.** Leer el código actual, sus llamadas, contratos, tests y dependencias. No asumir que el código sigue idéntico al snapshot de auditoría.
3. **No reescribir módulos completos por conveniencia.** Preferir correcciones pequeñas y compatibles con la arquitectura existente.
4. **Pruebas primero para los riesgos críticos.** Añadir pruebas de regresión que reproduzcan el fallo antes o junto con la corrección.
5. **No ocultar errores.** Una operación parcial debe reportarse como parcial; nunca como exitosa.
6. **Seguridad en backend.** Las validaciones críticas deben ejecutarse en Rust/backend, no depender de controles de interfaz.
7. **Cambios UX en una fase separada.** No mezclar rediseños visuales con correcciones de seguridad o integridad.
8. **Evidencia verificable.** No afirmar que una prueba manual, integración o escenario se ejecutó si no se ejecutó realmente. Informar comandos, resultados y limitaciones.
9. **No cambiar formatos de respaldo sin estrategia de compatibilidad.** Si se requiere una evolución del manifiesto, definir versión, migración y compatibilidad hacia atrás.
10. **Revisar el diff antes de cerrar.** El diff debe corresponder al alcance aprobado; revertir cambios accidentales o no relacionados.

### Convención de prioridades

- **P0 — Bloqueante:** riesgo crítico para datos, seguridad o publicación. Resolver antes de una nueva versión estable.
- **P1 — Alta:** confiabilidad y seguridad relevantes; resolver en el siguiente ciclo.
- **P2 — Media:** calidad, experiencia de usuario y mantenibilidad.
- **P3 — Evolutiva:** diferenciación de producto y nuevas capacidades.

---

## 2. Resumen ejecutivo de la auditoría

La auditoría identificó una base técnica prometedora: separación razonable entre frontend y backend, abstracción de acceso a bases de datos, controles de Safe Mode y una interfaz con componentes reutilizables. El mayor riesgo está concentrado en restauración de respaldos y en el workflow de releases.

### Estado observado en el snapshot

- Los cinco checks asociados al commit de referencia aparecían como exitosos: PHP Tunnel, frontend test/build y Rust fmt/check/test en macOS, Ubuntu y Windows.
- Esto es evidencia positiva de CI, pero no sustituye pruebas manuales, pruebas de integración contra motores reales ni validación de todos los escenarios.
- La revisión de UX fue estática, basada en componentes, estilos y estructura del frontend. No se ejecutó la aplicación para una evaluación visual o de interacción.

### Matriz de hallazgos

| Área | Prioridad | Hallazgo / oportunidad | Dirección |
|---|---:|---|---|
| Restauración | P0 | Rutas de archivos del manifiesto no restringidas de forma suficiente | Contención de rutas y pruebas de traversal |
| Restauración | P0 | No se garantiza verificar todos los hashes antes de ejecutar SQL | Verificación integral previa |
| Restauración | P1 | Errores de lectura/ejecución pueden ignorarse y reportarse éxito parcial como completo | Errores explícitos y resultado estructurado |
| Restauración | P1 | Conteo de filas puede basarse en lo declarado, no en lo ejecutado | Métricas reales |
| Restauración | P1 | Restauración de FK debe garantizarse en todas las salidas | Limpieza segura / guard |
| Releases | P0 | Input de versión interpolado directamente en script Bash | Transporte por variable de entorno y validación estricta |
| Seguridad | P1 | Ampliar pruebas de Safe Mode y clasificación de SQL | Suite adversarial |
| Migraciones | P1 | Proteger cambios de esquema y datos con integración real | Matriz de pruebas de motores |
| Calidad | P2 | Añadir Clippy y auditorías de dependencias | CI reforzado |
| UX | P2 | Descubrimiento de herramientas, tipografía, selección y accesibilidad | Iteración UX separada |
| Distribución | P2 | Binarios sin firma/notarización según documentación revisada | Firma, notarización y checksums |
| Producto | P3 | Consolidar flujos de ingeniería de bases de datos | Workspaces, entornos, migraciones y trazabilidad |

---

## 3. Fase 0 — Preparación y línea base

**Prioridad:** P0  
**Objetivo:** confirmar el estado actual antes de tocar código y evitar que el roadmap se aplique sobre una versión distinta sin advertirlo.

### Actividades

- [ ] Confirmar rama, HEAD y árbol de trabajo limpio.
- [ ] Revisar si los archivos señalados por la auditoría cambiaron desde el commit de referencia.
- [ ] Leer los módulos completos de backup/restore, verify, file grants y workflow de release.
- [ ] Identificar todos los callers de las funciones de restauración y verificación.
- [ ] Identificar el formato vigente del manifiesto y sus versiones.
- [ ] Revisar tests existentes y fixtures de respaldo.
- [ ] Registrar comandos oficiales de lint, test y build para frontend, Rust y túneles.
- [ ] Guardar resultados de CI de la línea base.
- [ ] No modificar código funcional durante esta fase.

### Archivos a inspeccionar

- `src-tauri/src/db/backup/restore.rs`
- `src-tauri/src/db/backup/verify.rs`
- `src-tauri/src/file_grants.rs`
- Comandos Tauri que exponen restauración/verificación.
- `.github/workflows/release.yml`
- Tests y fixtures asociados a backup/restore.
- Configuración de Cargo, npm y workflows.

### Criterios de salida

- Existe una nota con SHA actual y diferencias respecto del snapshot auditado.
- Se conoce el contrato actual de restore/verify y el esquema del manifiesto.
- Se dispone de una línea base reproducible de pruebas.
- No se han introducido cambios de código.

---

## 4. Fase 1 — Endurecimiento de restauración de respaldos

**Prioridad:** P0  
**Objetivo:** impedir que un manifiesto manipulado provoque lecturas fuera del directorio autorizado y garantizar que solo se restaure un respaldo íntegro y válido.

### 4.1 Contención de rutas (path traversal)

En la auditoría se observaron construcciones equivalentes a:

```rust
let schema_path = backup_dir.join(&tbl.schema_file);
let chunk_path = backup_dir.join(&chunk.file_name);
```

Los nombres proceden del manifiesto. No debe asumirse que son nombres seguros por estar dentro de un JSON.

#### Requisitos

- [ ] Centralizar la resolución segura de rutas en una función reutilizable.
- [ ] Rechazar rutas absolutas.
- [ ] Rechazar componentes `ParentDir` (`..`) y cualquier ruta que escape del directorio raíz.
- [ ] Canonicalizar la raíz y el destino cuando el archivo exista y comprobar que el destino permanezca dentro de la raíz autorizada.
- [ ] Definir tratamiento explícito para archivos inexistentes: la validación no debe convertir un error de existencia en una autorización.
- [ ] Rechazar enlaces simbólicos que permitan salir del directorio de respaldo.
- [ ] Evitar ataques por diferencias entre validación y apertura (TOCTOU) en la medida que permita la plataforma; preferir apertura segura y validación del objeto abierto cuando sea viable.
- [ ] Aplicar el mismo mecanismo a tablas, chunks, vistas, rutinas, triggers, esquemas y cualquier otro archivo referenciado por el manifiesto.
- [ ] Reutilizarlo en `verify.rs`; no mantener dos implementaciones divergentes.
- [ ] No confiar en que `file_grants::require()` valide archivos descendientes: el grant de raíz y la contención de cada ruta son controles distintos.

#### Pruebas obligatorias

- [ ] Nombre normal dentro de la raíz.
- [ ] Ruta relativa con `../`.
- [ ] Varias secuencias `../../`.
- [ ] Ruta absoluta Unix.
- [ ] Ruta absoluta Windows y prefijos de unidad/UNC.
- [ ] Separadores mixtos y componentes redundantes.
- [ ] Symlink dentro de la carpeta que apunta fuera.
- [ ] Archivo inexistente.
- [ ] Ruta válida en subdirectorio permitido.
- [ ] Nombres Unicode y espacios válidos.
- [ ] Manifiesto con ruta maliciosa en cada tipo de recurso, no solo chunks.

### 4.2 Autorización del respaldo incremental base

La auditoría observó que `base_backup_dir` puede proceder del manifiesto cuando no se proporciona una ruta base explícita.

#### Requisitos

- [ ] No tratar una ruta indicada por el manifiesto como autorización del usuario.
- [ ] Exigir que el respaldo base sea seleccionado o autorizado explícitamente por el usuario/flujo de aplicación.
- [ ] Validar que el respaldo base también tenga manifiesto válido, integridad verificada y ubicación autorizada.
- [ ] Detectar ciclos, referencias a sí mismo y cadenas de dependencias inválidas.
- [ ] Definir qué sucede si el respaldo base falta o cambió después de seleccionar el respaldo incremental.
- [ ] Mostrar claramente qué respaldos forman parte de la cadena que se restaurará.

### 4.3 Verificación integral antes de ejecutar SQL

Existe verificación SHA-256 en `verify.rs`, pero la auditoría no encontró una garantía de que restore ejecute una verificación integral obligatoria antes de iniciar la restauración.

#### Requisitos

- [ ] Validar estructura y versión del manifiesto.
- [ ] Rechazar manifiestos incompletos o cuyo estado no sea `Completed`.
- [ ] Verificar existencia, tamaño cuando esté registrado y SHA-256 de todos los archivos referenciados.
- [ ] Verificar también todos los respaldos base de una cadena incremental.
- [ ] Completar la verificación antes de ejecutar la primera sentencia SQL.
- [ ] No permitir que una verificación parcial sea interpretada como válida.
- [ ] Si un archivo cambia entre verificación y lectura, detectar la discrepancia cuando sea viable; evitar depender únicamente de una lectura anterior desconectada de la ejecución.
- [ ] Devolver un resultado de verificación estructurado y útil para la interfaz.
- [ ] No ejecutar SQL si existe un solo error de integridad.

### 4.4 Tratamiento de errores y resultado de restauración

La auditoría observó patrones que pueden ocultar fallos, por ejemplo:

```rust
if let Ok(...) = ...
let _ = backend.execute_query(...)
```

También observó que `rows_restored` puede incrementarse a partir de valores declarados en el manifiesto aunque algunas inserciones fallen.

#### Requisitos

- [ ] Eliminar silenciamiento de errores en lecturas y ejecución SQL de restore.
- [ ] Propagar errores con contexto: recurso, tabla, archivo, chunk y operación.
- [ ] Diferenciar estados `Completed`, `Partial` y `Failed` (o equivalentes del modelo existente).
- [ ] No reportar restauración completa si falló una tabla, vista, rutina, trigger o chunk.
- [ ] Contabilizar filas solo después de confirmar la ejecución exitosa de la operación correspondiente.
- [ ] Si el driver no proporciona un conteo fiable, indicar que la cifra es estimada o desconocida; no inventar precisión.
- [ ] Mantener un resumen de errores y recursos omitidos.
- [ ] Definir si el flujo continúa tras un error recuperable o se detiene; documentar la decisión.
- [ ] Evitar que un error secundario de limpieza o restauración de sesión oculte el error original.

### 4.5 Restauración segura de restricciones y estado de sesión

- [ ] Garantizar la restauración de las comprobaciones de claves foráneas ante éxito, error y cancelación.
- [ ] Usar un patrón de limpieza/guard apropiado para Rust y el ciclo de vida del backend.
- [ ] Restaurar cualquier otro estado de sesión modificado por restore.
- [ ] Evitar dejar una conexión reutilizable en un estado distinto al esperado.
- [ ] Si la conexión se pierde, informar que no fue posible confirmar la restauración del estado.
- [ ] Probar fallos inducidos en cada etapa para validar la limpieza.

### 4.6 Criterios de aceptación de la Fase 1

- Ninguna ruta del manifiesto puede escapar de la raíz autorizada.
- Los symlinks no pueden redirigir lecturas fuera de esa raíz.
- Una cadena incremental requiere autorización explícita y validación completa.
- No se ejecuta SQL si la verificación previa detecta corrupción, archivo ausente o manifiesto inválido.
- Cada error relevante aparece en el resultado final.
- Una restauración parcial nunca se presenta como completa.
- Los conteos reflejan operaciones exitosas, con sus limitaciones documentadas.
- Las restricciones y el estado de sesión se limpian/restauran en todas las rutas de salida probadas.
- Los tests nuevos fallan antes de la corrección y pasan después.

---

## 5. Fase 2 — Seguridad del workflow de releases

**Prioridad:** P0  
**Objetivo:** evitar inyección de comandos al procesar la versión proporcionada al workflow y hacer robusta la validación del tag.

### Hallazgo

En `.github/workflows/release.yml` se observó una interpolación directa similar a:

```bash
RAW_VERSION="${{ inputs.version }}"
```

La interpolación sucede antes de la validación Bash posterior. Por tanto, validar después no neutraliza una inyección que ya pudo alterar el script.

### Corrección requerida

- [ ] Pasar el input mediante una variable de entorno del step.
- [ ] Leer el valor desde el entorno en Bash.
- [ ] Validar antes de usarlo en comandos, nombres de tags, rutas o expresiones.
- [ ] Adoptar una regex SemVer estricta acorde con la política de versionado del proyecto.
- [ ] Definir explícitamente si el prefijo `v` es obligatorio.
- [ ] Rechazar espacios, saltos de línea, metacaracteres de shell y formatos ambiguos.
- [ ] Citar siempre las expansiones de variables.
- [ ] Evitar `eval` y construcción dinámica de comandos.
- [ ] Mantener permisos mínimos de `GITHUB_TOKEN` por job.
- [ ] Revisar si los pasos de release ejecutan scripts o artefactos que dependen de datos externos.

Ejemplo orientativo de transporte seguro:

```yaml
env:
  RAW_VERSION: ${{ inputs.version }}
run: |
  set -euo pipefail
  if [[ ! "$RAW_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
    echo "::error::Versión inválida"
    exit 1
  fi
```

La regex debe revisarse contra la política real del repositorio; el ejemplo no debe copiarse sin confirmar si el proyecto admite prereleases y metadata de build.

### Pruebas del workflow

- [ ] Versión estable válida.
- [ ] Prerelease válida si está permitida.
- [ ] Metadata de build si está permitida.
- [ ] Versión vacía.
- [ ] Versión sin prefijo o con prefijo duplicado.
- [ ] Caracteres de shell como comillas, punto y coma, backticks y sustitución de comandos.
- [ ] Saltos de línea.
- [ ] Sufijos inválidos o excesivamente permisivos.
- [ ] Confirmar que los valores maliciosos se rechazan sin ejecutar contenido.

### Criterios de aceptación

- El input no se interpola dentro del cuerpo del script.
- La validación precede a todo uso operativo del valor.
- Los casos válidos admitidos por la política siguen publicándose.
- Los casos inválidos fallan de forma segura.
- El workflow mantiene sus permisos mínimos y no cambia innecesariamente el proceso de release.

---

## 6. Fase 3 — Ampliación de pruebas de seguridad y regresión

**Prioridad:** P1  
**Objetivo:** convertir las garantías de seguridad en propiedades comprobables de forma continua.

### Safe Mode

La auditoría observó un diseño positivo: el backend exige un token de confirmación de un solo uso asociado al SQL exacto, con expiración de 120 segundos, y mantiene Safe Mode para conexiones clasificadas como producción incluso cuando el frontend solicita desactivarlo.

Ampliaciones:

- [ ] Confirmar que el token no puede reutilizarse.
- [ ] Confirmar expiración en el límite temporal.
- [ ] Confirmar que un token emitido para un SQL no autoriza otro SQL.
- [ ] Probar modificaciones de espacios, comentarios y mayúsculas después de emitir el token.
- [ ] Probar múltiples sentencias.
- [ ] Probar sentencias DDL y DML destructivas.
- [ ] Probar procedimientos y bloques complejos.
- [ ] Probar comentarios ejecutables de MySQL/MariaDB cuando el parser o clasificador los procese.
- [ ] Probar operaciones indirectas o combinadas que puedan cambiar datos.
- [ ] Probar clasificación de producción y que el frontend no pueda forzar la desactivación.
- [ ] Probar concurrencia y consumo simultáneo de un mismo token.

### Backup/restore

- [ ] Fixtures válidos de backup completo e incremental.
- [ ] Manifiestos truncados, malformados y con campos ausentes.
- [ ] Hash incorrecto, archivo truncado y archivo reemplazado.
- [ ] Estado distinto de `Completed`.
- [ ] Archivo ausente y archivo adicional no referenciado.
- [ ] Ruta traversal y symlink.
- [ ] Error SQL a mitad de restauración.
- [ ] Error al restaurar vistas, rutinas y triggers.
- [ ] Cancelación en distintas fases.
- [ ] Fallo de conexión y reconexión.
- [ ] Verificar el resultado reportado y el estado final de la conexión.

### Concurrencia y cancelación de consultas

- [ ] Cancelar consulta de larga duración.
- [ ] Cerrar pestaña durante ejecución.
- [ ] Cerrar conexión durante ejecución.
- [ ] Ejecutar consultas concurrentes en conexiones distintas.
- [ ] Evitar que una cancelación afecte otra consulta.
- [ ] Verificar liberación de recursos y estados visuales finales.

### Túneles

- [ ] Regresión de túneles SSH.
- [ ] Regresión de túneles HTTP.
- [ ] Reconexión y pérdida de red.
- [ ] Timeout al establecer túnel.
- [ ] Cierre de aplicación con túnel activo.
- [ ] Cancelación durante apertura/cierre.
- [ ] Validar que los errores del túnel lleguen a la interfaz con contexto.

---

## 7. Fase 4 — Migraciones y diseñador de esquemas

**Prioridad:** P1  
**Objetivo:** proteger una de las capacidades de mayor valor del producto: modificar estructuras sin perder datos ni producir esquemas incorrectos.

### Contexto observado

Se identificaron avances relevantes en commits anteriores:

- `c8818ab`: preservación de estructura/datos durante migraciones.
- `5580da7`: unificación del modelo de columnas.
- `03b3df1`: editor de claves primarias y mejoras SQLite.

### Pruebas de integración requeridas

Crear una matriz de escenarios para MariaDB, MySQL y SQLite según las capacidades que el producto declare soportar.

- [ ] Crear, renombrar, modificar y eliminar columnas.
- [ ] Cambiar tipos con datos existentes.
- [ ] Cambiar nulabilidad y valores por defecto.
- [ ] Claves primarias simples y compuestas.
- [ ] Claves foráneas, acciones ON DELETE/ON UPDATE y orden de dependencias.
- [ ] Índices únicos, compuestos y normales.
- [ ] Restricciones CHECK cuando el motor las soporte.
- [ ] Columnas generadas.
- [ ] Auto-incremento/identidad.
- [ ] Triggers.
- [ ] Vistas y dependencias.
- [ ] Datos con Unicode, valores nulos, fechas, decimales y binarios.
- [ ] Tablas grandes y operaciones con impacto de rendimiento.
- [ ] Fallo a mitad de migración y comportamiento de rollback.
- [ ] Comparación entre esquema esperado y esquema real después de aplicar.

### Criterios de aceptación

- Cada migración genera SQL coherente con el motor y versión objetivo.
- Los datos preservables permanecen intactos.
- Las operaciones no soportadas se identifican antes de ejecutarse.
- Los errores no dejan la interfaz mostrando un esquema que no corresponde a la base de datos.
- Los tests validan tanto el SQL generado como el resultado real en el motor.

---

## 8. Fase 5 — Calidad de código y CI

**Prioridad:** P2  
**Objetivo:** elevar el estándar de revisión automatizada sin ralentizar innecesariamente el desarrollo.

### Rust

- [ ] Incorporar `cargo clippy` al CI.
- [ ] Definir qué warnings son bloqueantes.
- [ ] Mantener `cargo fmt --check`, `cargo check` y `cargo test`.
- [ ] Evitar permitir warnings nuevos sin justificación.
- [ ] Ejecutar pruebas por plataforma donde haya diferencias de comportamiento.

### Frontend

- [ ] Mantener lint, tests y build.
- [ ] Añadir chequeos de tipos estrictos donde falten.
- [ ] Probar componentes críticos de conexión, editor, grid y modales.
- [ ] Añadir pruebas de accesibilidad automatizadas en componentes clave.

### Dependencias y cadena de suministro

- [ ] Auditar dependencias Rust con herramientas como `cargo audit` o equivalente.
- [ ] Revisar vulnerabilidades y licencias de dependencias npm.
- [ ] Configurar actualización controlada de dependencias.
- [ ] Fijar versiones/acciones de GitHub de forma coherente con la política de seguridad del proyecto.
- [ ] Revisar permisos de workflows y exposición de secretos.
- [ ] Generar SBOM si el nivel de distribución del producto lo justifica.

### Criterios de aceptación

- El CI cubre lint, formato, tipos, tests y build.
- Las pruebas críticas de backup/restore y release se ejecutan en cada cambio relevante.
- Los fallos son accionables y no se silencian.
- Las dependencias críticas tienen un proceso de revisión y actualización.

---

## 9. Fase 6 — UX/UI y accesibilidad

**Estado: IMPLEMENTACIÓN TÉCNICA COMPLETADA (2026-11-03).** Se aplicaron mejoras de tipografía, selección de texto y accesibilidad de diálogos. La validación visual interactiva en Windows, macOS y/o Linux, así como las pruebas moderadas con usuarios, permanecen pendientes; no se consideran completados esos entregables de evaluación.

**Prioridad:** P2  
**Objetivo:** mejorar la claridad, descubrimiento y eficiencia de la interfaz sin sacrificar la densidad funcional que necesita una herramienta de bases de datos.

> La evaluación UX de la auditoría fue estática. Antes de rediseñar, realizar una evaluación visual e interactiva sobre la aplicación ejecutándose en Windows, macOS y/o Linux. Las recomendaciones siguientes son hipótesis de mejora que deben validarse con tareas reales.

### 9.1 Navegación y descubrimiento

La aplicación concentra herramientas para explorar, consultar, diseñar, administrar y diagnosticar. Conforme crezca el producto, encontrar una función será tan importante como tenerla.

Propuesta de agrupación conceptual:

1. **Explorar:** conexiones, servidores, bases de datos, tablas, vistas y objetos.
2. **Consultar:** editor SQL, historial, favoritos, snippets y resultados.
3. **Diseñar:** diseñador de esquemas, relaciones, índices y migraciones.
4. **Administrar:** usuarios, permisos, respaldos, restauración y mantenimiento.
5. **Diagnosticar:** procesos, sesiones, explain plans, logs y rendimiento.
6. **Automatizar:** scripts, tareas y flujos repetibles.

No se requiere adoptar exactamente estos nombres ni crear una navegación nueva sin prototipo. Primero medir tareas frecuentes y descubrir dónde se pierde tiempo.

### 9.2 Tipografía y legibilidad

La auditoría observó que Maple Mono se utiliza como fuente predeterminada de toda la aplicación.

Recomendación:

- [x] Usar una fuente proporcional del sistema para navegación, formularios, diálogos y textos (Segoe UI / SF / sans-serif según plataforma).
- [x] Reservar Maple Mono para editor SQL, código, logs, valores técnicos y datos tabulares cuando sea útil.
- [ ] Revisar tamaños de 10–12 px; aumentar textos informativos y controles principales.
- [ ] Mantener densidad compacta en grids, pero permitir escalado y legibilidad.
- [ ] Validar con escalado de pantalla y distintos tamaños de ventana.

### 9.3 Selección y portapapeles

Se observó una regla global similar a:

```css
body {
  user-select: none;
}
```

Esto puede impedir seleccionar mensajes de error, documentación, valores y textos informativos.

- [x] Retirar la regla global de user-select: none; limitar la no selección a controles y superficies interactivas donde corresponda.
- [x] Permitir selección de errores, logs, consultas, nombres y mensajes.
- [ ] Verificar copiar/pegar en editor, grid, formularios y diálogos.
- [ ] Asegurar que las tablas permitan seleccionar y copiar datos según el comportamiento esperado.

### 9.4 Diálogos y accesibilidad

La auditoría observó que `Modal.tsx` ya usa `role="dialog"` y `aria-modal="true"`. Completar el patrón:

- [x] Foco inicial en el primer control relevante cuando corresponda.
- [x] Focus trap dentro del diálogo modal.
- [x] Restaurar el foco al elemento que abrió el diálogo.
- [x] Asociar título y descripción con `aria-labelledby` y `aria-describedby`.
- [x] Cerrar con Escape respetando `closeOnEscape`.
- [x] Navegación por teclado dentro del diálogo.
- [ ] Estados de carga, error y confirmación anunciados por lectores de pantalla.
- [ ] Confirmaciones de operaciones destructivas con lenguaje explícito.

### 9.5 Estados y feedback

- [ ] Diferenciar claramente conectando, conectado, reconectando y desconectado.
- [ ] Mostrar progreso y etapa en backup/restore.
- [ ] Exponer resultado parcial con resumen de éxitos y errores.
- [ ] No depender solo del color para comunicar estado.
- [ ] Evitar mensajes técnicos sin acción sugerida; incluir contexto y posible siguiente paso.
- [ ] Permitir copiar detalles técnicos del error.
- [ ] Confirmar visualmente qué conexión/entorno recibirá una operación.

### 9.6 Flujos que deben evaluarse con usuarios

- [ ] Crear y organizar una conexión.
- [ ] Conectarse a un entorno de producción con Safe Mode.
- [ ] Abrir una consulta, ejecutarla y revisar resultados.
- [ ] Editar datos en el grid y revisar el SQL generado.
- [ ] Diseñar una modificación de esquema y previsualizar la migración.
- [ ] Crear un respaldo y verificarlo.
- [ ] Restaurar un respaldo, incluyendo un caso de error.
- [ ] Encontrar una función poco frecuente mediante navegación/búsqueda.

### Implementación realizada

- [x] Tipografía de interfaz proporcional por defecto; Maple Mono queda disponible como preferencia y se conserva para contenido de código.
- [x] Selección de texto habilitada globalmente, con exclusión explícita de controles interactivos.
- [x] Mejoras de foco en el componente compartido Modal: foco inicial, contención de Tab/Shift+Tab, restauración del foco previo y relaciones ARIA para título/descripción.
- [x] Ajuste de contenedor raíz y anchos mínimos para reducir problemas de layout en ventanas estrechas.
- [x] Se conservaron los tokens de tema y la arquitectura visual existente; no se introdujeron gradientes, brillos ni nuevos colores de acento.

### Validación pendiente para cerrar la evaluación UX

- [ ] Ejecutar la aplicación y revisar visualmente en Windows, macOS y/o Linux.
- [ ] Completar pruebas de tareas reales y accesibilidad con teclado/lector de pantalla.
- [ ] Validar flujos de conexión, editor, grid, backup/restore y búsqueda con usuarios.
- [ ] Capturar comparativas antes/después y priorizar fricciones detectadas.
- [ ] Verificar responsive y escalado de pantalla en distintos tamaños/DPI.

### 9.7 Auditoría de vistas para la siguiente iteración visual

La revisión del árbol actual identifica las siguientes áreas. La intervención debe ser incremental y conservar handlers, stores, contratos de datos, atajos, menús contextuales y capacidades existentes.

| Vista / componente | Oportunidad de rediseño | Prioridad |
|---|---|---|
| `App.tsx` / `Header.tsx` | Shell de IDE: barra superior, contexto de conexión/entorno y acciones agrupadas sin eliminar accesos. | Alta |
| `Sidebar.tsx` | Explorador tipo Database Explorer: árbol, agrupación por tipo, búsqueda, acciones contextuales y densidad consistente. | Alta |
| `TabManager.tsx` | Pestañas de editor con estado activo, cambios sin guardar, fijado, división y menús contextuales. | Alta |
| `StatusFooter.tsx` | Barra de estado compacta con conexión, entorno, latencia, base/objeto y versión. | Media |
| `QueryEditorTab.tsx` | Espacio de trabajo SQL: toolbar, editor, resultados, transacciones, explain, copilot e historial con jerarquía y paneles claros. | Alta |
| `TableViewer.tsx` / `DataGridCanvas.tsx` | Inspector de tabla: Data / Structure / Indexes / FK / Triggers / DDL, grid editable, cambios staged y herramientas. | Alta |
| `DashboardTab.tsx` | Métricas y salud: tarjetas compactas, jerarquía tipográfica, filtros y gráficos consistentes. | Media |
| `WelcomeView.tsx` | Inicio y conexiones: perfiles, entornos, carpetas, recientes, conexión rápida y estados vacíos. | Media |
| Diseñadores y diagramas (`SchemaDesignerTab`, `ErDiagramTab`) | Herramientas canvas: paneles, inspector contextual, zoom, selección y acciones de esquema. | Media |
| Vistas especializadas (diagnóstico, operaciones, diff, agentes, informes) | Aplicar patrones compartidos de encabezados, filtros, tablas, estados, acciones y paneles. | Media |
| Modales y configuración | Unificar encabezados, navegación interna, espaciado, formularios, confirmaciones y estados de error. | Media |

**Trabajo aplicado en esta iteración:**
- [x] Corregir el bloque de tipografía que había quedado con saltos de línea escapados.
- [x] Restaurar selección de texto en `body` y reservar `user-select: none` para controles/superficies interactivas.
- [x] Introducir clases compartidas de workbench para shell, header, explorer, pestañas y status bar.
- [x] Aplicar el lenguaje de vista compartido a inicio, dashboard, editor SQL e inspector de tabla sin modificar sus flujos.
- [x] Actualizar la expectativa del test de preferencias al nuevo valor predeterminado de tipografía proporcional.

**Siguiente trabajo visual (sin retirar prestaciones):**
- [ ] Reorganizar las herramientas del header por frecuencia y contexto; mantener todas las acciones disponibles desde menús/paleta.
- [ ] Pulir filas, iconos, indentación, grupos y estados del explorador.
- [ ] Rediseñar la composición del editor SQL y sus paneles de resultados.
- [ ] Homogeneizar el inspector de tabla y el grid editable.
- [ ] Propagar patrones al resto de vistas especializadas y modales.
- [ ] Revisar temas claro/oscuro, tamaños de fuente, escalado y accesibilidad con la aplicación ejecutándose.

### Entregables UX

- Mapa de navegación actual y propuesta.
- Capturas antes/después.
- Prototipo de cambios estructurales antes de implementarlos.
- Lista priorizada de fricciones por frecuencia e impacto.
- Pruebas de teclado y accesibilidad.
- Validación de tareas con usuarios o pruebas moderadas.

---

## 10. Fase 7 — Distribución y confianza de releases

**Prioridad:** P2  
**Objetivo:** reducir advertencias del sistema operativo y mejorar la verificabilidad de los binarios.

### Estado observado

El README indicaba que los binarios no estaban firmados. También se observó publicación de ejecutables portables de Windows en releases.

### Acciones

- [ ] Evaluar firma Authenticode para ejecutables e instaladores Windows.
- [ ] Evaluar Developer ID signing y notarización para macOS.
- [ ] Mantener firma del updater Tauri cuando corresponda.
- [ ] No confundir `TAURI_SIGNING_PRIVATE_KEY` con firma de código de Windows o notarización de Apple.
- [ ] Publicar checksums SHA-256 de todos los artefactos.
- [ ] Publicar notas de release con versión, cambios, compatibilidad y advertencias.
- [ ] Considerar attestations/procedencia de artefactos.
- [ ] Documentar requisitos de instalación y limitaciones de binarios no firmados mientras no se implemente la firma.
- [ ] Verificar que los artefactos descargables correspondan al commit/tag publicado.

### Criterios de aceptación

- Cada release incluye hashes verificables.
- La documentación explica la firma y las advertencias que el usuario puede encontrar.
- La firma/notarización se incorpora sin exponer certificados o secretos.
- El proceso de publicación puede auditarse y repetirse.

---

## 11. Fase 8 — Evolución del producto: de administrador SQL a plataforma de ingeniería de bases de datos

**Prioridad:** P3  
**Objetivo:** concentrar la evolución en flujos integrados y diferenciadores, no en acumular herramientas aisladas.

La dirección estratégica recomendada es que PyroStudio ayude a diseñar, entender, cambiar, validar y operar bases de datos con trazabilidad.

### 11.1 Workspaces

- [ ] Workspaces configurables por proyecto o equipo.
- [ ] Conexiones agrupadas por proyecto y entorno.
- [ ] Consultas SQL reales organizadas en carpetas.
- [ ] Compartir configuración no sensible y mantener secretos protegidos.
- [ ] Variables y parámetros de entorno claramente separados.
- [ ] Metadatos de workspace versionables en Git.
- [ ] No guardar contraseñas, tokens ni claves privadas en archivos compartidos.
- [ ] Definir resolución de conflictos cuando varias personas modifican los mismos archivos.
- [ ] Permitir abrir un workspace sin conexión y editar SQL cuando sea viable.

### 11.2 Gestión de entornos

- [ ] Asociar conexiones con etiquetas de desarrollo, pruebas, staging y producción.
- [ ] Mostrar el entorno de forma persistente y difícil de confundir.
- [ ] Comparar esquemas entre dos entornos.
- [ ] Detectar diferencias de estructura y objetos.
- [ ] Generar un plan SQL revisable para sincronización.
- [ ] Previsualizar impacto antes de aplicar cambios.
- [ ] Registrar quién/cuándo ejecutó una operación cuando exista un mecanismo de auditoría apropiado.

### 11.3 Migraciones trazables y reversibles

- [ ] Historial de migraciones por workspace.
- [ ] SQL generado y editable antes de ejecución.
- [ ] Preflight de compatibilidad y riesgos.
- [ ] Rollback cuando sea técnicamente posible.
- [ ] Declarar explícitamente operaciones no reversibles.
- [ ] Comparar estado esperado con estado real.
- [ ] Detectar drift entre entornos.
- [ ] Guardar evidencias de ejecución y resultado.

### 11.4 Revisión de SQL y análisis de riesgos

- [ ] Clasificar consultas por impacto potencial.
- [ ] Detectar operaciones destructivas y ausencia de filtros.
- [ ] Identificar transacciones, locks y operaciones de larga duración cuando sea posible.
- [ ] Explicar riesgos antes de ejecutar.
- [ ] Integrar la revisión con Safe Mode, sin convertir una sugerencia de IA en autorización.
- [ ] Mostrar SQL exacto que se ejecutará.
- [ ] Permitir revisar y corregir sugerencias antes de aplicarlas.

### 11.5 Backups como flujo confiable

- [ ] Backups completos e incrementales con manifiesto versionado.
- [ ] Verificación criptográfica integral.
- [ ] Inspección de contenido y metadatos.
- [ ] Restauración de prueba en una conexión aislada.
- [ ] Reporte de integridad y restaurabilidad.
- [ ] Políticas de retención configurables.
- [ ] Evidencia de restauración de prueba.
- [ ] Mensajes explícitos sobre límites y compatibilidad entre versiones.

### 11.6 Automatización y trazabilidad

- [ ] Scripts y tareas repetibles por workspace.
- [ ] Parámetros por entorno y secretos fuera del repositorio.
- [ ] Ejecución manual inicial; automatización programada solo cuando exista un modelo seguro.
- [ ] Logs de ejecución exportables.
- [ ] Cancelación y timeout controlados.
- [ ] Historial de resultados.
- [ ] Aprobaciones explícitas para operaciones de alto impacto.

---

## 12. Secuencia recomendada de implementación

No ejecutar todas las fases en un único cambio generado por IA. Cada bloque debe tener revisión, pruebas y commit independiente.

| Orden | Entrega | Prioridad | Dependencia |
|---:|---|---:|---|
| 0 | Línea base y confirmación del código actual | P0 | Ninguna |
| 1 | Resolución segura de rutas y pruebas traversal | P0 | Fase 0 |
| 2 | Verificación integral previa a restore | P0 | Fase 1 |
| 3 | Errores explícitos, estados parciales y limpieza FK | P1 | Fase 1 |
| 4 | Seguridad de input en workflow de release | P0 | Fase 0 |
| 5 | Suite adversarial Safe Mode y backup/restore | P1 | Fases 1–4 |
| 6 | Pruebas de migraciones contra motores reales | P1 | Línea base |
| 7 | CI, Clippy y auditoría de dependencias | P2 | Tests estabilizados |
| 8 | Evaluación UX visual y prototipos | P2 | Independiente |
| 9 | Ajustes de accesibilidad y legibilidad | P2 | Evaluación UX |
| 10 | Firma, notarización y checksums | P2 | Pipeline de releases |
| 11 | Workspaces y gestión de entornos | P3 | Seguridad y modelo de proyecto |
| 12 | Migraciones trazables, revisión SQL y automatización | P3 | Workspaces y pruebas |

### Política de commits

- Un commit por corrección lógica o grupo pequeño de cambios relacionados.
- Mensajes de commit descriptivos y convencionales.
- No mezclar cambios de UX con correcciones de seguridad.
- No hacer force push ni reescribir historial como parte de este roadmap sin autorización expresa.
- Mantener los tests de regresión en el mismo cambio que corrige el defecto.
- Para cambios de formato de backup, incluir fixtures de versiones anteriores.

---

## 13. Prompt operativo para agentes de programación IA

El siguiente bloque puede utilizarse como instrucción base para Antigravity, Claude u otro agente que trabaje sobre el repositorio.

### Instrucciones

> Trabaja sobre el repositorio PyroStudio y sigue el roadmap de `docs/roadmap_gpt.md`.
>
> Antes de editar:
>
> 1. Confirma rama, commit actual y estado del árbol.
> 2. Comprueba si los archivos y hallazgos descritos en el roadmap siguen vigentes.
> 3. Inspecciona las implementaciones, callers, tests y contratos existentes.
> 4. Presenta un plan de cambios por archivo, riesgos y pruebas antes de implementar.
> 5. No asumas que el snapshot de auditoría sigue siendo idéntico al código actual.
>
> Durante la implementación:
>
> - Trabaja solo en la fase solicitada; no intentes completar todo el roadmap en una sola ejecución.
> - No reescribas módulos completos si una corrección localizada es suficiente.
> - No cambies APIs, formatos persistidos o comportamiento público sin justificar compatibilidad.
> - No elimines validaciones ni tests para conseguir que CI pase.
> - No silencies errores ni conviertas fallos en advertencias cosméticas.
> - No hagas rediseños visuales globales durante correcciones de backend o seguridad.
> - Añade pruebas de regresión para cada defecto corregido.
> - Si descubres un problema fuera del alcance, documéntalo y no lo modifiques sin aprobación.
>
> Al terminar:
>
> 1. Ejecuta las pruebas específicas y después las suites relevantes.
> 2. Ejecuta lint, formato, chequeo de tipos y build cuando correspondan.
> 3. Informa exactamente qué comandos ejecutaste y sus resultados.
> 4. Distingue pruebas ejecutadas, pruebas no disponibles y validaciones pendientes.
> 5. Revisa el diff completo y elimina cambios accidentales.
> 6. Resume archivos modificados, comportamiento corregido, riesgos residuales y criterios de aceptación cubiertos.
> 7. No afirmes que una prueba manual o de integración se realizó si no se ejecutó.
>
> No continúes a la siguiente fase hasta que la fase actual tenga pruebas satisfactorias y revisión del diff.

---

## 14. Definition of Done global

PyroStudio puede considerar este roadmap cubierto cuando:

- [ ] Restauración valida y restringe todas las rutas derivadas del manifiesto.
- [ ] Integridad SHA-256 se verifica antes de ejecutar SQL.
- [ ] Restauraciones parciales y fallidas se informan correctamente.
- [ ] El estado de sesión y las restricciones se recuperan de forma segura.
- [ ] El workflow de releases no interpola inputs no confiables dentro de scripts.
- [ ] Safe Mode tiene cobertura de pruebas adversariales suficiente.
- [ ] Migraciones tienen pruebas de integración en motores soportados.
- [ ] CI incluye controles de calidad y dependencias.
- [ ] La UX fue evaluada con la aplicación ejecutándose, no solo por inspección de código.
- [ ] La interfaz es accesible por teclado y permite seleccionar/copiar información útil.
- [ ] Los releases incluyen mecanismos verificables de integridad y documentación de firma.
- [ ] La evolución de producto se apoya en workspaces, entornos, migraciones y trazabilidad coherentes.

## 15. Riesgos y decisiones que requieren confirmación del mantenedor

No tomar estas decisiones automáticamente:

1. **Compatibilidad de manifiestos:** decidir cuánto tiempo se soportarán formatos antiguos.
2. **Política incremental:** decidir si los respaldos incrementales pueden depender de rutas externas o si toda la cadena debe quedar contenida en un paquete/ubicación controlada.
3. **SemVer:** confirmar si se aceptan prereleases y metadata de build.
4. **Motores soportados:** definir versiones mínimas y matriz oficial de MariaDB, MySQL y SQLite.
5. **Firma de binarios:** decidir presupuesto, certificados y estrategia de distribución.
6. **Sincronización de workspaces:** decidir qué archivos se versionan, cómo se protegen secretos y cómo se resuelven conflictos.
7. **Auditoría de operaciones:** definir si el historial será local, exportable o compartible y qué datos sensibles debe excluir.

---

## 16. Conclusión

La prioridad inmediata de PyroStudio es la confianza operacional: que un respaldo no pueda leer rutas ajenas, que no se ejecute SQL desde archivos corruptos, que un fallo no se presente como éxito y que el proceso de publicación trate los inputs como datos no confiables.

Una vez cerrados esos riesgos, conviene invertir en pruebas de migraciones, CI y UX. La oportunidad de producto está en integrar el ciclo completo de trabajo con bases de datos —explorar, consultar, diseñar, comparar, migrar, respaldar y auditar— con seguridad y trazabilidad como características centrales.

**Regla de oro:** primero proteger los datos y la confianza del usuario; después optimizar la experiencia; finalmente ampliar el alcance del producto.


### Iteración visual: editor SQL e inspector de tablas (2026-11-03)

- [x] Jerarquía visual del workbench SQL, editor, resultados, inspector y grid mediante atributos semánticos y tokens Forja.
- [ ] Validación visual multiplataforma y CI del último commit.


### Iteración visual: diagramas y editores de objetos SQL (2026-11-03)

- [x] Unificar el encabezado y la barra de herramientas del diagrama ER y del diseñador de esquemas.
- [x] Homogeneizar el encabezado, editor CodeMirror e inspector lateral de triggers, procedimientos y funciones.
- [x] Aplicar estilos mediante tokens Forja para conservar la coherencia entre tema claro y oscuro.
- [x] Usar atributos semánticos en regiones de toolbar y contenido para evitar selectores dependientes del orden condicional de elementos.
- [x] Adaptar el inspector lateral de los editores de objetos a ventanas estrechas sin eliminar información ni acciones.
- [ ] Validar interacción visual y responsive en la aplicación ejecutándose.
- [ ] Confirmar CI (frontend, Rust y PHP tunnel) sobre el último commit.


### Iteración visual: configuración, diagnósticos y operaciones (2026-11-03)

**Configuración y conexiones**
- [x] Homogeneizar preferencias, administrador de conexiones y panel de workspaces con superficies y navegación del workbench.
- [x] Mantener intactos perfiles, motores, túneles, credenciales, pruebas de conexión y operaciones de workspace.

**Diagnósticos y monitoreo**
- [x] Integrar Health Monitor, análisis de consultas lentas y visor EXPLAIN al patrón de vistas PyroStudio.
- [x] Mantener filtros, caché, exportación, navegación y acciones de diagnóstico; habilitar selección de texto en superficies principales.

**Diálogos y operaciones**
- [x] Aplicar el lenguaje visual compartido a backup/restore, importación y exportación SQL.
- [x] Conservar los flujos existentes de selección, previsualización, progreso, verificación y restauración.

**Archivos intervenidos:** `src/components/SettingsModal.tsx`, `ConnectionModal.tsx`, `WorkspaceSettings.tsx`, `HealthMonitorTab.tsx`, `SlowQueryAnalyzerTab.tsx`, `QueryPlanViewer.tsx`, `BackupRestoreModal.tsx`, `ExcelImportModal.tsx`, `SqlExportModal.tsx` y `src/App.css`.

**Validación pendiente**
- [ ] Ejecutar tests, typecheck y build del frontend sobre el HEAD resultante.
- [ ] Revisar CI completa (frontend, Rust en Linux/macOS/Windows y PHP tunnel).
- [ ] Validar en la aplicación real temas claro/oscuro, responsive, DPI, teclado, lectores de pantalla y estados de backup/restore.
- [ ] Comprobar manualmente que todas las acciones siguen accesibles y funcionales.


### Rediseño de pantalla inicial y conexiones (2026-11-03)

- [x] Sustituir la composición estrecha centrada por una página de inicio amplia y adaptable, integrada con el shell real de PyroStudio.
- [x] Incorporar hero de marca PyroStudio con identidad naranja y superficies Forja.
- [x] Añadir accesos rápidos funcionales para nueva conexión, nueva consulta, búsqueda de conexiones y paleta de comandos.
- [x] Añadir resumen calculado a partir de datos reales: conexiones guardadas, motores distintos, carpetas y perfiles de producción.
- [x] Mostrar hasta tres conexiones usadas recientemente, conectando mediante el flujo existente y conservando confirmación de producción.
- [x] Mantener el listado completo, búsqueda, agrupación por carpetas, drag-and-drop, edición, eliminación, navegación por teclado, recuperación de sesión, alertas y estados vacíos.
- [x] Mantener el tema claro/oscuro mediante tokens semánticos Forja y añadir breakpoints para escritorio, tablet y ventanas estrechas.

**Archivos:** `src/components/WelcomeView.tsx`, `src/App.css`.

**Validación pendiente:**
- [ ] Ejecutar test, typecheck y build de frontend en el HEAD actualizado.
- [ ] Revisar visualmente la pantalla en tema oscuro y claro con conexiones reales, lista vacía, carpetas, errores y perfiles de producción.
- [ ] Verificar la adaptación en ventanas de 320–600 px, tablet y escritorio, además de escalado DPI.
- [ ] Confirmar accesibilidad por teclado y contraste de tarjetas y estados.

---

## Rediseño de workspaces analíticos y norma visual Forja (2026-11-03)

### Implementado

- [x] Dashboard: añadir identidad semántica de workspace y regiones identificables para cabecera, resumen de base de datos, telemetría en vivo y almacenamiento.
- [x] Dashboard: normalizar jerarquía y composición con superficies Forja, métricas compactas y tabla de almacenamiento como contenido central.
- [x] Schema Diff: estructurar la vista como workspace de comparación, con cabecera, configuración origen/destino, resumen de diferencias y región de resultados claramente identificados.
- [x] Schema Diff: conservar la clasificación semántica de cambios y las acciones existentes de revisión con IA, generación, previsualización, copia, descarga y apertura de SQL.
- [x] Data Compare: estructurar el comparador con dos paneles de contexto equivalentes, configuración, resultados y barra de acciones/filtros identificables.
- [x] Aplicar estilos responsive específicos para dashboard, comparación de esquemas y comparación de datos, usando tokens Forja existentes.
- [x] Crear `docs/DESIGN_GUIDE.md` como norma visual obligatoria para todas las vistas nuevas y existentes: tokens, jerarquía, composición por tipo de tarea, accesibilidad, responsive, CSS y checklist de aceptación.
- [x] Vincular la guía desde `AGENTS.md` para que desarrolladores y agentes la sigan en cualquier cambio de interfaz.
- [x] Mantener explícitamente la distinción entre vistas analíticas y workspaces de edición: SQL Editor, Table Viewer, Object Browser, Index Manager, diagramas y diseñadores no deben convertirse en dashboards genéricos.

### Archivos modificados

- `src/components/DashboardTab.tsx`
- `src/components/SchemaDiffTab.tsx`
- `src/components/DataCompareTab.tsx`
- `src/App.css`
- `docs/DESIGN_GUIDE.md` (nuevo)
- `AGENTS.md`

### Validación pendiente

- [ ] Ejecutar `npm run build`, `npm test` y las verificaciones de formato/lint disponibles en el proyecto.
- [ ] Revisar visualmente Dashboard, Schema Diff y Data Compare en tema oscuro y claro.
- [ ] Validar estados loading, error, vacío, comparación sin diferencias, resultados extensos y operaciones en curso.
- [ ] Verificar el apilado de origen/destino y las tablas en ventanas estrechas, medianas y escritorio.
- [ ] Comprobar que todos los controles mantienen navegación por teclado, foco visible y etiquetas accesibles.
- [ ] Consultar el resultado final de todos los jobs de GitHub Actions antes de declarar CI exitosa.

