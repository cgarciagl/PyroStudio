# 🛡️ Guía de Desarrollo e Instrucciones para Agentes (AGENTS.md)

Este documento contiene las reglas críticas de compilación, arquitectura del sistema y directrices de desarrollo para **PyroStudio**. Cualquier agente o desarrollador que modifique este repositorio **DEBE LEER Y SEGUIR ESTAS INSTRUCCIONES**.

---

## ⚠️ REGLAS CRÍTICAS DE COMPILACIÓN (LEER PRIMERO)

### ❌ NUNCA compilar binarios de producción con `cargo build` directo
* **Motivo:** En Tauri v2, ejecutar `cargo build --release` directamente en la carpeta `src-tauri` **NO incrusta los archivos estáticos del frontend (`dist/`)** dentro del binario ejecutable. Esto provoca que la ventana Webview busque el servidor de desarrollo de Vite en `http://localhost:1420` y lance el error:
  `"Vaya... no se puede acceder a esta página. localhost rechazó la conexión. ERR_CONNECTION_REFUSED"`.

### ✅ COMANDOS OBLIGATORIOS PARA COMPILAR EL EJECUTABLE

#### En Windows (PowerShell):
```powershell
# 1. Verificar TypeScript y compilar frontend
npm run build

# 2. Compilar el ejecutable autónomo con assets embebidos
npm run tauri:build -- --no-bundle

# 3. Copiar el binario generado a la raíz del repositorio
Copy-Item -Path "src-tauri\target\release\pyro-studio.exe" -Destination "PyroStudio.exe" -Force
```

#### En macOS (Terminal / Zsh / Bash):
```bash
# 1. Verificar TypeScript y compilar frontend
npm run build

# 2. Compilar el paquete de aplicación nativa (.app y .dmg) con íconos e Info.plist embebidos
npm run tauri:build

# La app empaquetada estará en:
# src-tauri/target/release/bundle/macos/Pyro Studio.app
# El instalador estará en:
# src-tauri/target/release/bundle/dmg/Pyro Studio_0.1.1_*.dmg
```
> **Nota crítica para macOS:** En macOS **NO** se debe usar `--no-bundle` para generar la aplicación de usuario. Los binarios UNIX planos (Mach-O) carecen de estructura de bundle (`Info.plist` y `icon.icns`), lo que provoca que Finder los reconozca como scripts de consola, abra `Terminal.app` antes de ejecutarlos y muestre el ícono genérico de terminal en lugar del ícono de la app. Con `npx tauri build`, Tauri genera el `.app` gráfico nativo que se abre directamente sin terminal y con su ícono en alta resolución.

---

## 🌿 Flujo de Git

* **NO crear ramas nuevas** salvo que el usuario lo indique explícitamente. Trabaje sobre la rama actual.
* No hacer commit, merge ni push sin que el usuario lo pida.

### Fuente única de versión y procedimiento obligatorio de release

**Principio:** `package.json` es la única fuente de verdad de la versión. El tag Git identifica la versión que se libera, pero nunca debe utilizarse para sobrescribir o corregir automáticamente la versión del proyecto.

#### Archivos y sincronización

- La versión se define exclusivamente en `package.json`.
- `src-tauri/tauri.conf.json` obtiene la versión desde `../package.json`; no escribir una versión literal en ese archivo.
- `src-tauri/Cargo.toml` y la entrada del paquete raíz `pyro-studio` en `src-tauri/Cargo.lock` deben coincidir con `package.json`. La sincronización se realiza con `npm run version:sync`.
- `npm run version:check` comprueba la consistencia sin modificar archivos y debe pasar antes de liberar.
- Usar `npm run tauri:dev` y `npm run tauri:build` para ejecutar Tauri: estos comandos sincronizan la versión antes de invocarlo. No usar `npx tauri` directamente.

#### Procedimiento para publicar una versión

Realizar estos pasos en orden:

1. **Preparar la rama de release.** Trabajar desde `main`, actualizarla con el remoto y confirmar que el árbol de trabajo está limpio. No iniciar una release con cambios sin commit.
   ```bash
   git switch main
   git pull --ff-only origin main
   git status
   ```
2. **Ejecutar las comprobaciones previas.** Verificar consistencia de versiones y ejecutar las pruebas/build de frontend. Resolver cualquier error antes de incrementar la versión.
   ```bash
   npm ci
   npm run version:check
   npm test
   npm run build
   ```
