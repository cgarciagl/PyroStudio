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
- Las credenciales nunca se persisten en texto plano en el frontend; se almacenan en una bóveda cifrada local con **AES-256-GCM** en Rust.
- Las respuestas IPC (`ConnectionConfig`, `ConnectionInfo`) tienen estrictamente prohibido exponer contraseñas o tokens (`#[serde(skip_serializing)]`).
- Las conexiones TLS validan certificados por defecto (`webpki-roots`) y exigen confirmación explícita si se deshabilita la verificación de certificados.
- El analizador de sentencias de **Modo Seguro** (`safe_mode.rs`) es una defensa en profundidad adicional: no reemplaza el principio de mínimo privilegio en el servidor de base de datos.

