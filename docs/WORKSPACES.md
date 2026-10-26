# Workspaces en PyroStudio

Un **workspace** es una carpeta que usted elige y en la que PyroStudio guarda las
definiciones de conexión y las consultas SQL guardadas como archivos normales. Si esa
carpeta está dentro de un servicio de sincronización (Google Drive para escritorio,
OneDrive, Dropbox, Syncthing…), los mismos recursos aparecen en sus otros equipos.
PyroStudio no usa ninguna API de proveedor: trabaja con la carpeta como un directorio
local y el cliente de sincronización se encarga de copiar los archivos.

Si no elige ninguna carpeta, PyroStudio sigue usando el **almacenamiento local**
habitual (solo en este equipo), exactamente como antes.

## Crear un workspace

1. Abra **Configuración → Workspace**.
2. Escriba un nombre visible (opcional) y pulse **Elegir carpeta y crear**.
3. Seleccione una carpeta vacía. PyroStudio crea:

```text
<carpeta>/
├── workspace.json          manifiesto (versión, id, nombre, fecha)
├── connections/<id>.json   una conexión por archivo, sin secretos
├── queries/<conexión>/<base de datos>/<título>.sql   consultas asociadas a una BD
├── queries/<categoría>/<título>.sql                  consultas generales
└── snippets/               archivos .sql adicionales (opcional)
```

4. Si tiene conexiones o consultas guardadas localmente, PyroStudio ofrece
   **importarlas** (vea «Migración»).

## Usar Google Drive para escritorio

1. Instale Google Drive para escritorio e inicie sesión.
2. Cree una carpeta, por ejemplo `Mi unidad/PyroStudio`. En la configuración de Drive
   conviene marcarla como **disponible sin conexión** («Available offline» / «Mirror»),
   para que los archivos estén siempre en disco.
3. En PyroStudio cree el workspace eligiendo esa carpeta.

## Abrirlo en otra computadora

1. Espere a que Drive termine de sincronizar la carpeta.
2. En PyroStudio: **Configuración → Workspace → Abrir workspace…** y elija la carpeta
   (puede tener otra ruta absoluta, p. ej. `G:\Mi unidad\PyroStudio` en Windows y
   `~/Library/CloudStorage/GoogleDrive-…/Mi unidad/PyroStudio` en macOS).
3. Las conexiones aparecen con **«Credenciales pendientes en este equipo»**: edite la
   conexión, escriba la contraseña y guarde o conecte. La contraseña se guarda solo en el
   almacén cifrado local; el archivo compartido no cambia.

Ningún equipo se conecta automáticamente a un servidor por el hecho de abrir el workspace.

## Qué se comparte y qué no

| Se guarda en la carpeta compartida | Permanece en este equipo |
| --- | --- |
| Nombre, host, puerto, usuario, base de datos, entorno, color | Contraseñas de base de datos |
| Configuración TLS (incluida la *ruta* al CA) | Usuario/contraseña HTTP y token Bearer del túnel |
| Túnel SSH (host, usuario, método, *ruta* a la clave privada) | Claves de proveedores de IA |
| Túnel HTTP (URL, usuario, opciones) | `master.key` y `secrets.vault` |
| Referencias lógicas de credenciales (`cred-<idConexión>`) | Ruta absoluta del workspace (`workspace.local.json`) |
| Consultas `.sql` con título, categoría y descripción | Última conexión usada / fecha de última conexión |
| | Historial de consultas, pestañas, preferencias, tema, notas |

Las rutas a archivos (CA, clave SSH) se comparten tal cual porque son configuración, no
secretos; si difieren entre equipos, edítelas en cada uno o use rutas equivalentes.

La serialización segura se aplica dos veces: en TypeScript (`toSharedConnection`) y en
Rust (`repository::sanitize_connection`), que además elimina cualquier campo cuyo nombre
indique un secreto (`password`, `token`, `secret`, `passphrase`, `apiKey`, `privateKey`…)
y vuelve a filtrar al **leer**, por si alguien edita un archivo a mano.

## Credenciales

* El almacén local (AES-256-GCM, `master.key` + `secrets.vault` en el directorio de datos
  del usuario) no se mueve ni se sincroniza. Protege frente a la lectura casual de los
  archivos, pero la clave está en el mismo disco: no es un HSM ni sustituye al cifrado de
  disco del sistema operativo.
* Las referencias (`credentialId`, `tunnel_credential_id`, `token_credential_id`) son
  identificadores lógicos derivados del id de la conexión. Cada equipo resuelve la
  referencia en su propio almacén.
* Renombrar una conexión o cambiar de workspace no borra credenciales. Solo se borran al
  eliminar explícitamente una conexión, y solo si ninguna otra conexión las usa.