3. **Incrementar la versión con npm.** Elegir el incremento SemVer apropiado:
   ```bash
   npm version patch
   # O, según el alcance del cambio:
   npm version minor
   npm version major
   # También se permite una versión explícita, por ejemplo:
   # npm version 1.2.3
   ```
   `npm version` actualiza `package.json` y `package-lock.json`, ejecuta el lifecycle `version` que sincroniza Cargo, y crea automáticamente el commit y el tag Git correspondiente (por ejemplo, `v0.1.2`). **No editar manualmente los archivos de versión, no crear otro commit de versión y no crear manualmente un tag duplicado.**
4. **Comprobar el resultado antes de publicarlo.**
   ```bash
   npm run version:check
   git status
   git show --stat --oneline HEAD
   git tag --points-at HEAD
   ```
   Confirmar que la versión de `package.json`, Cargo y el tag `vX.Y.Z` coinciden, y que el commit/tag apuntan al cambio que se desea liberar.
5. **Publicar el commit y el tag juntos.**
   ```bash
   git push origin main --follow-tags
   ```
6. **Verificar GitHub Actions.** Abrir la pestaña Actions del repositorio y comprobar que el workflow de release se ejecutó para el tag esperado y terminó correctamente. No anunciar ni distribuir la release mientras el workflow esté en cola, en ejecución o haya fallado. Revisar los logs y corregir el problema antes de reintentar.
7. **Verificar la release publicada.** Confirmar que GitHub creó la release para el tag correcto y que los artefactos esperados están adjuntos y pueden descargarse. La versión mostrada por la aplicación debe corresponder a la versión empaquetada.

#### Reglas del workflow de release

- `.github/workflows/release.yml` se dispara exclusivamente al publicar/pushear tags que cumplan el patrón `v*.*.*`; no tiene ejecución manual mediante `workflow_dispatch`.
- El job de validación comprueba que el tag sea SemVer válido y coincida exactamente con `v${package.json.version}`. Si hay discrepancia, el workflow debe detenerse **antes de compilar**. Nunca modificar `package.json` para adaptarlo silenciosamente al tag.
- El build sincroniza Cargo antes de compilar y utiliza el tag ya validado para nombrar la release y sus artefactos.
- No crear la release manualmente desde la interfaz de GitHub ni subir artefactos de una compilación local como sustituto del workflow. El workflow es el mecanismo oficial de publicación.
- Si se necesita corregir una release fallida, primero diagnosticar el fallo. No reutilizar un tag que ya apunte a otro commit ni mover tags publicados sin revisar expresamente las consecuencias; preparar una nueva versión/tag cuando corresponda.

**Ejemplo:** si la versión actual es `0.1.1`, ejecutar `npm version patch` produce `0.1.2` y el tag `v0.1.2`. Al ejecutar `git push origin main --follow-tags`, GitHub recibe ambos y el workflow valida que el tag y `package.json` coincidan antes de generar los instaladores.


---

## 🏛️ Arquitectura del Proyecto

**PyroStudio** es un cliente moderno, ultra rápido y ligero para MariaDB y MySQL, construido sobre **Tauri v2 (Rust)** y **React 19 (TypeScript + Tailwind CSS)**.

Capas: comandos Tauri (`src-tauri/src/db/mod.rs`, sin lógica de negocio) → servicio (`service.rs`) → módulos de dominio → trait `DatabaseBackend` (`DirectBackend` SQLx / `TunnelBackend` HTTP-PHP).

* **Workspaces:** ver `docs/WORKSPACES.md`. `connectionStorage`/`favoritesStorage` delegan en el workspace cuando hay una carpeta activa (métodos async `persist*`/`remove*`).

---

## 🔐 Reglas de Seguridad y Robustez de Arquitectura

1. **Almacenamiento Seguro de Credenciales (Vault Cifrado AES-256-GCM Multiplataforma):**
   * Las contraseñas **NUNCA** deben guardarse en `localStorage` del frontend.
   * El frontend solo almacena un `credentialId` y Rust administra el secreto mediante un almacén cifrado local con AES-256-GCM y clave maestra generada con entropía del SO. La clave maestra se guarda en el llavero del sistema (Windows Credential Manager, Keychain de macOS, Secret Service en Linux) y **nunca** junto a `secrets.vault`. Si no hay llavero, se usa `master.key` con permisos `0600` y la UI lo avisa (`get_vault_status`); nunca se degrada en silencio ni se regenera la clave sobre un vault existente.
