# 🗺️ Roadmap V3 — Administración Avanzada, Seguridad y Modelado (PyroStudio)

Este documento define la planificación y especificación técnica de las capacidades avanzadas de administración, seguridad y modelado para **PyroStudio**. Continúa la evolución del cliente tras completar exitosamente el **Roadmap de Estabilidad (Fases 0–8)**, el **Roadmap de Rendimiento (Fases 1–11)** y el **Roadmap V2 de Capacidades Avanzadas (Fases 1–4)**.

---

## 📊 Resumen de Fases

| Fase | Título | Estado | Impacto Principal |
| :---: | :--- | :---: | :--- |
| **1** | **Inspector de Bloqueos, Transacciones Activas y Árbol de Concurrencia** | 📋 Pendiente | Diagnóstico y resolución de bloqueos en vivo (`innodb_trx`, `data_locks`, `data_lock_waits`) con árbol de dependencias y terminación segura |
| **2** | **Gestión Visual de Usuarios, Roles y Matriz de Privilegios** | 📋 Pendiente | Administración completa de usuarios MySQL/MariaDB (`GRANT`, `REVOKE`, expiración de claves, cuotas) con matriz intuitiva de permisos y auditoría |
| **3** | **Enmascaramiento y Anonimización de Datos para Entornos de Desarrollo** | 📋 Pendiente | Exportación y clonación segura de bases de datos productivas a desarrollo con sustitución de PII (emails, nombres, tarjetas) preservando integridad referencial |
| **4** | **Diseñador Visual de Esquemas y Generador de Migraciones DDL Bidireccional** | 📋 Pendiente | Modelado interactivo de tablas y relaciones foráneas con generación de migraciones reversibles (up/down) y detección de diferencias |
| **5** | **Creación Intuitiva, Rápida y Automatizada de Primary Keys y Auto-increment** | 📋 Pendiente | Experiencia fluida de 1 clic para definir claves primarias e identificadores autoincrementales en modales de creación (`CreateTableModal`), diseñador ER y adición de columnas |

---

## 🎯 Especificación Detallada por Fases

---

### Fase 1 — Inspector de Bloqueos, Transacciones Activas y Árbol de Concurrencia (*Lock & Transaction Inspector*)
**Objetivo:** Proporcionar visibilidad instantánea sobre contenciones, deadlocks y transacciones de larga duración que degradan el servidor, permitiendo identificar la raíz del bloqueo y resolverlo de forma segura sin salir de la app.

- **Arquitectura y Capas:**
  - `src-tauri/src/db/`:
    - Módulo de diagnóstico de concurrencia (`concurrency.rs` o `locks.rs`):
      - Detección adaptativa de motor y versión:
        - MySQL 8.0+: consulta `performance_schema.data_locks` y `performance_schema.data_lock_waits` unidas con `information_schema.innodb_trx` y `sys.innodb_lock_waits`.
        - MySQL 5.7 / MariaDB: consulta `information_schema.innodb_locks`, `innodb_lock_waits` e `innodb_trx`.
        - SQLite: inspección de estado de base de datos (`PRAGMA busy_timeout`, modo WAL y locks de escritura).
    - Mapeo de grafo dirigido de dependencias: identificar quién es el proceso bloqueador raíz (*root blocker*) y la cadena de procesos en espera (*waiting victims*).
    - Acciones seguras de mitigación: `kill_query(query_id)` y `kill_connection(thread_id)` con protección Safe Mode (confirmación explícita para matar hilos en entornos PROD/Staging).
  - `src-tauri/src/db/service.rs`, `db/mod.rs` & `lib.rs`:
    - Comandos Tauri IPC: `get_active_locks_and_transactions`, `kill_server_thread`.
  - `src/components/`:
    - Nueva pestaña de diagnóstico `LocksInspectorTab.tsx` accesible desde la barra superior de herramientas o desde el Dashboard en vivo al detectar picos de bloqueo (`Innodb_row_lock_current_waits > 0`).
    - Visualización dual:
      - **Vista de Árbol / Grafo:** Desglose jerárquico del hilo bloqueador raíz con sus dependientes anidados, tiempo transcurrido en bloqueo, sentencia SQL exacta causante y tabla implicada.
      - **Tabla de Transacciones Activas:** Listado ordenable por duración, estado (`RUNNING`, `LOCK WAIT`), modo de aislamiento y número de filas bloqueadas.
    - Botón de acción con estilo semántico (`dangerGhostBtn`) para `Terminar Consulta` o `Cerrar Conexión` protegido por el modal `ConfirmModal`.
  - **Pruebas y Verificación:**
    - Pruebas unitarias en Rust: parseo de tablas de locks según versión/motor, construcción del árbol de dependencias sin ciclos infinitos.
    - Pruebas en Vitest: renderizado del inspector, advertencias de bloqueo activo y confirmación destructiva antes de invocar `kill`.

