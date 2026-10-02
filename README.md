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
  <em>Construido con Tauri v2 (Rust) + React 18 (TypeScript & Tailwind CSS)</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri_v2-24C8D5?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/MariaDB-003545?style=for-the-badge&logo=mariadb&logoColor=white" alt="MariaDB" />
  <img src="https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL" />
</p>

---

## 🌟 Características Principales

### 🌐 1. Conexión Directa TCP y Túnel HTTP (Navicat)
- **Protocolo de Túnel Binario:** 100% compatible con el script oficial `ntunnel_mysql.php` de Navicat.
- **Bypass de Firewalls y WAFs:** Soporte para empaquetado binario, cabecera mágica `1111`, codificación Base64 y autenticación HTTP Basic.
- **Conexiones Directas:** Pool de conexiones asíncrono con SQLx para latencias mínimas.
- **Gestión de Perfiles:** Guardado local de conexiones clasificadas por entornos (`Local`, `Dev`, `Staging`, `Prod`).

### 📊 2. Motor Excel Integrado (Importación & Exportación Masiva)
- **Asistente de Importación de 5 Pasos:**
  - **Detección Automática:** Previsualización instantánea de hojas y tipos de datos con `calamine`.
  - **Mapeo Inteligente:** Selección de columnas de destino y definición de **Llaves Primarias / Compuestas (🔑)** estilo Navicat.
  - **6 Modos de Operación:** *Append*, *Update*, *Append/Update (Upsert)*, *Append without update*, *Delete* y *Copy/Replace*.
  - **Progreso en Tiempo Real:** Barra de progreso nativa con porcentaje, contadores de filas exitosas/fallidas y registro detallado de errores.
- **Exportación Estilizada:** Exportación de tablas y consultas a `.xlsx` de alta velocidad con `rust_xlsxwriter`.

### 🔍 3. Visualizador de Plan de Ejecución (EXPLAIN Plan)
- Diagnóstico visual de consultas SQL.
- Alertas de rendimiento para escaneos de tabla completa (**Full Table Scan 🔴**) y lecturas indexadas (**Index Lookups 🟢**).
- Desglose tabular detallado de `select_type`, `key`, `rows` y `filtered`.

### ⚡ 4. Editor de Rutinas y Triggers
- **Stored Procedures & Functions:** Editor DDL con visor de parámetros y **modal interactivo de prueba/ejecución con argumentos**.
- **Triggers:** Inspector y editor DDL con timing (`BEFORE`/`AFTER`), eventos (`INSERT`/`UPDATE`/`DELETE`) y tabla objetivo.

### 📝 5. Grid de Datos y Diseñador Visual de Tablas
- **Edición Interactiva:** Modificación de celdas en vivo y edición modal de filas completas con generación automática de `UPDATE ... WHERE`.
- **Diseñador de Esquemas:** Creación de tablas (`InnoDB`, `Aria`, etc.), modificación de columnas (`ALTER TABLE ADD/CHANGE/DROP`), collations y llaves primarias.

---

## 🚀 Inicio Rápido

### Requisitos Previos
- [Node.js](https://nodejs.org/) (v18 o superior)
- [Rust](https://www.rust-lang.org/) (versión stable 1.78+)
- Herramientas de compilación de C++ para Windows (MSVC Build Tools)

### Instalación de Dependencias
```powershell
# Instalar dependencias del frontend
npm install
```

### Modo de Desarrollo
```powershell
# Ejecuta Vite y la ventana Webview de Tauri v2
npm run dev
# o usando CLI de Tauri
npx tauri dev
```

---

## 🏗️ Compilación para Producción (Instrucciones Críticas)

> [!IMPORTANT]
> En Tauri v2, **NUNCA** ejecutes `cargo build --release` directamente en `src-tauri`. Siempre ejecuta el pipeline oficial de Tauri para garantizar que los archivos compilados del frontend (`dist/`) se incrusten dentro del ejecutable.

```powershell
# 1. Compilar frontend (Vite + TypeScript)
npm run build

# 2. Compilar binario autónomo de Tauri
npx tauri build --no-bundle

# 3. Copiar el ejecutable generado a la raíz
Copy-Item -Path "src-tauri\target\release\pyro-studio.exe" -Destination "PyroStudio.exe" -Force
```

El ejecutable resultante **`PyroStudio.exe`** (~14.4 MB) es totalmente independiente y portable.

---

## 📁 Estructura del Proyecto

```
PyroStudio/
├── src-tauri/                 # Backend nativo en Rust
│   ├── src/
│   │   ├── db/                # Pool SQLx, túnel HTTP Navicat y servicios DB
│   │   ├── excel/             # Motores de importación/exportación Excel
│   │   └── lib.rs             # Invoke handlers y plugins Tauri
│   ├── Cargo.toml             # Dependencias de Rust
│   └── tauri.conf.json        # Configuración de ventana y bundles Tauri
├── src/                       # Frontend en React + TypeScript
│   ├── components/            # Modales, vistas, editores SQL y tablas
│   ├── services/              # Invocación a comandos Tauri y almacenamiento
│   ├── types/                 # Definiciones de TypeScript
│   ├── App.tsx                # Layout principal y gestor de estado
│   └── main.tsx               # Punto de entrada de React
├── AGENTS.md                  # Reglas críticas de arquitectura para agentes
└── README.md                  # Documentación del proyecto
```

---

## 📄 Licencia

Desarrollado para la comunidad de desarrolladores y administradores de bases de datos. Distribuido bajo la licencia MIT.
