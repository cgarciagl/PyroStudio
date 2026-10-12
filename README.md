```
██████╗ ██╗   ██╗██████╗  ██████╗     ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ 
██╔══██╗╚██╗ ██╔╝██╔══██╗██╔═══██╗    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
██████╔╝ ╚████╔╝ ██████╔╝██║   ██║    ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
██╔═══╝   ╚██╔╝  ██╔══██╗██║   ██║    ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
██║        ██║   ██║  ██║╚██████╔╝    ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
╚═╝        ╚═╝   ╚═╝  ╚═╝ ╚═════╝     ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ 
```

<p align="center">
  <strong>🔥 Cliente Nativo, Ultraligero y de Alto Rendimiento para MariaDB & MySQL</strong>
  <br />
  <em>Construido con Tauri v2 (Rust) + React 19 (TypeScript & Tailwind CSS)</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri_v2-24C8D5?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Zustand-443e38?style=for-the-badge&logo=react&logoColor=white" alt="Zustand" />
  <img src="https://img.shields.io/badge/MariaDB-003545?style=for-the-badge&logo=mariadb&logoColor=white" alt="MariaDB" />
  <img src="https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL" />
</p>

---

## 🌟 Características Principales

### 🌐 1. Conexión Directa, SSH y Túnel HTTP (PHP)
- **Abstracción Unificada (`DatabaseBackend`):** Los servicios de aplicación operan de forma agnóstica al transporte, soportando pools TCP directos con TLS, reenvío SSH seguro y túneles HTTP mediante script PHP (`ntunnel_mysql.php`).
- **Bypass de Firewalls y WAFs:** Soporte para empaquetado binario, cabecera mágica `1111`, codificación Base64 y autenticación HTTP Basic.
- **Gestión Avanzada de Perfiles:** Crear, editar, duplicar, probar, conectar y eliminar conexiones clasificadas por entornos (`Local`, `Dev`, `Staging`, `Prod`).

### ⚙️ 2. Ventana de Configuración y Personalización del Sistema (`Ctrl+,`)
- **Panel Centralizado de Preferencias:** Permite al usuario personalizar por completo su experiencia de trabajo:
  - **Tablas sin Clave Primaria:** Elección entre **Modo Fila Completa** (usar todos los campos de la fila como identificador único) o **Modo Estricto** (bloquear edición para evitar ambigüedades).
  - **Paginación por Defecto:** Selección de tamaño de lote (50, 100, 250, 500, 1,000 o 5,000 filas) con navegación rápida a la primera y última página (`⏮`, `◀`, `▶`, `⏭`).
  - **Editor SQL:** Ajuste de tamaño de fuente (12px a 16px), visibilidad de números de línea y autocompletado inteligente.
  - **Seguridad:** Conmutador global de Modo Seguro y confirmaciones reforzadas en servidores de Producción.
  - **IA & Modelos:** Enlace directo para configurar proveedores de IA y llaves API en bóveda cifrada.

### 🔑 3. Soporte para Tablas sin Clave Primaria (Identificación Completa)
- **Identificación de Filas sin PK:** Al editar celdas o eliminar registros en tablas sin clave primaria explícita, PyroStudio trata todos los valores originales de la fila como un criterio compuesto con cláusula `WHERE col1 <=> val1 AND ... LIMIT 1`.
- **Manejo Robusto de `NULL`:** Evaluación estricta con sintaxis `IS NULL` para garantizar que las columnas con valores nulos coincidan con exactitud.
- **Banner Interactivo en la Tabla:** La interfaz muestra un aviso informativo con botones rápidos para conmutar entre *Usar todos los campos* y *Bloquear operaciones* con un solo clic.

### 🛡️ 4. Modo Seguro (Safe Mode)
- **Protección contra Operaciones Destructivas:** Detección y análisis sintáctico de sentencias de alto riesgo:
  - `DROP TABLE`, `DROP DATABASE`, `DROP PROCEDURE`, `DROP TRIGGER`, `DROP INDEX`
  - `TRUNCATE TABLE`
  - `DELETE` o `UPDATE` sin cláusula `WHERE` (Alerta Crítica 🔴)
  - `ALTER TABLE` y `RENAME TABLE`
- **Modal de Confirmación Interactivo:** Muestra el SQL exacto, explicación del riesgo y requiere confirmación explícita (con validación de texto para operaciones masivas sin `WHERE`).
- **Conmutador Rápido:** Activa o desactiva el Modo Seguro directamente desde la barra de herramientas del editor SQL o desde la configuración.

### 📊 5. Cuadrícula de Datos de Alto Rendimiento (Canvas Grid a 60 FPS)
- **Renderizado por Hardware:** Basado en Glide Data Grid Canvas con desplazamiento ultra suave, ajuste automático inteligente del ancho de columnas y selección matricial.
- **Edición en Tiempo Real:** Modificación directa in-place de celdas con doble clic o escritura inmediata, con reflejo instantáneo en la base de datos y en el estado local.
- **Formulario Completo de Fila:** Modal interactivo para inspeccionar y editar todos los campos de un registro simultáneamente.

