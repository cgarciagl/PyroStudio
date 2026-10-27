# Política de Seguridad y Reporte de Vulnerabilidades

En **PyroStudio**, la seguridad y la protección de datos e integridad de las bases de datos de nuestros usuarios es una prioridad absoluta (P0). Agradecemos el esfuerzo de investigadores y desarrolladores que descubren y reportan vulnerabilidades de manera responsable.

---

## 🔒 Versiones Soportadas

Actualmente, las actualizaciones de seguridad se aplican sobre la rama principal y la versión menor más reciente:

| Versión | Soportada |
| :--- | :--- |
| `0.1.x` | ✅ Sí |
| `< 0.1.0` | ❌ No |

---

## 🚨 Cómo Reportar una Vulnerabilidad

Si descubres una vulnerabilidad de seguridad en PyroStudio (incluyendo la bóveda de credenciales, análisis de Safe Mode, comunicaciones TLS/SSH o el script PHP de túnel HTTP):

1. **NO** abras un Issue público en GitHub describiendo la vulnerabilidad o proporcionando código de explotación (PoC).
2. Envía un reporte detallado a través de **GitHub Security Advisories** (en la pestaña *Security* > *Advisories* > *Report a vulnerability* del repositorio) o por correo electrónico a:
   - **Email de Seguridad:** `security@pyrostudio.dev` (o canal privado habilitado por los mantenedores).
3. **Incluye en tu reporte:**
   - Descripción clara de la vulnerabilidad y vector de ataque.
   - Pasos detallados para reproducir el fallo.
   - Versión de PyroStudio y sistema operativo (Windows, macOS o Linux).
   - Motor de base de datos afectado (versión de MariaDB o MySQL) y tipo de conexión (TCP directo, TLS, SSH o túnel HTTP).
   - Impacto estimado sobre la confidencialidad, integridad o disponibilidad de los datos.

---

## ⏱️ Proceso de Respuesta

- **Acuse de recibo:** Responderemos a tu reporte en un plazo máximo de **48 horas**.
- **Evaluación y parche:** El equipo analizará la gravedad y preparará una solución en una rama privada.
- **Divulgación coordinada:** Acordaremos una ventana de divulgación pública (generalmente hasta 30 días después del reporte o tras la publicación de la actualización correctiva).
- **Agradecimiento:** Si lo deseas, reconoceremos tu contribución en las notas de la versión (*Release Notes*).

---

## 🛡️ Principios de Arquitectura de Seguridad en PyroStudio

Para referencia al investigar el código fuente:
- Las credenciales nunca se persisten en texto plano en el frontend; se almacenan en una bóveda cifrada local con **AES-256-GCM** en Rust. La clave maestra está en el llavero del sistema operativo (no junto al archivo cifrado); las instalaciones antiguas con `master.key` se migran automáticamente (se verifica que el vault descifra antes de sobrescribir y borrar el archivo). Sin llavero disponible (p. ej. Linux sin Secret Service) se usa `master.key` con permisos `0600` y la interfaz muestra un aviso. El borrado seguro del archivo es de mejor esfuerzo en SSD o sistemas de archivos copy-on-write.
- Las respuestas IPC (`ConnectionConfig`, `ConnectionInfo`) tienen estrictamente prohibido exponer contraseñas o tokens (`#[serde(skip_serializing)]`).
- Las conexiones TLS validan certificados por defecto (`webpki-roots`) y exigen confirmación explícita si se deshabilita la verificación de certificados.
- El analizador de sentencias de **Modo Seguro** (`safe_mode.rs`) es una defensa en profundidad adicional: no reemplaza el principio de mínimo privilegio en el servidor de base de datos.


## 🔎 Endurecimiento del WebView y del IPC

* **Markdown no confiable:** las respuestas de IA y del agente se renderizan con `src/utils/safeMarkdown.ts`, que convierte el HTML embebido en texto y solo permite enlaces `http(s)`, `mailto` y anclas (e imágenes `http(s)`/`data:image`). Nunca use `marked` directamente con `dangerouslySetInnerHTML`.
* **CSP activa** en producción (`tauri.conf.json`): sin scripts en línea ni orígenes externos; `connect-src` limitado al IPC (las llamadas a proveedores de IA se hacen desde Rust). `devCsp` es `null` solo para el servidor de Vite.
* **`withGlobalTauri: false`:** la API de Tauri no se expone como `window.__TAURI__`.
* **Capabilities mínimas:** se eliminó el acceso IPC de URLs remotas `localhost:*` y el permiso `opener:default`, que no se usaba.
* **Rutas de archivo autorizadas** (`src-tauri/src/file_grants.rs`): los comandos de importación/exportación Excel y de volcado/restauración SQL solo aceptan rutas devueltas por un diálogo nativo de Rust en la sesión actual. Un frontend comprometido no puede leer ni escribir archivos arbitrarios con ellos.
* **Workspaces:** ver `docs/WORKSPACES.md` (sin secretos en la carpeta compartida, ids validados, sin rutas desde el frontend).

### Túnel HTTP (`tunnel/pyro_tunnel.php`): seguro por defecto

El script **falla cerrado**:

1. **Token obligatorio.** Sin `PYRO_TUNNEL_TOKEN` (o `$tunnelToken`) de al menos 16 caracteres, toda petición se rechaza con HTTP 503 (código 215) y un mensaje de configuración; nunca actúa como proxy abierto. Las peticiones deben enviar `Authorization: Bearer <token>` (en PyroStudio: campo «Token del túnel», guardado en el almacén seguro). Genere uno con `php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"`.
2. **Solo localhost por defecto.** Sin lista explícita solo se admiten `localhost`, `127.0.0.1` y `::1`. Para otros hosts use `PYRO_TUNNEL_ALLOWED_DB_HOSTS` (separados por comas) o `$allowedDbHosts`; la lista explícita sustituye a la predeterminada.
3. **Página de diagnóstico desactivada** (`$allowDiagnosticPage = false`, o `PYRO_TUNNEL_DIAGNOSTIC_PAGE=1` temporalmente). Aun activada, no muestra versión de PHP ni configuración, y la prueba de conexión exige el token. Se elimina la cabecera `X-Powered-By`.
4. El cliente se identifica honestamente como `PyroStudio/<versión>` (sin User-Agent de navegador).
5. Sirva el script solo por HTTPS (PyroStudio rechaza `http://` salvo hacia localhost).

Pruebas: `php tunnel/tests/tunnel_test.php` (levanta `php -S` y verifica los rechazos).