2. **Nunca Exponer Secretos al Frontend:**
   * Las estructuras de respuesta IPC como `ConnectionInfo` y `ConnectionConfig` omiten contraseñas (`#[serde(skip_serializing)]`).
   * Nunca enviar tokens, contraseñas en texto plano o cadenas de conexión con credenciales a React.
3. **Modo Seguro (Safe Mode):**
   * El cliente y el backend detectan y clasifican sentencias de alto riesgo (`DROP`, `TRUNCATE`, `DELETE` o `UPDATE` sin cláusula `WHERE`).
   * Para operaciones críticas, se requiere confirmación explícita antes de enviar la instrucción al motor.
4. **Seguridad en Tablas y Claves Primarias:**
   * Si una tabla tiene Primary Key definida (simple o compuesta), se utiliza de forma directa (`PrimaryKey` y `PrimaryKeyCondition[]`).
   * Si una tabla **no tiene Primary Key**, el comportamiento es configurable por el usuario mediante Preferencias (`noPrimaryKeyMode`):
     - **Modo Fila Completa (por defecto):** Trata todos los campos de la fila como criterio identificador compuesto con cláusula `WHERE col1 <=> val1 ... LIMIT 1` (con soporte riguroso de `IS NULL` y límite a 1 fila), permitiendo la edición y eliminación interactiva de forma segura.
     - **Modo Estricto:** Bloquea las operaciones de modificación y eliminación en tablas sin clave primaria (`PyroError::NoPrimaryKey`) y mantiene las celdas en solo lectura.
   * **NUNCA** usar la primera columna como fallback arbitrario de Primary Key.
   * Se soportan **Claves Primarias Compuestas** nativamente en backend y frontend.
5. **Aislamiento de Sesión en Pool de Conexiones:**
   * Nunca ejecutar `USE database` sobre el pool compartido sin reservar la conexión (`conn.acquire()`).
   * Para evitar inconsistencias de conexión cruzada, calificar las consultas con identificadores escapados (`qualify_table(db, table)`).
6. **Protección contra Resultados Gigantes:**
   * Las consultas interactivas están limitadas a un máximo de 5,000 filas para proteger el consumo de memoria del Webview y evitar bloqueos en el hilo de renderizado.
   * Las exportaciones a Excel operan por **streaming directo a disco** sin pasar por intermediarios JSON en React ni límites interactivos.
7. **Prohibición Estricta de Diálogos Nativos (`alert()`, `confirm()`, `prompt()`):**
   * **NUNCA** utilizar `alert()`, `confirm()`, `prompt()`, `window.alert()` ni cuadros de diálogo emergentes nativos del navegador.
   * En Tauri (especialmente sobre macOS con WebKit y Linux con WebKitGTK), los diálogos nativos se suprimen, no se renderizan o congelan el bucle de eventos del WebView.
   * Todas las alertas, avisos de error, advertencias informativas y solicitudes de confirmación **DEBEN** mostrarse en ventanas modales utilizando `ConfirmModal` o las acciones globales de UI (`useUIStore.getState().showAlert(...)` / `useUIStore.getState().showConfirm(...)`).
8. **Paridad y Reutilización Obligatoria entre Modo Tabla y Modo Consulta:**
   * El grid de datos (`DataGridCanvas.tsx`) es el componente central compartido tanto para el visor de tablas (`TableViewer.tsx`) como para los resultados del editor de consultas (`QueryEditorTab.tsx`).
   * **NUNCA** duplicar lógica de edición, guardado, borrado, inserción o menús emergentes en `QueryEditorTab.tsx` que ya esté implementada en `DataGridCanvas.tsx`.
   * **Regla de Paridad Bidireccional:** Todo desarrollador o agente que agregue, modifique o corrija una funcionalidad en el **Modo Tabla** (edición inline, cambios pendientes con barra de acciones flotante, previsualización de SQL, descarte, marcado de borrado, inserción de registros, menús contextuales, atajos de teclado, formatos de copia, etc.) **DEBE validar obligatoriamente** si dicho cambio es pertinente y aplicable en el **Modo Consulta**, y viceversa, garantizando siempre el mismo comportamiento, experiencia de usuario y arquitectura unificada.

