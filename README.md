```
██████╗ ██╗   ██╗██████╗  ██████╗     ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ 
██╔══██╗╚██╗ ██╔╝██╔══██╗██╔═══██╗    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
██████╔╝ ╚████╔╝ ██████╔╝██║   ██║    ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
██╔═══╝   ╚██╔╝  ██╔══██╗██║   ██║    ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
██║        ██║   ██║  ██║╚██████╔╝    ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
╚═╝        ╚═╝   ╚═╝  ╚═╝ ╚═════╝     ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ 
```

<p align="center">
  <strong>🔥 Cliente Nativo, Ultraligero y de Alto Rendimiento para MariaDB, MySQL & SQLite</strong>
  <br />
  <em>Construido con Tauri v2 (Rust) + React 19 (TypeScript & Tailwind CSS)</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri_v2-24C8D5?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/MariaDB-003545?style=for-the-badge&logo=mariadb&logoColor=white" alt="MariaDB" />
  <img src="https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License" />
</p>

---

## 📌 ¿Qué es PyroStudio?

**PyroStudio** es un cliente gráfico de escritorio diseñado específicamente para administradores de bases de datos (DBA) y desarrolladores de software que exigen velocidad instantánea, seguridad rigurosa de credenciales y diagnósticos avanzados para **MariaDB y MySQL**, además de archivos **SQLite**, sin el consumo excesivo de memoria ni la lentitud de herramientas tradicionales basadas en Electron o Java.

A diferencia de clientes genéricos, PyroStudio integra de forma nativa:
- **Túnel HTTP binario endurecido (PHP)** para servidores detrás de cortafuegos o WAFs estrictos.
- **Cancelación real de consultas fuera de banda** (`KILL QUERY`) en conexiones directas y sobre túnel HTTP.
- **Safe Mode de defensa en profundidad** con análisis de sentencias potencialmente destructivas.
- **Cuadrícula Canvas por aceleración gráfica (60 FPS)** para explorar millones de celdas con edición in-place.
- **Herramientas de diagnóstico de rendimiento:** EXPLAIN visual, Asesor de Índices heurístico, visor de `slow_log` y terminación interactiva de sesiones (`KILL CONNECTION`).

---

## 💻 Requisitos de Sistema y Compatibilidad