---

### Fase 2 — Gestión Visual de Usuarios, Roles y Matriz de Privilegios (*User & Permission Manager*)
**Objetivo:** Simplificar y asegurar la administración de identidades, autenticación, cuotas de recursos y permisos en servidores MySQL y MariaDB, reemplazando la necesidad de redactar manualmente sentencias `GRANT` y `REVOKE` complejas.

- **Arquitectura y Capas:**
  - `src-tauri/src/db/`:
    - Módulo de administración de usuarios y permisos (`users.rs`):
      - Introspección completa de cuentas: `mysql.user`, `mysql.db`, `mysql.tables_priv`, `mysql.columns_priv` y roles de MySQL 8 / MariaDB (`SHOW GRANTS FOR 'user'@'host'`).
      - Soporte para plugins de autenticación (`caching_sha2_password`, `mysql_native_password`, `ed25519`).
      - Detección de atributos modernos: políticas de expiración de contraseñas, bloqueo temporal de cuentas (`ACCOUNT LOCK/UNLOCK`), requerimiento de TLS (`REQUIRE SSL`) y límites de recursos (`MAX_QUERIES_PER_HOUR`, `MAX_CONNECTIONS_PER_HOUR`).
      - Generador seguro de DDL: generación idempotente de `CREATE USER`, `ALTER USER`, `DROP USER`, `GRANT` y `REVOKE` con validación previa de Safe Mode.
  - `src-tauri/src/db/service.rs`, `db/mod.rs` & `lib.rs`:
    - Comandos Tauri IPC: `list_database_users`, `get_user_permissions`, `save_user_permissions`, `create_user`, `delete_user`.
  - `src/components/`:
    - Pestaña de administración `UserManagerTab.tsx` con navegación lateral de cuentas (`usuario@host`).
    - **Matriz Visual de Permisos:** Grilla categorizada por ámbito:
      - **Administrativos / Globales:** `RELOAD`, `PROCESS`, `SUPER`, `REPLICATION SLAVE/CLIENT`, etc.
      - **Estructura (DDL):** `CREATE`, `ALTER`, `DROP`, `INDEX`, `CREATE VIEW`, etc.
      - **Datos (DML):** `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `EXECUTE`, etc.
    - Selector granular por Base de Datos y Tabla, con casilla rápida de «Seleccionar Todos» / «Solo Lectura».
    - Barra flotante de cambios pendientes con previsualización de las sentencias SQL resultantes (`Preview SQL`) y botón de aplicación con confirmación.
  - **Pruebas y Verificación:**
    - Pruebas unitarias en Rust: generación de sentencias `GRANT` y `REVOKE` sin inyección SQL, parseo de permisos heredados de roles.
    - Pruebas en Vitest: interacción con la matriz de privilegios, validación de formularios de nueva cuenta y previsualización de SQL.

---

### Fase 3 — Enmascaramiento y Anonimización de Datos Sensibles (*Data Masking & Privacy Generator*)
**Objetivo:** Permitir a las organizaciones extraer respaldos o clonar bases de datos productivas hacia entornos de desarrollo, pruebas o analítica cumpliendo normativas de privacidad (GDPR, HIPAA, LGPD) mediante la sustitución determinista de PII (Información Personal Identificable).

- **Arquitectura y Capas:**
  - `src-tauri/src/db/`:
    - Módulo de anonimización (`masking.rs`):
      - Reglas de enmascaramiento configurables por columna y tipo de dato:
        - **Nombres y Apellidos:** Reemplazo determinista o pseudo-aleatorio realista desde catálogos localizados.
        - **Correos Electrónicos:** Enmascaramiento parcial (`j***e@dominio.com`) o generación de alias sintéticos (`user_12345@test.local`).
        - **Teléfonos y Documentos:** Formato conservado con dígitos permutados o ceros fijos.
        - **Fechas de Nacimiento:** Desplazamiento aleatorio acotado ($\pm 30$ días) para conservar distribución estadística sin identificar al sujeto.
        - **Cadenas y Tarjetas:** Enmascaramiento por máscara fija (`**** **** **** 1234`) o hash irreversibilizado (SHA-256 truncado).
      - **Preservación de Integridad Referencial:** Cuando una columna participa en una clave foránea (FK) o clave primaria compuesta, el enmascarador aplica una función determinista con semilla (`salted hash`), asegurando que las relaciones entre tablas padres e hijas se mantengan intactas tras la anonimización.
    - Integración transparente con el pipeline de volcado SQL (`sql_dump.rs`) y exportación CSV/Excel (`excel/exporter.rs`): streaming directo sin cargar la tabla completa en memoria.
  - `src-tauri/src/db/service.rs`, `db/mod.rs` & `lib.rs`:
    - Comandos Tauri IPC: `get_masking_presets`, `save_masking_profile`, `export_masked_dump`.
  - `src/components/`:
    - Modal y panel de configuración de exportación enmascarada `DataMaskingModal.tsx`.
    - Detección automática inteligente: sugerencia proactiva de reglas al identificar nombres de columna sensibles (`email`, `correo`, `phone`, `telefono`, `ssn`, `dni`, `tarjeta`, `credit_card`, `birth_date`).
    - Selector de perfil reutilizable guardado en el workspace (`.pyro/masking/*.json`).
  - **Pruebas y Verificación:**
    - Pruebas en Rust: preservación de integridad referencial entre tablas relacionadas, no reversibilidad de hashes y streaming sin fugas de memoria.
    - Pruebas en Vitest: inferencia automática de reglas por nombre de columna y validación de perfiles.

---

### Fase 4 — Diseñador Visual de Esquemas y Generador de Migraciones DDL (*Visual Schema Designer & Migration Builder*)
**Objetivo:** Transformar el visor de diagramas Entidad-Relación actual en un modelador bidireccional que permita diseñar tablas, claves y relaciones visualmente, produciendo migraciones SQL estructuradas y comprobables.

- **Arquitectura y Capas:**
  - `src-tauri/src/db/`:
    - Motor de diferencias de esquema y generación de migraciones (`migration.rs` & `diff.rs`):
      - Comparación del esquema modelado vs. el esquema físico actual de la base de datos.
      - Generación secuencial de DDL reversible:
        - Script `UP`: Creación de tablas, nuevas columnas, índices y restricciones foráneas en el orden topológico correcto.
        - Script `DOWN`: Reversión limpia (`DROP CONSTRAINT`, `DROP COLUMN`, `DROP TABLE`).
      - Detección preventiva de pérdidas de datos (por ejemplo, advertencia si se reduce la longitud de un `VARCHAR` o se cambia un tipo a uno incompatible).
  - `src-tauri/src/db/service.rs`, `db/mod.rs` & `lib.rs`:
    - Comandos Tauri IPC: `generate_schema_migration`, `apply_schema_migration`.
  - `src/components/`:
    - Evolución de `ErDiagramModal.tsx` hacia `SchemaDesignerTab.tsx`:
      - Modo edición: arrastrar puertos de relación entre columnas para crear Foreign Keys con configuración de `ON DELETE` / `ON UPDATE` (`CASCADE`, `SET NULL`, `RESTRICT`).
      - Panel lateral tipo RightDock (`RightDock.tsx`) para editar propiedades de la tabla seleccionada (nombre, motor, cotejamiento, columnas, índices primarios y secundarios).
      - Modal de revisión de migración: previsualización del SQL generado antes de tocar la base de datos, con opción de exportar el script a un archivo del workspace (`.sql`) o ejecutarlo directamente con Safe Mode activo.
  - **Pruebas y Verificación:**
    - Pruebas unitarias en Rust: ordenación topológica de dependencias en scripts `UP`, validación de scripts `DOWN` simétricos, rechazo de ciclos circulares inválidos.
---

### Fase 5 — Creación Intuitiva, Rápida y Automatizada de Primary Keys y Auto-increment
**Objetivo:** Garantizar que definir claves primarias e identificadores numéricos autoincrementales sea un proceso inmediato, intuitivo y automático en todas las superficies de creación y edición de tablas del sistema, minimizando errores de configuración manual y acelerando el modelado de bases de datos.

- **Puntos Clave y Mejoras UX:**
  - **1. Asistente de Creación de Tablas (`CreateTableModal.tsx`):**
    - **Botón de acción rápida «Añadir ID Autoincremental» (1 solo clic):** Inserta al inicio de la tabla una columna `id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY` lista para usar sin necesidad de configurar cada campo manualmente.
    - **Sincronización Inteligente Bidireccional:**
      - Si el usuario marca la casilla `PK` en una columna de tipo entero (`INT`, `BIGINT`, `SMALLINT`, `TINYINT`), el sistema sugiere o marca automáticamente `Auto-increment` y desmarca `Permite NULL`.
      - Si el usuario marca la casilla `Auto-increment`, el sistema asegura automáticamente que el tipo sea entero, marca `PK` y deshabilita `Permite NULL` (requisito de MySQL, MariaDB y SQLite).
      - Si el usuario cambia el tipo de dato a texto o fecha, desactiva automáticamente `Auto-increment` para prevenir sintaxis SQL inválida.
    - **Plantillas Rápidas de Clave Primaria:** Atajos rápidos para los 3 patrones estándar en bases de datos:
      - `id BIGINT AUTO_INCREMENT` (Estándar relacional recomendado)
      - `uuid CHAR(36)` (Identificador universal)
      - `codigo VARCHAR(50)` (Clave de negocio)
  - **2. Diseñador Visual de Esquemas (`SchemaDesignerTab.tsx` / Fase 4):**
    - Cada nueva tabla añadida al lienzo visual incluye por defecto un campo `id` autoincremental como clave primaria.
    - Acciones contextuales sobre columnas para convertir cualquier campo en `Primary Key` o alternar `Auto Increment` con un clic o atajo de teclado.
  - **3. Importador de Datos (`ExcelImportModal.tsx`):**
    - Cuando se importa un archivo CSV/Excel creando una nueva tabla y el archivo no contiene una columna identificadora unívoca, el modal ofrece de forma predeterminada: «*Agregar columna id autoincremental como Primary Key*».
  - **4. Adición y Modificación de Columnas en Tablas Existentes (`TableViewer.tsx` / Alter Table):**
    - Al añadir una nueva columna a una tabla sin Primary Key (ver regla 4 de [AGENTS.md](file:///C:/Users/Carlos%20G/Desktop/Repos/PyroStudio/AGENTS.md)), ofrecer directamente la opción de agregarla como `AUTO_INCREMENT PRIMARY KEY`, facilitando que la tabla pase al modo de edición interactivo óptimo sin requerir el modo fila completa.
- **Pruebas y Verificación:**
  - Pruebas en Vitest: validación de sincronización de estados (`isPrimaryKey`, `isAutoIncrement`, `isNullable`, `dataType`), presets de un clic y generación correcta de DDL en `mysqlDdl.ts` y `sqliteDdl.ts`.
  - Pruebas en Rust: verificación de compatibilidad de tipos para DDL generado y sintaxis `AUTO_INCREMENT` (MySQL) vs `AUTOINCREMENT` / `INTEGER PRIMARY KEY` (SQLite).

---

## 🛡️ Reglas y Directrices de Implementación

1. **Cumplimiento estricto de [AGENTS.md](file:///C:/Users/Carlos%20G/Desktop/Repos/PyroStudio/AGENTS.md):**
   - **Prohibición absoluta de diálogos nativos (`alert()`, `confirm()`, `prompt()`):** Toda alerta o confirmación debe utilizar `ConfirmModal` o las acciones globales de `useUIStore`.
   - **Interfaz minimalista:** Utilizar las primitivas compartidas (`primaryBtn`, `secondaryBtn`, `ghostBtn`, `dangerBtn`, `inputClass`, `cardClass`, `sectionLabel`) y tokens de tema de `src/components/ui/styles.ts`.
   - **Seguridad en conexiones y Safe Mode:** Toda operación destructiva (`KILL`, `DROP USER`, `REVOKE`, migraciones DDL) debe requerir confirmación explícita según el entorno (`Production`, `Staging`, `Development`).
   - **Vault cifrado:** Nunca enviar contraseñas de usuarios creados ni secretos al frontend en texto plano.
2. **Pruebas Automatizadas y Calidad Obligatoria:**
   - Pruebas unitarias en Rust: `cargo test --manifest-path src-tauri/Cargo.toml --lib`.
   - Linter Rust: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
   - Pruebas en Frontend: `npm test` (Vitest).
   - Verificación de tipos: `npx tsc --noEmit`.
