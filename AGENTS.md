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
# src-tauri/target/release/bundle/dmg/Pyro Studio_0.1.0_*.dmg
```
> **Nota crítica para macOS:** En macOS **NO** se debe usar `--no-bundle` para generar la aplicación de usuario. Los binarios UNIX planos (Mach-O) carecen de estructura de bundle (`Info.plist` y `icon.icns`), lo que provoca que Finder los reconozca como scripts de consola, abra `Terminal.app` antes de ejecutarlos y muestre el ícono genérico de terminal en lugar del ícono de la app. Con `npx tauri build`, Tauri genera el `.app` gráfico nativo que se abre directamente sin terminal y con su ícono en alta resolución.

---

## 🏛️ Arquitectura del Proyecto

**PyroStudio** es un cliente moderno, ultra rápido y ligero para MariaDB y MySQL, construido sobre **Tauri v2 (Rust)** y **React 19 (TypeScript + Tailwind CSS)**.

```text
Tauri Commands (mod.rs)
      ↓
Application Services (service.rs)
      ↓
Domain Modules (connection, database, table, row, routine, trigger, index, safe_mode)
      ↓
Database Abstraction (trait DatabaseBackend)
      ↓
┌───────────────────────┴───────────────────────┐
│ DirectBackend (SQLx)   TunnelBackend (Navicat) │
└───────────────────────────────────────────────┘
```

### 1. Backend en Rust (`src-tauri/`)

| Módulo | Ruta | Responsabilidad |
| :--- | :--- | :--- |
| **Abstracción de Backend** | `src-tauri/src/db/backend.rs` | Trait `DatabaseBackend`, `DirectBackend` (SQLx `MySqlPool`) y `TunnelBackend` (`TunnelClient`). Desacopla las operaciones de base de datos del transporte físico. |
| **Conexiones** | `src-tauri/src/db/connection.rs` | Establecimiento de conexión, resolución segura de credenciales, `test_connection`, `connect`, `disconnect` y estado. |
| **Sesión y Estado** | `src-tauri/src/db/session.rs` / `state.rs` | `DbState` con `ActiveSession` y `SessionBackend` polimórfico. |
| **Consultas y Tipos** | `src-tauri/src/db/query.rs` | Conversión binaria de `MySqlRow` a JSON, literales seguros y vinculación de parámetros (`bind_json_value`). |
| **Bases de Datos** | `src-tauri/src/db/database.rs` | Inspección de esquemas y recuento de tablas. |
| **Tablas** | `src-tauri/src/db/table.rs` | Metadatos de tablas, columnas, detección de claves primarias, paginación, `drop_table` y `truncate_table`. |
| **Filas y Celdas** | `src-tauri/src/db/row.rs` | Edición segura de celdas con PK compuesta y eliminación de filas. |
| **Rutinas** | `src-tauri/src/db/routine.rs` | Procedimientos almacenados y funciones: listado, DDL, parámetros y ejecución. |
| **Triggers** | `src-tauri/src/db/trigger.rs` | Triggers: inspección, extracción de DDL y gestión. |
| **Índices** | `src-tauri/src/db/index.rs` | Listado de índices, creación (`ALTER TABLE ADD INDEX`) y borrado. |
| **Modo Seguro** | `src-tauri/src/db/safe_mode.rs` | Parser y clasificador sintáctico de sentencias potencialmente destructivas (`DROP`, `TRUNCATE`, `DELETE/UPDATE` sin `WHERE`, `ALTER`, `RENAME`). |
| **Servicio Coordinador** | `src-tauri/src/db/service.rs` | Capa de servicio de aplicación que orquesta `DbState` y módulos de dominio. |
| **Almacén Cifrado** | `src-tauri/src/db/credentials.rs` | Bóveda multiplataforma cifrada con AES-256-GCM y permisos POSIX restrictivos. |
| **Errores Estructurados**| `src-tauri/src/db/error.rs` | Enum `PyroError` centralizado con `thiserror`. |
| **Túnel HTTP Navicat** | `src-tauri/src/db/tunnel.rs` | Parser binario nativo endurecido para `ntunnel_mysql.php` sin panics. |
| **Comandos Tauri** | `src-tauri/src/db/mod.rs` | Exposición de comandos `#[tauri::command]` delegando limpiamente sin lógica de negocio. |
| **Motor Excel** | `src-tauri/src/excel/` | Importación y exportación de alto rendimiento con `calamine` y `rust_xlsxwriter`. |

---

### 2. Frontend en React + TypeScript (`src/`)

