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

### 🌐 1. Conexión Directa TCP y Túnel HTTP (Navicat)
- **Abstracción Unificada (`DatabaseBackend`):** Los servicios de aplicación operan de forma agnóstica al transporte, soportando tanto pools TCP directos (`sqlx::MySqlPool`) como túneles HTTP (`ntunnel_mysql.php`).
- **Bypass de Firewalls y WAFs:** Soporte para empaquetado binario, cabecera mágica `1111`, codificación Base64 y autenticación HTTP Basic.
- **Gestión Avanzada de Perfiles:** Crear, editar, duplicar, probar, conectar y eliminar conexiones clasificadas por entornos (`Local`, `Dev`, `Staging`, `Prod`).

### 🛡️ 2. Modo Seguro (Safe Mode)
- **Protección contra Operaciones Destructivas:** Detección y análisis sintáctico de sentencias de alto riesgo:
  - `DROP TABLE`, `DROP DATABASE`, `DROP PROCEDURE`, `DROP TRIGGER`, `DROP INDEX`
  - `TRUNCATE TABLE`
  - `DELETE` o `UPDATE` sin cláusula `WHERE` (Alerta Crítica 🔴)
  - `ALTER TABLE` y `RENAME TABLE`
- **Modal de Confirmación:** Muestra el SQL exacto, explicación del riesgo y requiere confirmación explícita (con validación de texto para operaciones masivas sin `WHERE`).
- **Conmutador Rápido:** Activa o desactiva el Modo Seguro directamente desde la barra de herramientas del editor SQL.

### 📜 3. Historial de Consultas & Favoritos SQL
- **Historial Persistente Capped (FIFO):** Guarda cronológicamente hasta 2,000 consultas con timestamp, base de datos, tiempo de respuesta en ms, filas afectadas y estado de éxito/error.
- **Búsqueda y Re-ejecución:** Búsqueda rápida por texto o base de datos, filtrado por éxito/error, copia al portapapeles y re-ejecución con un clic.
- **Snippets y Favoritos:** Catálogo organizado por categorías (`Diagnóstico`, `Usuarios`, `Reportes`, `Administración`, `Rendimiento`) con presets útiles para administración del servidor.
- **Atajos Globales en Editor:**
  - `Ctrl+Enter`: Ejecutar consulta
  - `Ctrl+Shift+Enter` / `Alt+X`: Explicar plan (EXPLAIN)
  - `Ctrl+H`: Abrir historial
  - `Ctrl+S`: Guardar consulta actual como favorito

### 📊 4. Motor Excel Integrado (Importación & Exportación Masiva)
- **Asistente de Importación de 5 Pasos:** Detección automática con `calamine`, mapeo de llaves primarias/compuestas (🔑), 6 modos de sincronización y barra de progreso en vivo.
- **Exportación Estilizada:** Exportación de tablas y consultas a `.xlsx` de alta velocidad con `rust_xlsxwriter`.

### 🔍 5. Visualizador de Plan de Ejecución (EXPLAIN Plan)
- Diagnóstico visual de consultas SQL con alertas de rendimiento (Full Table Scan 🔴, Index Lookups 🟢) y desglose tabular.

### ⚡ 6. Editor de Rutinas, Triggers e Índices
- **Procedimientos y Funciones:** Editor DDL con inspector de parámetros y modal interactivo de ejecución con argumentos.
- **Triggers:** Inspector DDL con timing (`BEFORE`/`AFTER`), eventos y tabla asociada.
- **Gestor de Índices:** Visualización de llaves primarias, índices únicos y creación visual de índices secundarios.

### 🔐 7. Seguridad y Bóveda Cifrada Multiplataforma (P0)
- **Almacén Cifrado AES-256-GCM:** Cero contraseñas en texto plano en `localStorage`. Clave de 256 bits generada con entropía del SO, compatible con Windows, macOS y Linux.
- **Respuestas IPC Sanitizadas:** Todas las credenciales se omiten en la serialización hacia React.
- **Protección contra Modificaciones Ambiguas:** Tablas sin llave primaria son estrictamente de solo lectura en el backend y en la interfaz.

---

## 🚀 Inicio Rápido

### Requisitos Previos
- [Node.js](https://nodejs.org/) (v18 o superior)
- [Rust](https://www.rust-lang.org/) (versión stable 1.78+)
- Compilador de C/C++ según la plataforma (MSVC Build Tools en Windows, Xcode Command Line Tools en macOS, `build-essential` en Linux)

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

```powershell
# 1. Compilar frontend (Vite + TypeScript)
npm run build

# 2. Compilar binario autónomo de Tauri con assets embebidos
npx tauri build --no-bundle

# 3. Copiar el ejecutable generado a la raíz
Copy-Item -Path "src-tauri\target\release\pyro-studio.exe" -Destination "PyroStudio.exe" -Force
```

---

## 📁 Estructura del Proyecto

```
PyroStudio/
├── src-tauri/                 # Backend nativo en Rust
│   ├── src/
│   │   ├── db/                # Arquitectura modular de base de datos
│   │   │   ├── backend.rs     # Trait DatabaseBackend (Direct vs Tunnel)
│   │   │   ├── connection.rs  # Conexión y credenciales
│   │   │   ├── session.rs     # Sesión activa y pool
│   │   │   ├── query.rs       # Conversión de tipos y binding seguro
│   │   │   ├── database.rs    # Esquemas y bases de datos
│   │   │   ├── table.rs       # Metadatos, paginación, DDL de tablas
│   │   │   ├── row.rs         # Edición y borrado seguro de celdas
│   │   │   ├── routine.rs     # Procedimientos y funciones
│   │   │   ├── trigger.rs     # Triggers
│   │   │   ├── index.rs       # Índices
│   │   │   ├── safe_mode.rs   # Clasificador de operaciones destructivas
│   │   │   ├── service.rs     # Capa de servicio de aplicación
│   │   │   └── mod.rs         # Comandos Tauri IPC
│   │   ├── excel/             # Motores de importación/exportación Excel
│   │   └── lib.rs             # Invoke handlers y plugins Tauri
│   ├── Cargo.toml             # Dependencias de Rust
│   └── tauri.conf.json        # Configuración de ventana y bundles Tauri
├── src/                       # Frontend en React 19 + TypeScript
│   ├── components/            # Modales, vistas, QueryEditor, DataGrid
│   ├── services/              # tauriDb, queryHistoryStorage, favoritesStorage
│   ├── stores/                # connectionStore, schemaStore, uiStore, preferenceStore
│   ├── types/                 # Definiciones de TypeScript
│   ├── App.tsx                # Layout principal y gestor de estado
│   └── main.tsx               # Punto de entrada de React
├── .github/workflows/ci.yml   # Pipeline de integración continua
├── AGENTS.md                  # Reglas críticas de arquitectura para agentes
└── README.md                  # Documentación del proyecto
```

---

## 📄 Licencia

Distribuido bajo la licencia MIT. Desarrollado para la comunidad de desarrolladores y administradores de bases de datos MariaDB & MySQL.