### 🤖 6. Asistente SQL Copilot y Búsqueda Inteligente (IA)
- **Copilot de Base de Datos:** Generación, optimización y explicación de consultas SQL con soporte para múltiples proveedores (Google Gemini, OpenAI, Claude, Ollama local y OpenRouter).
- **Modo de Privacidad Estricto (P0):** Aislamiento de metadatos para evitar fugas de información sensible de esquemas empresariales.
- **Búsqueda Semántica (`Ctrl+K`):** Localización instantánea de tablas, campos y rutinas en esquemas masivos.
- **Generador de Reportes:** Creación automática de diccionarios de datos e informes de salud del servidor en Markdown.

### 📜 7. Historial de Consultas & Favoritos SQL
- **Historial Persistente Capped (FIFO):** Guarda cronológicamente hasta 2,000 consultas con timestamp, base de datos, tiempo de respuesta en ms, filas afectadas y estado de éxito/error.
- **Búsqueda y Re-ejecución:** Búsqueda rápida por texto o base de datos, filtrado por éxito/error, copia al portapapeles y re-ejecución con un clic.
- **Snippets y Favoritos:** Catálogo organizado por categorías (`Diagnóstico`, `Usuarios`, `Reportes`, `Administración`, `Rendimiento`) con presets útiles para administración del servidor.

### 📈 8. Motor Excel Integrado (Importación & Exportación Directa por Streaming)
- **Asistente de Importación de 5 Pasos:** Detección automática con `calamine`, mapeo de llaves primarias/compuestas (🔑), 6 modos de sincronización y barra de progreso en vivo.
- **Exportación Estilizada Directa a Disco:** Exportación de tablas y consultas a `.xlsx` a máxima velocidad con `rust_xlsxwriter` por streaming directo, sin saturar la memoria del WebView.

### 🔍 9. Diagnósticos Avanzados: EXPLAIN, Index Advisor & Schema Diff
- **Plan de Ejecución Visual (EXPLAIN):** Diagnóstico visual de consultas SQL con alertas de rendimiento (Full Table Scan 🔴, Index Lookups 🟢) y desglose tabular.
- **Asesor de Índices (Index Advisor):** Detección heurística de índices redundantes o con prefijo duplicado y recomendaciones de optimización.
- **Comparador de Esquemas (DDL Diff):** Detección visual de diferencias entre estructuras de bases de datos y generación de scripts de migración.

### ⚡ 10. Editor de Rutinas, Triggers y Respaldos
- **Procedimientos y Funciones:** Editor DDL con inspector de parámetros y modal interactivo de ejecución con argumentos.
- **Triggers:** Inspector DDL con timing (`BEFORE`/`AFTER`), eventos y tabla asociada.
- **Backups y Restauración:** Generación y ejecución de volcados SQL (`.sql`) con soporte para delimitadores personalizados.

### 🔐 11. Seguridad y Bóveda Cifrada Multiplataforma (P0)
- **Almacén Cifrado AES-256-GCM:** Cero contraseñas en texto plano en `localStorage`. Clave maestra de 256 bits generada con entropía del SO, con permisos POSIX restrictivos (`0700`/`0600`) en Unix y compatibilidad multiplataforma.
- **Respuestas IPC Sanitizadas:** Todas las estructuras de conexión omiten secretos (`#[serde(skip_serializing)]`).

---

## ⌨️ Atajos de Teclado Principales

| Atajo | Acción | Descripción |
| :--- | :--- | :--- |
| `Ctrl + ,` | **Configuración** | Abrir la ventana de configuración y preferencias del usuario |
| `Ctrl + K` | **Smart Search** | Búsqueda inteligente en esquemas, tablas y columnas |
| `Ctrl + P` / `Ctrl + Shift + P` | **Command Palette** | Paleta de comandos global estilo VS Code |
| `F1` | **Atajos de Teclado** | Panel de ayuda con todos los atajos disponibles |
| `Ctrl + Enter` | **Ejecutar SQL** | Ejecutar la consulta en la pestaña activa |
| `Ctrl + Shift + Enter` | **EXPLAIN Plan** | Analizar el plan de ejecución de la consulta |
| `Ctrl + H` | **Historial** | Abrir el registro cronológico de consultas ejecutadas |
| `Ctrl + S` | **Favoritos** | Guardar consulta SQL actual en favoritos |
| `Ctrl + N` | **Nueva Consulta** | Abrir una pestaña de editor SQL vacía |
| `Ctrl + Shift + A` | **Ajustes de IA** | Configurar modelos y proveedores del asistente Copilot |
| `F5` / `Ctrl + R` | **Refrescar** | Recargar esquemas, tablas y vistas |