* Si `master.key` tiene una longitud inválida y existe `secrets.vault`, PyroStudio **ya no
  regenera la clave** (eso dejaría el almacén ilegible): muestra un error con los pasos de
  recuperación. Si no hay almacén que proteger, la clave dañada se renombra a
  `master.key.invalid-<timestamp>` y se crea una nueva.

## Formato de las consultas

Las consultas son archivos `.sql` válidos. Los metadatos van en una cabecera de
comentarios; solo se reconocen estas claves, al principio del archivo:

```sql
-- pyro-id: 0d5f…           identificador estable (no depende del título ni de la ruta)
-- pyro-title: Estadísticas de alumnos
-- pyro-category: Reportes
-- pyro-description: Resumen por periodo.   (\n y \\ escapados)
-- pyro-connection: conn-1700000000-abc12  (opcional: conexión a la que pertenece)
-- pyro-database: escuela                  (opcional: base de datos dentro de ella)
-- pyro-folder: reportes                   (opcional: carpeta dentro de esa base de datos)
-- pyro-created: 2026-10-21T00:00:00.000Z
-- pyro-updated: 2026-10-21T00:00:00.000Z

SELECT periodo, COUNT(*) FROM alumnos GROUP BY periodo;
```

* El cuerpo SQL se conserva byte a byte; PyroStudio nunca lo interpreta.
* Los archivos sin cabecera también se listan: título = nombre del archivo, categoría =
  carpeta, id derivado de la ruta relativa. Al guardarlos desde PyroStudio se añade la
  cabecera.
* El nombre del archivo se deriva del título y la categoría, saneado (sin separadores,
  `..`, nombres reservados de Windows). Si ya existe, se añade ` (2)`, ` (3)`… nunca se
  sobrescribe otro archivo. Cambiar título o categoría mueve el archivo y mantiene el id.
* Las consultas predefinidas de PyroStudio se muestran siempre pero no se copian al
  workspace; si edita una, se guarda en el workspace con el mismo id y la sustituye.

## Carpetas de conexiones

Las conexiones pueden agruparse en carpetas (campo `folder` del JSON, compartido con el
workspace). En la pantalla de inicio las carpetas se pliegan, se renombran con doble
clic y las conexiones se mueven arrastrándolas; en el administrador de conexiones el
campo «Carpeta» sugiere las existentes. Qué carpetas están plegadas es una preferencia
local de cada equipo.

## Consultas por base de datos

Una consulta puede pertenecer a una conexión y a una base de datos (`pyro-connection` /
`pyro-database`). En el explorador aparece el nodo **Consultas** bajo cada base de datos
de la conexión activa: clic para abrir, doble clic o lápiz para renombrar, papelera para
eliminar y «+» para una consulta nueva en esa base de datos. En el editor, **Ctrl+S**
guarda directamente la consulta abierta; en una pestaña nueva ofrece guardarla asociada
a la base de datos activa. La ruta del archivo usa el nombre visible de la conexión y es
solo orientativa: la asociación real está en la cabecera, así que renombrar una conexión
no rompe nada.

### Carpetas y panel de objetos

Dentro de cada base de datos las consultas pueden organizarse en carpetas (cabecera
`pyro-folder`, un nivel; en disco `queries/<conexión>/<base de datos>/<carpeta>/`).
En el explorador, **Tablas, Vistas, Funciones, Procedimientos y Consultas** son nodos:
la flecha despliega la lista y el nombre abre el **panel de objetos** en una pestaña
(lista con columnas ordenables o vista de iconos, búsqueda, doble clic para abrir,
Supr para eliminar, F2 para renombrar). En el panel de consultas: «Nueva carpeta»,
arrastrar una consulta sobre una carpeta (o sobre la ruta superior para sacarla) y
renombrar o quitar carpetas. Una carpeta vacía solo se recuerda en este equipo hasta
que contiene alguna consulta.

Las **tablas, vistas, funciones y procedimientos** también pueden agruparse en carpetas.
Las carpetas solo organizan la vista: no crean, renombran ni eliminan nada en la base
de datos. Se guardan por conexión en `groups/<id-conexión>.json`:

```json
{ "formatVersion": 1,
  "databases": { "modulopa": { "tables": { "rolado": ["mpa_bloques", "mpa_historico"] } } } }
```

Cada objeto está como mucho en una carpeta por tipo; las carpetas vacías se conservan.
Las escrituras son atómicas y comprueban que el archivo no cambió desde que se leyó;
si otro equipo lo modificó, PyroStudio relee el archivo y vuelve a aplicar solo su
cambio, sin pisar el del otro. Sin workspace, las carpetas se guardan en este equipo.

