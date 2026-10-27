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

* **Markdown no confiable:** las respuestas de IA y del agente se renderizan con `src/utils/safeMarkdown.ts`, que convierte el HTML embebido en texto y solo permite enlaces `http(s)`, `mailto` y anclas (las imágenes remotas se muestran como enlace que el usuario debe abrir; solo `data:image` se incrusta, y la CSP `img-src` no admite orígenes remotos). Nunca use `marked` directamente con `dangerouslySetInnerHTML`.
* **CSP activa** en producción (`tauri.conf.json`): sin scripts en línea ni orígenes externos; `connect-src` limitado al IPC (las llamadas a proveedores de IA se hacen desde Rust). `devCsp` es `null` solo para el servidor de Vite.
* **`withGlobalTauri: false`:** la API de Tauri no se expone como `window.__TAURI__`.
* **Capabilities mínimas:** se eliminó el acceso IPC de URLs remotas `localhost:*` y el permiso `opener:default`, que no se usaba.
* **Rutas de archivo autorizadas** (`src-tauri/src/file_grants.rs`): los comandos de importación/exportación Excel y de volcado/restauración SQL solo aceptan rutas devueltas por un diálogo nativo de Rust en la sesión actual. Un frontend comprometido no puede leer ni escribir archivos arbitrarios con ellos.
* **Workspaces:** ver `docs/WORKSPACES.md` (sin secretos en la carpeta compartida, ids validados, sin rutas desde el frontend).

### Túnel HTTP (`tunnel/pyro_tunnel.php`): seguro por defecto

El script **falla cerrado**:

1. **Token obligatorio.** Sin `PYRO_TUNNEL_TOKEN` (o `$tunnelToken`) de al menos 16 caracteres, toda petición se rechaza con HTTP 503 (código 215) y un mensaje de configuración; nunca actúa como proxy abierto. Las peticiones deben enviar `Authorization: Bearer <token>` (o `X-Pyro-Token`; en PyroStudio: campo «Token del túnel», guardado en el almacén seguro). Use el botón «Generar token» del modal de conexión o `php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"`.
2. **Solo localhost por defecto.** Sin lista explícita solo se admiten `localhost`, `127.0.0.1` y `::1`. Para otros hosts use `PYRO_TUNNEL_ALLOWED_DB_HOSTS` (separados por comas) o `$allowedDbHosts`; la lista explícita sustituye a la predeterminada (incluya `localhost` si lo sigue necesitando).

#### Sintaxis de la allowlist

| Entrada | Significado |
| :--- | :--- |
| `db.miempresa.com` | Host exacto (sin distinguir mayúsculas). |
| `*.miempresa.com` | Cualquier subdominio. **No** incluye `miempresa.com`: lístelo aparte. |
| `10.0.0.0/8`, `fd00::/8` | Rango CIDR IPv4/IPv6. Una IP suelta equivale a `/32` o `/128`. |
| `*` | Cualquier host. **Modo de mayor riesgo** (ver abajo). |

Una entrada inválida (CIDR mal formado, `*.` vacío, caracteres no válidos) se **ignora** y se registra con `error_log()`; nunca se interpreta como `*`. Si todas son inválidas, no se permite ningún host.

#### Validación del destino

- **Bloqueos fijos**, sin configuración posible e incluso con `*`: `169.254.0.0/16` (incluye los metadatos de la nube `169.254.169.254`), `0.0.0.0/8`, `::`, `fe80::/10` y multicast (`224.0.0.0/4`, `ff00::/8`). Las redes privadas (`10/8`, `172.16/12`, `192.168/16`) sí se permiten con `*`.
- **Se valida la IP resuelta, no el texto.** Un nombre se resuelve una vez (A con `gethostbynamel()` y A/AAAA con `dns_get_record()`); **todas** las IPs deben quedar fuera de los bloqueos, y mysqli se conecta a la IP ya validada (preferentemente IPv4), así que un DNS que cambie de respuesta (*DNS rebinding*) no puede desviar la conexión. Un nombre se admite si coincide con una entrada de nombre (`exacto`, `*.dominio`, `*`) o si todas sus IPs caen en entradas CIDR. `localhost` no se resuelve y conserva su comportamiento (socket local).
- **Normalización** antes de comparar: formas alternativas de IPv4 (`127.1`, `2130706433`, `0x7f.1`, `0177.0.0.1`), IPv4 mapeada (`::ffff:127.0.0.1`), corchetes (`[::1]`), punto final (`localhost.`), mayúsculas y espacios. Se rechazan prefijos de mysqli como `p:host` y cualquier carácter no válido; longitud máxima 253.
- Si el nombre no resuelve en el servidor PHP, la respuesta es el código 2005. En hostings compartidos `dns_get_record()` puede estar deshabilitada o no consultar `/etc/hosts`, y `gethostbynamel()` solo devuelve IPv4; por eso se combinan ambas. Si ninguna resuelve, use la IP directamente con una entrada CIDR.

#### Modelo de amenaza de `*`

Con `*`, **quien tenga el token puede usar el servidor PHP como puente (SSRF)** hacia cualquier host y puerto que ese servidor alcance, incluida su red interna. Los bloqueos fijos evitan los destinos más peligrosos (metadatos de la nube), pero no protegen otros servicios internos. Use `*` solo si lo necesita, prefiera `*.dominio` o CIDR acotados, sirva el script por HTTPS y use un token largo y aleatorio.

#### Rotación del token

No hay recuperación: el token guardado en PyroStudio no se puede mostrar. Para rotarlo (o si lo pierde o se filtra), genere uno nuevo con «Generar token», actualice `PYRO_TUNNEL_TOKEN`/`$tunnelToken` en el servidor y guarde la conexión en PyroStudio. El token anterior deja de funcionar en cuanto cambia en el servidor.
3. **Página de diagnóstico desactivada** (`$allowDiagnosticPage = false`, o `PYRO_TUNNEL_DIAGNOSTIC_PAGE=1` temporalmente). Aun activada, no muestra versión de PHP ni configuración, y la prueba de conexión exige el token. Se elimina la cabecera `X-Powered-By`.
4. El cliente se identifica honestamente como `PyroStudio/<versión>` (sin User-Agent de navegador).
5. Sirva el script solo por HTTPS (PyroStudio rechaza `http://` salvo hacia localhost).

Pruebas: `php tunnel/tests/tunnel_test.php` (levanta `php -S` y verifica los rechazos) y `php tunnel/tests/tunnel_hosts_test.php` (allowlist, normalización y DNS simulado).

### Firma de releases

Los artefactos del updater se firman con `TAURI_SIGNING_PRIVATE_KEY` cuando el secreto está configurado en GitHub Actions. Generación, configuración y rotación de la clave: ver [CONTRIBUTING.md](CONTRIBUTING.md#-firma-de-releases-tauri_signing_private_key).
