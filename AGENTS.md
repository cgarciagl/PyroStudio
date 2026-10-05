# 🛡️ Guía de Desarrollo e Instrucciones para Agentes (AGENTS.md)

Este documento contiene las reglas críticas de compilación, arquitectura del sistema y directrices de desarrollo para **PyroStudio**. Cualquier agente o desarrollador que modifique este repositorio **DEBE LEER Y SEGUIR ESTAS INSTRUCCIONES**.

---

## ⚠️ REGLAS CRÍTICAS DE COMPILACIÓN (LEER PRIMERO)

### ❌ NUNCA compilar binarios de producción con `cargo build` directo
* **Motivo:** En Tauri v2, ejecutar `cargo build --release` directamente en la carpeta `src-tauri` **NO incrusta los archivos estáticos del frontend (`dist/`)** dentro del binario ejecutable. Esto provoca que la ventana Webview busque el servidor de desarrollo de Vite en `http://localhost:1420` y lance el error:
  `"Vaya... no se puede acceder a esta página. localhost rechazó la conexión. ERR_CONNECTION_REFUSED"`.

### ✅ COMANDO OBLIGATORIO PARA COMPILAR EL EJECUTABLE
Siempre ejecuta el pipeline oficial de Tauri desde la raíz del proyecto (`C:\Sistemas\Repos\PyroStudio`):

```powershell
# 1. Verificar TypeScript y compilar frontend
npm run build

# 2. Compilar el ejecutable autónomo con assets embebidos
npx tauri build --no-bundle

# 3. Copiar el binario generado a la raíz del repositorio
Copy-Item -Path "src-tauri\target\release\pyro-studio.exe" -Destination "PyroStudio.exe" -Force
```

---

## 🏛️ Arquitectura del Proyecto

**PyroStudio** es un cliente moderno, ultra rápido y ligero para MariaDB y MySQL, construido sobre **Tauri v2 (Rust)** y **React 18 (TypeScript + Tailwind CSS)**.

### 1. Backend en Rust (`src-tauri/`)

| Módulo | Ruta | Descripción |
| :--- | :--- | :--- |
| **Modelos** | `src-tauri/src/db/models.rs` | Estructuras de configuración sanitizadas, esquemas, tablas, columnas, túnel HTTP, rutinas, triggers, `PrimaryKey` y `PrimaryKeyCondition`. |
| **Almacén de Credenciales** | `src-tauri/src/db/credentials.rs` | Almacén cifrado multiplataforma (AES-256-GCM) sin dependencias de demonios de SO, compatible con Windows, Linux y macOS. |
| **Errores Estructurados**| `src-tauri/src/db/error.rs` | Enum de error centralizado `PyroError` con `thiserror` y serialización segura para IPC de Tauri. |
| **Utilidades SQL** | `src-tauri/src/db/sql_utils.rs` | Funciones centralizadas para escape y validación segura de identificadores (`quote_identifier`, `qualify_table`). |
| **Estado y Sesión** | `src-tauri/src/db/state.rs` | `DbState` con `ActiveSession` y `SessionBackend` que soporta `Direct(MySqlPool)` y `Tunnel(TunnelClient)`. |
| **Túnel HTTP Navicat** | `src-tauri/src/db/tunnel.rs` | Parser binario nativo endurecido para `ntunnel_mysql.php` sin panics, con suite de pruebas unitarias automatizadas. |
| **Servicio de Base de Datos** | `src-tauri/src/db/service.rs` | Ejecutor unificado con límite interactivo (5,000 filas), gestión de conexiones aisladas (sin fugas de `USE db`), edición de celdas con PK compuesta y borrado seguro de registros. |
| **Comandos Tauri** | `src-tauri/src/db/mod.rs` | Exposición de comandos `#[tauri::command]` para frontend. |
| **Motor Excel** | `src-tauri/src/excel/` | Importación y exportación de hojas de cálculo de alto rendimiento con `calamine` y `rust_xlsxwriter` (streaming directo sin sobrecargar React). |
| **Punto de Entrada** | `src-tauri/src/lib.rs` | Registro de plugins y todos los invoke handlers en `generate_handler!`. |

---

## 🔐 Reglas de Seguridad y Robustez de Arquitectura (P0)

1. **Almacenamiento Seguro de Credenciales (Vault Cifrado AES-256-GCM Multiplataforma):**
   * Las contraseñas **NUNCA** deben guardarse en `localStorage` del frontend.
   * El frontend solo almacena un `credentialId` y Rust administra el secreto mediante un almacén cifrado local con AES-256-GCM y clave maestra generada con entropía del SO, con permisos POSIX restrictivos (`0700`/`0600`) en entornos Unix. No depende de demonios de SO como Windows Credential Manager, GNOME Keyring o Keychain de macOS.
2. **Nunca Exponer Secretos al Frontend:**
   * Las estructuras de respuesta IPC como `ConnectionInfo` y `ConnectionConfig` omiten contraseñas (`#[serde(skip_serializing)]`).
   * Nunca enviar tokens, contraseñas en texto plano o cadenas de conexión con credenciales a React.
3. **Seguridad en Tablas y Claves Primarias:**
   * Si una tabla no tiene Primary Key: **UPDATE y DELETE quedan estrictamente bloqueados** tanto en el backend (`PyroError::NoPrimaryKey`) como en la UI (banner informativo visible y celdas `readonly`).
   * **NUNCA** usar la primera columna como fallback de Primary Key.
   * Se soportan **Claves Primarias Compuestas** mediante `PrimaryKey` y `PrimaryKeyCondition[]` (`UPDATE table SET ... WHERE col1=? AND col2=?`).