En el editor, **Guardar** (Ctrl+S) actualiza la consulta abierta; el punto naranja en el
botón y en la pestaña indica cambios sin guardar. **Ctrl+Mayús+S** guarda como nueva.

## Ediciones simultáneas y conflictos

La sincronización de archivos no ofrece transacciones ni bloqueos. PyroStudio es
conservador:

* Todas las escrituras van a un archivo temporal en la misma carpeta, se sincronizan a
  disco, se verifican y luego se renombran sobre el destino. Si algo falla, el archivo
  anterior queda intacto.
* Cada consulta lleva un *hash* del contenido leído. Al guardar o borrar, si el archivo
  cambió en disco (otro equipo, un editor externo), PyroStudio pregunta: **Sobrescribir**
  o **Guardar como copia** (se conservan ambas versiones).
* La lista se recarga al volver a enfocar la ventana y con **Recargar desde disco**.
* Si el proveedor crea copias de conflicto con el mismo `pyro-id`, se muestra una sola y
  la otra aparece en «archivos que no se pudieron leer»; nunca se borran.
* Las conexiones se escriben archivo por archivo; ante ediciones simultáneas de la misma
  conexión gana la última sincronizada (no hay detección de conflictos para conexiones en
  esta versión).

No hay sincronización instantánea: los cambios aparecen cuando el cliente de
sincronización los descarga.

## Carpeta no disponible o movida

Al iniciar, PyroStudio lee la ruta local, comprueba la carpeta y valida el manifiesto.
Si la carpeta no está montada, se movió, faltan permisos o el manifiesto es inválido,
el workspace aparece como **No disponible** / **No válido** (no como vacío), no se
guarda nada en otro sitio y no se crea un workspace vacío. Opciones:

* **Reintentar** cuando Drive termine de montar.
* **Localizar carpeta…** para apuntar a la nueva ruta (debe ser el mismo workspace: se
  comprueba `workspaceId`).
* **Usar almacenamiento local** para volver al modo local (la carpeta no se toca).

## Migración desde el almacenamiento local

**Configuración → Workspace → Importar al workspace** (también se ofrece al crear uno):

1. Lee `pyro_saved_connections_v1` y `pyro_sql_favorites_v1` sin modificarlos.
2. Excluye secretos y las consultas predefinidas que no se hayan editado.
3. Escribe las conexiones y los `.sql`; vuelve a leerlos del disco y compara ids y campos.
4. Muestra un informe: nuevos, ya existentes, conflictos (mismo id con otro contenido, no
   se sobrescriben) y datos inválidos.
5. Solo se marca como completada si la verificación es correcta. Los datos de
   `localStorage` **no se borran**. Repetirla es seguro: no duplica.

## Versiones del formato

| Versión | PyroStudio | Notas |
| --- | --- | --- |
| 1 | 0.1.x | `workspace.json`, `connections/*.json` (`{formatVersion, connection}`), `.sql` con cabecera `pyro-*` |

Un workspace o archivo con una versión **mayor** que la soportada se rechaza con un
mensaje y **no se reescribe**.

### Cómo evolucionar el formato (para desarrolladores)

* Añadir un campo opcional a una conexión **no** requiere cambiar la versión: los campos
  desconocidos se conservan al leer y escribir (los JSON se manejan como objetos
  genéricos, sin acoplarse al estado de Zustand).
* Añadir una clave de cabecera SQL: agréguela a `KEYS` en `query_files.rs`; versiones
  antiguas la tratarán como parte del SQL (es un comentario, sigue siendo SQL válido).
* Un cambio incompatible: incremente `FORMAT_VERSION` en `models.rs`, implemente la
  migración en `migration.rs` (leer vN → escribir vN+1 con escritura atómica) y añada
  pruebas. Nunca reescriba automáticamente un archivo de versión futura.

## Implementación

* Rust: `src-tauri/src/workspace/` (`models`, `repository`, `query_files`, `service`,
  `migration`, `commands`, `error`, `tests`). Las carpetas se eligen solo con el diálogo
  nativo en Rust; el frontend nunca envía rutas, solo ids validados
  (`[A-Za-z0-9._-]`, sin `..`). Cada ruta se comprueba contra la raíz canónica del
  workspace (protección frente a *traversal* y enlaces simbólicos). No se añadieron
  permisos ni plugins de sistema de archivos a Tauri.
* Configuración local: `<config del usuario>/PyroStudio/workspace.local.json`.
* Frontend: `services/workspaceService.ts`, `stores/workspaceStore.ts`,
  `components/WorkspaceSettings.tsx`; `connectionStorage` y `favoritesStorage` delegan en
  el workspace cuando hay uno activo.