### Sistemas Operativos Compatibles
- **Windows:** Windows 10 (1809+) y Windows 11 (x64 / ARM64). Requiere *Microsoft Edge WebView2* (incluido por defecto en Windows 11 y Windows 10 actualizado).
- **macOS:** macOS 11 Big Sur, macOS 12 Monterey, macOS 13 Ventura, macOS 14 Sonoma o superior (Apple Silicon M1/M2/M3/M4 y arquitectura Intel x64).
- **Linux:** Ubuntu 22.04+, Debian 11+, Fedora 38+, Arch Linux. Requiere paquetes de WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`).

### Versiones de Motores de Base de Datos Soportadas
- **MariaDB:** 10.3, 10.4, 10.5, 10.6, 10.11 LTS, 11.0, 11.4 LTS o superior.
- **MySQL:** 5.7, 8.0, 8.4 LTS, 9.0 o superior.
- **Percona Server / AWS Aurora MySQL:** Totalmente compatibles en capas de protocolo estándar.
- **SQLite:** archivos `.db`, `.sqlite`, `.sqlite3` y `.db3` (SQLite 3 empaquetado, sin dependencias del sistema), en local o mediante el túnel `tunnel/pyro_tunnel_sqlite.php`.

### Soporte y Características de SQLite
- **Compatibilidad de motor:** Archivos SQLite 3 locales o remotos a través del túnel PHP `tunnel/pyro_tunnel_sqlite.php`.
- **Inspección y visualización:** Explorador de tablas, columnas, índices, claves foráneas, triggers y vistas.
- **Edición y rowid:** Las tablas sin clave primaria explícita se editan con seguridad mediante `rowid` (mostrado como primera columna identificadora).
- **Modificación de esquemas (DDL):** Reconstrucción transparente de tablas mediante el [procedimiento oficial de 12 pasos](https://www.sqlite.org/lang_altertable.html#otheralter) con previsualización del script SQL antes de su aplicación.
- **EXPLAIN QUERY PLAN:** Parser jerárquico integrado con representación en árbol y tabla para optimización de consultas SQLite.
- **Respaldo en caliente no bloqueante:** Copia de seguridad instantánea mediante `VACUUM INTO` sin bloquear transacciones de lectura concurrentes.
- **Importación y exportación Excel:** Soporte de dialecto SQLite (`INSERT OR IGNORE`, `ON CONFLICT DO UPDATE`, tipos nativos SQLite).
- **Asistente de IA sensible a SQLite:** Contexto de esquema e introspección directa sin dependencias de `information_schema`.
- **Safe Mode adaptado:** Clasificación de sentencias `PRAGMA` distinguiendo inspecciones de lectura de modificaciones de configuración.

### Limitaciones de SQLite
- Sin usuarios ni permisos, rutinas, eventos, secuencias, particiones, tablas temporales con versión, monitor de salud, lista de procesos ni comparación de esquemas: la interfaz oculta estas funciones mediante detección automática de capacidades (`ServerCapabilities`).
- Se utiliza una sola conexión de base de datos por archivo activo (para garantizar coherencia de sentencias `ATTACH`, tablas `TEMP` y `PRAGMA`), por lo que consultas de muy larga duración pueden ocupar la conexión hasta su finalización o cancelación.
- En conexiones a través del túnel HTTP cada petición abre el archivo de forma independiente (las sentencias `ATTACH` no persisten) y las consultas no admiten cancelación fuera de banda.

---

## 📥 Instalación

### Descarga de Binarios Precompilados
Descarga el instalador o ejecutable para tu plataforma desde la sección oficial de [Releases de GitHub](https://github.com/cgarciagl/PyroStudio/releases):

- **Windows:** 
  - `Pyro-Studio_Setup.exe` (Instalador estándar NSIS)
  - `Pyro-Studio.msi` (Instalador corporativo para políticas de grupo / MDM)
  - `PyroStudio.exe` (Binario autónomo portable con assets embebidos)
- **macOS:**
  - `Pyro-Studio.dmg` (Arrastrar y soltar a la carpeta `Applications`)
- **Linux:**
  - `pyro-studio.AppImage` (Ejecutable portable: `chmod +x` y lanzar)
  - `pyro-studio_amd64.deb` (Instalación en Debian / Ubuntu: `sudo dpkg -i pyro-studio_amd64.deb`)

---

## 🔌 Guía de Primera Conexión

Al iniciar PyroStudio, se presentará el gestor de perfiles de conexión:

1. **Crear Perfil:** Haz clic en **Nueva Conexión** y asigna un nombre reconocible (ej. `Producción Tienda`, `Desarrollo Local`).
2. **Seleccionar Entorno:** Elige entre `Local`, `Development`, `Staging` o `Production`.
   > [!IMPORTANT]
   > Las conexiones marcadas como **Production** activan automáticamente alertas visuales reforzadas en la cabecera y exigen confirmación en cualquier operación clasificada como potencialmente destructiva por Safe Mode.
3. **Tipo de Conexión:**
   - **TCP Directo:** Especifica Host, Puerto (por defecto `3306`), Usuario, Contraseña y Base de Datos predeterminada.
   - **Reenvío SSH:** Conéctate a bases de datos aisladas en redes privadas a través de un host bastión SSH.
   - **Túnel HTTP (PHP):** Para servidores compartidos o accesibles solo vía web. Sube `tunnel/pyro_tunnel.php` a tu servidor HTTP y proporciona la URL del túnel.
     El script es seguro por defecto: **exige un token** (`PYRO_TUNNEL_TOKEN`, mínimo 16 caracteres; sin él rechaza toda petición) y solo conecta a bases de datos en `localhost`.
     1. Pulsa **«Generar token»** en el campo «Token del túnel» y copia el bloque que aparece al servidor (`PYRO_TUNNEL_TOKEN=...` o `$tunnelToken = '...';`). Si lo pierdes, genera otro y actualízalo en ambos lados.
     2. Si la base de datos no está en el mismo servidor, añádela a `PYRO_TUNNEL_ALLOWED_DB_HOSTS` (separado por comas): host exacto (`db.miempresa.com`), subdominios (`*.miempresa.com`, sin el dominio raíz), CIDR (`10.0.0.0/8`) o `*` para cualquier host (mayor riesgo: quien tenga el token puede alcanzar toda la red del servidor). La lista sustituye a `localhost`, así que inclúyelo si lo necesitas. Los metadatos de la nube (`169.254.0.0/16`, Alibaba, Oracle, AWS IPv6) y otros rangos especiales están siempre bloqueados, también escritos como IPv6 con IPv4 embebida (NAT64, 6to4…), y los nombres se validan por la IP a la que resuelven.
     3. Solo se admiten los puertos `3306` y `3307`. Para otros, define `PYRO_TUNNEL_ALLOWED_DB_PORTS` (p. ej. `3306,3300-3310` o `*`); si no, la conexión falla con el error 218.
     4. Si la base de datos es remota, cifra el tramo túnel → base de datos con `PYRO_TUNNEL_DB_TLS=preferred` o `required` (por defecto `off`; PyroStudio avisa cuando ese tramo va sin cifrar). Sin `PYRO_TUNNEL_DB_TLS_CA` se cifra, pero no se verifica la identidad del servidor.
     5. Tras 5 tokens incorrectos desde una IP en 5 minutos, el túnel la bloquea temporalmente (HTTP 429). Desactívalo con `PYRO_TUNNEL_RATE_LIMIT=off`; detrás de un proxy inverso propio, define `PYRO_TUNNEL_TRUSTED_PROXY=1`.

     La tabla completa de variables `PYRO_TUNNEL_*` está en [SECURITY.md](SECURITY.md#variables-de-entorno).

     Detalles en [SECURITY.md](SECURITY.md).
4. **Seguridad TLS / SSL:**
   - Por defecto, PyroStudio valida certificados mediante la autoridad de certificación pública del sistema.
   - Puedes adjuntar una Autoridad Certificadora personalizada (`Custom CA Path`).
   - Deshabilitar la verificación TLS requiere una confirmación consciente para evitar ataques de Hombre en el Medio (MitM).
5. **Probar y Conectar:** Haz clic en **Probar Conexión** para validar latencia y credenciales. La contraseña se guardará automáticamente en el almacén local cifrado con AES-256-GCM.

---

## 🛡️ Modo Seguro (Safe Mode) y Límites Técnicos

PyroStudio implementa un parser sintáctico de análisis de riesgo en `src-tauri/src/db/safe_mode.rs`:

- **Operaciones Críticas Clasificadas:**
  - `DELETE` o `UPDATE` sin cláusula `WHERE` (o con `WHERE` dentro de literales de texto).
  - `DROP TABLE`, `DROP DATABASE`, `DROP PROCEDURE`, `DROP TRIGGER`, `DROP INDEX`.
  - `TRUNCATE TABLE`.
  - Inyecciones multi-sentencia que oculten comandos destructivos tras un punto y coma.
- **Interacción:** El modal interactivo de confirmación exige escribir el nombre del objeto o aceptar expresamente el riesgo antes de transmitir la instrucción.
- **Límite Conocido de Seguridad:** *Safe Mode es una defensa adicional en profundidad para evitar despistes humanos, NO una garantía absoluta de seguridad ni un sustituto del principio de mínimo privilegio en el servidor MySQL.* Se recomienda otorgar únicamente permisos de solo lectura (`SELECT`) a usuarios que no requieran alterar datos en producción.

---

## ⚡ Cancelación de Consultas Fuera de Banda

- En el editor SQL (`QueryEditorTab`), cada consulta ejecutada genera un identificador de rastreo único (`query_id`).
- Puedes cancelar consultas de larga duración en cualquier momento mediante el botón **Cancelar** o estableciendo un tiempo de espera (*Timeout*) configurable (5s, 10s, 30s, 60s, 120s o Sin Límite).
- La orden de cancelación se propaga al backend de Rust, emitiendo un `KILL QUERY` directo hacia el hilo del motor MySQL, tanto en conexiones TCP directas como a través del script PHP del túnel HTTP.

---

## ⌨️ Atajos de Teclado Principales

| Atajo (Windows / Linux) | Atajo (macOS) | Acción | Descripción |
| :--- | :--- | :--- | :--- |
| `Ctrl + K` / `Ctrl + P` | `⌘K` / `⌘P` | **Paleta de Comandos** | Búsqueda global de tablas, acciones y pestañas abiertas |
| `Ctrl + Enter` | `⌘ + Enter` | **Ejecutar Consulta** | Ejecuta la sentencia bajo el cursor o la selección actual |
| `Ctrl + Shift + Enter` | `⌘ + Shift + Enter` | **EXPLAIN Plan** | Analiza el plan de ejecución de la consulta |
| `Ctrl + B` | `⌘B` | **Colapsar Sidebar** | Oculta o expande el panel lateral de exploración |
| `Ctrl + H` | `⌘H` | **Historial SQL** | Registro cronológico persistente de consultas |
| `Ctrl + S` | `⌘S` | **Favoritos / Snippets** | Catálogo de consultas frecuentes categorizadas |
| `Ctrl + ,` | `⌘,` | **Configuración** | Preferencias de usuario, editor y políticas de claves primarias |
| `F5` / `Ctrl + R` | `⌘R` | **Refrescar Esquema** | Recarga la lista de bases de datos y tablas |

---

## 🛠️ Desarrollo Local y Pruebas

### 1. Clonar el repositorio
```bash
git clone https://github.com/cgarciagl/PyroStudio.git
cd PyroStudio
```

### 2. Instalar dependencias del frontend
```bash
npm install
```

### 3. Ejecutar pruebas automatizadas
```bash
# Pruebas del Backend (Rust)
cargo test --manifest-path src-tauri/Cargo.toml