9. **Interfaz minimalista (guía visual obligatoria):**
   * Use las primitivas de `src/components/ui/styles.ts` (`primaryBtn`, `secondaryBtn`, `ghostBtn`, `iconBtn`, `dangerBtn`, `dangerGhostBtn`, `inputClass`, `fieldLabel`, `cardClass`, `sectionLabel`, `menuPanel`, `menuItem`, `tabClass`) y los tokens de tema (`text-fg`, `text-fg-muted`, `text-fg-subtle`, `bg-surface`, `bg-raised`, `bg-hover`, `border-line`, `bg-accent`, `bg-accent-soft`, `text-accent-text`, `text-success`, `text-warning`, `text-danger`, `shadow-pop`, `shadow-modal`…) en lugar de ramas `isLight` o colores literales (`neutral-*`, `slate-*`, `orange-*`).
   * Componentes compartidos: `Modal`, `Spinner` y `EmptyState` (`src/components/ui/Modal.tsx`) para modales, cargas y vistas vacías/error; `RightDock` (`src/components/ui/RightDock.tsx`) para paneles laterales que se acoplan en pantallas anchas (`useIsWideLayout`) y se superponen en estrechas. Botones de pie de modal: `secondaryBtn` para «Cancelar» y `primaryBtn`/`dangerBtn` para la acción, siempre a la derecha.
   * Etiquetas de sección en sentence case con `sectionLabel`; sin `uppercase tracking-*`. Escala tipográfica: 11px secundario, 12px (`text-xs`) cuerpo, 14px (`text-sm`) títulos.
   * `src/components/__tests__/StyleGuide.test.ts` falla si aparecen gradientes, `shadow-[…]`, `animate-pulse`, `hover:scale-`, `backdrop-blur` o diálogos nativos.
   * **Un solo acento** (naranja) y solo para la acción principal de la vista y el estado activo. Las acciones secundarias son *ghost* (sin fondo ni borde hasta el hover); las poco frecuentes van en menús («Más», «Importar / Exportar», menú de ejecución).
   * El color **semántico** (verde éxito, ámbar advertencia, rojo peligro) se aplica al icono o a un punto, no a fondos completos, salvo confirmaciones destructivas. Los entornos se indican con un punto; solo PROD/staging tiñen la interfaz.
   * Prohibido lo puramente decorativo: gradientes, brillos (`shadow-[…]`), sombras de color, iconos pulsantes, escalado en hover y pastillas de colores para información pasiva (use texto atenuado).
   * Excepción: vistas donde el color **codifica datos** (planes EXPLAIN, salud, diferencias de esquema, cambios pendientes).
   * Excepción: los **iconos de tipo de objeto** (tablas, vistas, funciones, consultas, carpetas…) usan un tinte suave fijo por tipo para reconocerlos de un vistazo. Use siempre `ObjectIcon` (`src/components/objectIcons.tsx`); no invente colores nuevos por componente.

---

## 🎨 Norma visual del producto

La guía normativa de interfaz está en [`docs/DESIGN_GUIDE.md`](docs/DESIGN_GUIDE.md) y debe leerse junto con esta sección antes de modificar cualquier vista. Aplica tanto a vistas nuevas como existentes.

- La dirección vigente es **Forja**: superficies semánticas, acento naranja, tipografía de sistema y jerarquía de IDE profesional.
- La pantalla inicial y los workspaces analíticos rediseñados son referencias de composición, no plantillas para convertir todas las vistas en dashboards.
- Dashboard y vistas de diagnóstico pueden priorizar métricas; comparadores deben priorizar origen/destino y diferencias; editores, grids, exploradores y diagramas deben mantener su contenido de trabajo como protagonista.
- Todo rediseño debe preservar íntegramente la funcionalidad y cumplir el checklist de aceptación de `docs/DESIGN_GUIDE.md`.
- Usar atributos `data-*` semánticos para el CSS; evitar selectores dependientes del orden del JSX.

## 🧪 Pruebas Automatizadas y CI

* **Pruebas en Rust:** `cargo test --manifest-path src-tauri/Cargo.toml`
* **Pruebas en Frontend:** `npm test` (ejecutado con Vitest)
* **Verificación de Formato Rust:** `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
* **Verificación de Compilación Rust:** `cargo check --manifest-path src-tauri/Cargo.toml`
* **Compilación Frontend:** `npm run build`
* **CI Pipeline:** Configurado en `.github/workflows/ci.yml`.