4. **Aislamiento de Sesión en Pool de Conexiones:**
   * Nunca ejecutar `USE database` sobre el pool compartido sin reservar la conexión (`conn.acquire()`).
   * Para evitar inconsistencias de conexión cruzada, calificar las consultas con identificadores escapados (`qualify_table(db, table)`).
5. **Protección contra Resultados Gigantes:**
   * Las consultas interactivas están limitadas a un máximo de 5,000 filas para proteger el consumo de memoria del Webview y evitar bloqueos en el hilo de renderizado.
   * Las exportaciones a Excel operan por **streaming directo a disco** sin pasar por intermediarios JSON en React ni límites interactivos.
6. **Resiliencia del Parser del Túnel:**
   * Toda lectura de bytes del túnel valida longitudes y límites con `try_into()` sin llamadas a `.unwrap()`.
   * Datos corruptos o truncados del servidor **NUNCA** deben causar un panic en Rust.

---

### 2. Frontend en React + TypeScript (`src/`)

| Componente / Servicio | Ruta | Responsabilidad |
| :--- | :--- | :--- |
| **Servicio de Base de Datos** | `src/services/tauriDb.ts` | Wrapper en TypeScript para invocar todos los comandos nativos de Tauri. |
| **Almacenamiento Local** | `src/services/connectionStorage.ts` | Gestión y persistencia de perfiles de conexión en `localStorage` (soporta conexiones directas y túneles HTTP). |
| **Modal de Conexión** | `src/components/ConnectionModal.tsx` | Ventana de perfiles con pestañas para **Conexión Directa TCP** y **🌐 Túnel HTTP (Navicat)**. |
| **Explorador Lateral** | `src/components/Sidebar.tsx` | Árbol jerárquico por base de datos: 📁 Tablas, 📁 Procedimientos, 📁 Funciones y 📁 Triggers con botones de creación rápida `+`. |
| **Editor de Consultas** | `src/components/QueryEditorTab.tsx` | Editor SQL CodeMirror con **edición interactiva de celdas en vivo** y pestaña de **Explicar Plan (EXPLAIN)**. |
| **Visualizador EXPLAIN** | `src/components/QueryPlanViewer.tsx` | Diagnóstico de rendimiento (alertas de Full Table Scan 🔴, Index Lookups 🟢 y desglose tabular). |
| **Editor de Rutinas** | `src/components/RoutineEditorTab.tsx` | Editor de DDL para Stored Procedures y Functions con inspector de parámetros y **modal interactivo de prueba/ejecución con argumentos**. |
| **Editor de Triggers** | `src/components/TriggerEditorTab.tsx` | Editor DDL para Triggers con inspector de tabla objetivo, timing (`BEFORE`/`AFTER`) y evento (`INSERT`/`UPDATE`/`DELETE`). |
| **Creador de Tablas** | `src/components/CreateTableModal.tsx` | Diseñador visual de nuevas tablas con motores (`InnoDB`, `Aria`), collation y editor de columnas. |
| **Visor de Tablas** | `src/components/TableViewer.tsx` | Visualizador de registros y diseñador de columnas con `ALTER TABLE ADD/CHANGE/DROP COLUMN`. |
| **Gestor de Pestañas** | `src/components/TabManager.tsx` | Pestañas dinámicas para tablas, consultas, procedimientos, funciones y triggers. |

---

## 🎯 Protocolo de Túnel HTTP (`ntunnel_mysql.php`)

PyroStudio es 100% compatible con el script oficial de Navicat `ntunnel_mysql.php`:
1. **Acción `actn=C`**: Prueba de conexión que retorna versión del servidor, host info e info del protocolo.
2. **Acción `actn=Q`**: Ejecución de una o múltiples consultas enviadas en `q[]` (con opción `encodeBase64=1` para bypass de firewalls y WAFs).
3. **Estructura de Paquetes**:
   * Cabecera de 16 bytes: `[1111 (u32 BE)] [version (u16 BE)] [errno (u32 BE)] [6 bytes dummy]`.
   * Bloques de datos: `[longitud < 254 ? 1 byte : 0xFE + 4 bytes BE] [datos UTF-8]`.
   * Celdas NULL: Byte `0xFF`.

---

## 🎨 Guía de Estilos y Diseño (Pyro Dark Theme)

Mantener la coherencia visual en todos los nuevos componentes:
* **Fondo principal:** `#0a0b0e` / `#0c0e14`
* **Superficies / Paneles:** `#10131a` / `#121520` / `#141824`
* **Bordes:** `#1e2333` / `#262c3e`
* **Color de Acento (Pyro Orange):** `#ff5c16` / `#ea580c`
* **Tipografías:**
  * UI general: `font-sans` (Inter/System)
  * Nombres de tablas, columnas, código SQL y valores: `font-mono`

---

## 🧪 Checklist para Modificaciones

Antes de dar una tarea por terminada:
- [ ] Ejecutar `npm run build` y asegurar **cero errores de TypeScript y bundling**.
- [ ] Compilar con `npx tauri build --no-bundle`.
- [ ] Copiar `src-tauri\target\release\pyro-studio.exe` a `PyroStudio.exe`.
- [ ] Confirmar que el ejecutable resultante tiene un tamaño superior a ~14 MB (indicativo de que los assets de `dist` están incrustados).
