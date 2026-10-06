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

### 🌐 1. Conexión Directa, SSH y Túnel HTTP (Navicat)
- **Abstracción Unificada (`DatabaseBackend`):** Los servicios de aplicación operan de forma agnóstica al transporte, soportando pools TCP directos con TLS, reenvío SSH de esos mismos pools y túneles HTTP (`ntunnel_mysql.php`).
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

### En Windows (PowerShell):
```powershell
# 1. Compilar frontend (Vite + TypeScript)
npm run build

# 2. Compilar binario autónomo de Tauri con assets embebidos
npx tauri build --no-bundle

# 3. Copiar el ejecutable generado a la raíz
Copy-Item -Path "src-tauri\target\release\pyro-studio.exe" -Destination "PyroStudio.exe" -Force
```

### En macOS (Terminal / Zsh / Bash):
```bash
# 1. Compilar frontend (Vite + TypeScript)
npm run build

# 2. Compilar bundle de aplicación (.app y .dmg con ícono)
npx tauri build
```
*(En macOS, `npx tauri build` genera el `.app` empaquetado en `src-tauri/target/release/bundle/macos/Pyro Studio.app`. No usar `--no-bundle` en Mac, ya que los binarios planos abren una ventana de Terminal).*

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
│   │   │   ├── ssh.rs         # Reenvío TCP con OpenSSH
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

---

## 🚀 P2: Importación masiva y transportes seguros

### Excel

- El asistente permite Dry Run: valida mapeos, columnas requeridas, compatibilidad básica de tipos y claves duplicadas, sin ejecutar DDL/DML.
- La estrategia **Strict** procesa cambios directos dentro de una transacción y solo permite tablas InnoDB; cualquier error aborta y revierte el lote completo.
- La estrategia **Tolerant** omite filas que fallan en la validación y continúa con las válidas para las importaciones de inserción/upsert directas. Estas se envían como lotes preparados con parámetros; si un lote falla, se reintentan sus filas en transacciones pequeñas. Los modos Update/Delete existentes conservan su ejecución fila por fila.
- HTTP Tunnel heredado no ofrece transacciones multi-request: Strict se rechaza allí. Tolerant conserva el flujo compatible y, si el preflight detecta errores estructurales, no inicia escrituras parciales.
- La exportación de tablas y resultados de consultas se ejecuta en Rust. SQLx lee el resultado como stream y `rust_xlsxwriter` usa memoria constante. La UI recibe eventos de progreso y no transfiere el resultado completo por IPC.
- El lector actual usa Calamine, que materializa el rango de una hoja al abrirla. La interfaz solo recibe una muestra de 50 filas, pero el uso máximo de memoria de la importación sigue dependiendo del tamaño del libro.

### TLS y SSH

- Las conexiones directas pueden usar TLS con verificación de identidad del certificado y una CA personalizada. La verificación insegura requiere una confirmación explícita.
- SSH crea un reenvío local con el OpenSSH del sistema. Admite autenticación por agente SSH o ruta a una clave privada local; las claves no se copian a PyroStudio y las claves con passphrase deben desbloquearse mediante el agente.
- En TLS directo se valida la CA y el nombre del servidor. Cuando se usa SSH, SQLx solo puede validar la CA a través del puerto local reenviado; la UI informa que no se verifica el nombre TLS remoto.

### HTTP Tunnel heredado

Se mantiene el protocolo binario de Navicat `ntunnel_mysql.php` para compatibilidad. El cliente envía `X-Request-Id`, aplica timeout, limita solicitudes a 8 MiB y respuestas a 64 MiB, y acepta compresión gzip. Respuestas del túnel se limitan a 20.000 filas. Se admite HTTP únicamente para loopback; los túneles remotos deben usar HTTPS.

El script PHP:

- permite por defecto solo `localhost`, `127.0.0.1` y `::1` como destino de base de datos;
- admite una allowlist exacta con `PYRO_TUNNEL_ALLOWED_DB_HOSTS=db.internal,db.example.net`;
- admite un token Bearer de servidor con `PYRO_TUNNEL_TOKEN`; el secreto se almacena en el Vault cifrado del cliente;
- limita solicitudes a 8 MiB, consultas individuales a 4 MiB, 100 consultas por petición, 20.000 filas de respuesta y 120 segundos.

Configura autenticación y limitación de tasa en Apache/Nginx o en el proxy frontal, fija también su límite de cuerpo (`post_max_size`) y usa HTTPS. El script no implementa limitación de tasa distribuida ni debe exponerse públicamente sin un proxy autenticado. Los destinos declarados en la allowlist son de confianza administrativa.

El límite de 20.000 filas restringe lo que se transmite, pero la API heredada `mysqli_store_result()` aún puede bufferizar resultados mayores dentro de PHP antes de aplicar ese límite. Para exportaciones mayores, usa conexión directa o SSH.

### Evolución de protocolo

No se sustituye el endpoint PHP compatible. Un futuro endpoint versionado de Pyro podría usar JSON estructurado sobre HTTPS, sin criptografía propia:

```json
{
  "version": 1,
  "request_id": "pyro-...",
  "operation": "query",
  "metadata": { "database": "app" },
  "payload": { "sql": "SELECT 1" }
}
```

La respuesta debería repetir versión e ID e incluir `error: { code, message }`, metadata y payload. La negociación debería ser explícita para conservar los clientes Navicat existentes.

## 📄 Licencia

Distribuido bajo la licencia MIT. Desarrollado para la comunidad de desarrolladores y administradores de bases de datos MariaDB & MySQL.
