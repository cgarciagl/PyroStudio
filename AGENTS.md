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
npx tauri build --no-bundle

# 3. Copiar el binario generado a la raíz del repositorio
Copy-Item -Path "src-tauri\target\release\pyro-studio.exe" -Destination "PyroStudio.exe" -Force
```

#### En macOS (Terminal / Zsh / Bash):
```bash
# 1. Verificar TypeScript y compilar frontend
npm run build

# 2. Compilar el paquete de aplicación nativa (.app y .dmg) con íconos e Info.plist embebidos
npx tauri build

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

## 🧪 Pruebas Automatizadas y CI

* **Pruebas en Rust:** `cargo test --manifest-path src-tauri/Cargo.toml`
* **Pruebas en Frontend:** `npm test` (ejecutado con Vitest)
* **Verificación de Formato Rust:** `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
* **Verificación de Compilación Rust:** `cargo check --manifest-path src-tauri/Cargo.toml`
* **Compilación Frontend:** `npm run build`
* **CI Pipeline:** Configurado en `.github/workflows/ci.yml`.