---

## 🚀 Inicio Rápido

### Requisitos Previos
- [Node.js](https://nodejs.org/) (v18 o superior)
- [Rust](https://www.rust-lang.org/) (versión stable 1.78+)
- Compilador de C/C++ según la plataforma:
  - **Windows:** MSVC C++ Build Tools (Visual Studio Installer)
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux:** `build-essential`, `libwebkit2gtk-4.1-dev`, `libssl-dev`

### Instalación de Dependencias
```powershell
npm install
```

### Ejecutar Pruebas Automatizadas
```powershell
# Pruebas unitarias de Rust
cargo test --manifest-path src-tauri/Cargo.toml

# Pruebas unitarias del frontend (Vitest)
npm test
```

### Modo de Desarrollo
```powershell
npm run dev
# o con Tauri CLI
npx tauri dev
```

---

## 🏗️ Compilación para Producción (Pipeline Obligatorio)

> [!IMPORTANT]
> En Tauri v2, **nunca** compilar binarios de producción con `cargo build --release` directamente en `src-tauri`. Siempre se debe utilizar el pipeline de compilación de Tauri para incrustar los activos estáticos del frontend (`dist/`) dentro del ejecutable.

### En Windows (PowerShell):
```powershell
# 1. Compilar frontend (Vite + TypeScript)
npm run build

# 2. Compilar binario autónomo de Tauri con assets embebidos
npx tauri build --no-bundle

# 3. Copiar el ejecutable generado a la raíz del repositorio
Copy-Item -Path "src-tauri\target\release\pyro-studio.exe" -Destination "PyroStudio.exe" -Force
```

### En macOS (Terminal / Zsh / Bash):
```bash
# 1. Compilar frontend (Vite + TypeScript)
npm run build

# 2. Compilar bundle de aplicación gráfica nativa (.app y .dmg con ícono e Info.plist)
npx tauri build
```
*(En macOS, `npx tauri build` genera la aplicación en `src-tauri/target/release/bundle/macos/Pyro Studio.app`. No se debe usar `--no-bundle` en Mac, ya que los binarios Mach-O planos abren una ventana de Terminal).*

---

## 📁 Estructura del Proyecto

```text
PyroStudio/
├── src-tauri/                 # Backend nativo en Rust (Tauri v2)
│   ├── src/
│   │   ├── db/                # Módulos de dominio de base de datos
│   │   │   ├── backend.rs     # Trait DatabaseBackend (Direct vs Tunnel)
│   │   │   ├── connection.rs  # Establecimiento de conexión y credenciales
│   │   │   ├── credentials.rs # Almacén cifrado AES-256-GCM (Vault)
│   │   │   ├── session.rs     # Sesión activa polimórfica
│   │   │   ├── query.rs       # Conversión de tipos y binding seguro
│   │   │   ├── database.rs    # Esquemas y bases de datos
│   │   │   ├── table.rs       # Metadatos, paginación, DDL de tablas
│   │   │   ├── row.rs         # Edición y borrado seguro de celdas
│   │   │   ├── routine.rs     # Procedimientos y funciones
│   │   │   ├── trigger.rs     # Triggers
│   │   │   ├── index.rs       # Índices y llaves
│   │   │   ├── safe_mode.rs   # Parser y clasificador de sentencias destructivas
│   │   │   ├── service.rs     # Capa de servicio de aplicación
│   │   │   ├── ssh.rs         # Reenvío TCP con OpenSSH
│   │   │   ├── tunnel.rs      # Parser binario robusto para ntunnel_mysql.php
│   │   │   └── mod.rs         # Comandos Tauri IPC
│   │   ├── excel/             # Motores de importación/exportación Excel por streaming
│   │   └── lib.rs             # Invoke handlers y plugins de Tauri
│   ├── Cargo.toml             # Dependencias de Rust
│   └── tauri.conf.json        # Configuración de ventana y empaquetado Tauri
├── src/                       # Frontend en React 19 + TypeScript
│   ├── components/            # Modales, vistas, SettingsModal, DataGridCanvas
│   ├── services/              # tauriDb, queryHistoryStorage, favoritesStorage
│   ├── stores/                # connectionStore, schemaStore, uiStore, preferenceStore, aiStore
│   ├── types/                 # Definiciones de tipos TypeScript
│   ├── App.tsx                # Layout principal, atajos globales y gestor de estado
│   └── main.tsx               # Punto de entrada de React
├── .github/workflows/ci.yml   # Pipeline de integración continua (CI)
├── AGENTS.md                  # Reglas críticas de arquitectura para desarrolladores y agentes
└── README.md                  # Documentación oficial del proyecto
```

---

## 📄 Licencia

Distribuido bajo la licencia MIT. Diseñado para ofrecer la máxima velocidad, ligereza y seguridad en la administración de bases de datos MariaDB y MySQL.