| Componente / Store | Ruta | Responsabilidad |
| :--- | :--- | :--- |
| **Store de Conexión** | `src/stores/connectionStore.ts` | Estado de conexión reactivo con Zustand (`connectionStatus`, `isConnecting`, `connect`, `disconnect`). |
| **Store de Esquema** | `src/stores/schemaStore.ts` | Estado reactivo de esquemas (`databases`, `tables`, `routines`, `triggers`, `selectedDatabase`). |
| **Store de UI** | `src/stores/uiStore.ts` | Pestañas activas (`tabs`, `activeTabId`), modales y versiones de perfiles. |
| **Store de Preferencias** | `src/stores/preferenceStore.ts` | Configuración de Modo Seguro (`safeModeEnabled`) con persistencia local. |
| **Historial de Consultas** | `src/services/queryHistoryStorage.ts` | Registro cronológico persistente de consultas ejecutadas (límite de 2,000 registros, FIFO). |
| **Favoritos / Snippets** | `src/services/favoritesStorage.ts` | Guardado, categorización y búsqueda de consultas SQL frecuentes con presets de diagnóstico. |
| **Modal Modo Seguro** | `src/components/SafeExecutionModal.tsx` | Advertencia interactiva para sentencias destructivas con vista previa de SQL y confirmación obligatoria. |
| **Modal de Historial** | `src/components/QueryHistoryModal.tsx` | Visor, filtro por texto/estado/base de datos, copia y re-ejecución inmediata. |
| **Modal de Favoritos** | `src/components/FavoritesModal.tsx` | Catálogo de snippets categorizados con creación, edición, copia y ejecución directa. |
| **Editor de Consultas** | `src/components/QueryEditorTab.tsx` | Editor SQL CodeMirror con soporte para Modo Seguro, cancelación, estados explícitos de ejecución y Glide Data Grid. |
| **Modal de Conexión** | `src/components/ConnectionModal.tsx` | Gestión de perfiles (crear, editar, duplicar, probar, conectar, eliminar) con credenciales protegidas. |

---

## 🔐 Reglas de Seguridad y Robustez de Arquitectura

1. **Almacenamiento Seguro de Credenciales (Vault Cifrado AES-256-GCM Multiplataforma):**
   * Las contraseñas **NUNCA** deben guardarse en `localStorage` del frontend.
   * El frontend solo almacena un `credentialId` y Rust administra el secreto mediante un almacén cifrado local con AES-256-GCM y clave maestra generada con entropía del SO, con permisos POSIX restrictivos (`0700`/`0600`) en entornos Unix. No depende de demonios de SO como Windows Credential Manager, GNOME Keyring o Keychain de macOS.
2. **Nunca Exponer Secretos al Frontend:**
   * Las estructuras de respuesta IPC como `ConnectionInfo` y `ConnectionConfig` omiten contraseñas (`#[serde(skip_serializing)]`).
   * Nunca enviar tokens, contraseñas en texto plano o cadenas de conexión con credenciales a React.
3. **Modo Seguro (Safe Mode):**
   * El cliente y el backend detectan y clasifican sentencias de alto riesgo (`DROP`, `TRUNCATE`, `DELETE` o `UPDATE` sin cláusula `WHERE`).
   * Para operaciones críticas, se requiere confirmación explícita antes de enviar la instrucción al motor.
4. **Seguridad en Tablas y Claves Primarias:**
   * Si una tabla no tiene Primary Key: **UPDATE y DELETE quedan estrictamente bloqueados** tanto en el backend (`PyroError::NoPrimaryKey`) como en la UI (banner informativo visible y celdas `readonly`).
   * **NUNCA** usar la primera columna como fallback de Primary Key.
   * Se soportan **Claves Primarias Compuestas** mediante `PrimaryKey` y `PrimaryKeyCondition[]` (`UPDATE table SET ... WHERE col1=? AND col2=?`).
5. **Aislamiento de Sesión en Pool de Conexiones:**
   * Nunca ejecutar `USE database` sobre el pool compartido sin reservar la conexión (`conn.acquire()`).
   * Para evitar inconsistencias de conexión cruzada, calificar las consultas con identificadores escapados (`qualify_table(db, table)`).
6. **Protección contra Resultados Gigantes:**
   * Las consultas interactivas están limitadas a un máximo de 5,000 filas para proteger el consumo de memoria del Webview y evitar bloqueos en el hilo de renderizado.
   * Las exportaciones a Excel operan por **streaming directo a disco** sin pasar por intermediarios JSON en React ni límites interactivos.

---

## 🧪 Pruebas Automatizadas y CI

* **Pruebas en Rust:** `cargo test --manifest-path src-tauri/Cargo.toml`
* **Pruebas en Frontend:** `npm test` (ejecutado con Vitest)
* **Verificación de Formato Rust:** `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
* **Verificación de Compilación Rust:** `cargo check --manifest-path src-tauri/Cargo.toml`
* **Compilación Frontend:** `npm run build`
* **CI Pipeline:** Configurado en `.github/workflows/ci.yml`.