# Verificación de formato oficial
cargo fmt --check --manifest-path src-tauri/Cargo.toml

# Pruebas del Frontend (Vitest)
npm test
```

### 4. Ejecutar en entorno de desarrollo
```bash
npm run tauri:dev
```

### 5. Compilación para producción local
- **Windows (PowerShell):**
  ```powershell
  npm run build
  npx tauri build --no-bundle
  Copy-Item -Path "src-tauri\target\release\pyro-studio.exe" -Destination "PyroStudio.exe" -Force
  ```
- **macOS (Terminal):**
  ```bash
  npm run build
  npx tauri build
  # El bundle .app estará en: src-tauri/target/release/bundle/macos/Pyro Studio.app
  ```

---

## ❓ Preguntas Frecuentes y Solución de Problemas

#### 1. ¿Por qué no puedo editar celdas en una tabla específica?
Si la tabla **no tiene Clave Primaria (Primary Key)** definida, el comportamiento dependerá de tus preferencias (`Ctrl+,`):
- **Modo Fila Completa (por defecto):** Trata todos los campos como criterio compuesto (`WHERE col1 <=> val1 AND ... LIMIT 1`), permitiendo la edición y eliminación segura.
- **Modo Estricto:** Bloquea la edición para proteger contra actualizaciones accidentales de filas duplicadas idénticas.

#### 2. Error `ERR_CONNECTION_REFUSED` al abrir el ejecutable
Si compilaste con `cargo build --release` directamente en la carpeta `src-tauri`, los archivos estáticos del frontend (`dist/`) no fueron incrustados en el binario. Debes compilar utilizando `npm run build` seguido de `npx tauri build`.

#### 3. Error `Access denied for user` al intentar terminar procesos (`KILL`)
Interrumpir consultas de otros usuarios o cerrar sesiones en el Centro de Operaciones requiere el privilegio `PROCESS` o `SUPER` en MariaDB/MySQL. Consulta con el administrador del servidor para obtener los permisos adecuados.

---

## 🤝 Contribuciones y Comunidad

Agradecemos cualquier contribución de código, documentación o reporte de errores:
- Consulta nuestra [Guía de Contribución](CONTRIBUTING.md) antes de enviar un Pull Request.
- Para reportar errores, utiliza nuestras [Plantillas de Issues](.github/ISSUE_TEMPLATE/).
- Para problemas de seguridad, consulta nuestra [Política de Seguridad](SECURITY.md).

---

## 📄 Licencia

Distribuido bajo la **Licencia MIT**. Consulta el archivo [LICENSE](LICENSE) para más detalles.
