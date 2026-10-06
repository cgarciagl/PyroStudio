import type { SqlDiagnosticResult } from "../types/database";

/**
 * Diagnostic patterns for common MySQL and MariaDB error codes and error text.
 */
interface ErrorDiagnosticPattern {
  code?: number;
  sqlstate?: string;
  pattern?: RegExp;
  category: string;
  suggestedAction: string;
  explanation: string;
  docLink?: string;
}

const ERROR_PATTERNS: ErrorDiagnosticPattern[] = [
  {
    code: 1064,
    sqlstate: "42000",
    pattern: /syntax error|check the manual that corresponds to your MariaDB|check the manual that corresponds to your MySQL/i,
    category: "Sintaxis SQL (Error 1064)",
    suggestedAction: "Revisa la sintaxis SQL cerca de la posición indicada en el mensaje. Comprueba palabras reservadas no escapadas, comillas faltantes o comas sobrantes.",
    explanation: "El analizador sintáctico de MariaDB/MySQL encontró un token inesperado. Si estás usando una palabra reservada como nombre de columna o tabla (ej. `order`, `group`, `status`), debes encerrarla entre comillas invertidas (`columna`).",
  },
  {
    code: 1146,
    sqlstate: "42S02",
    pattern: /table .* doesn't exist/i,
    category: "Objeto no Encontrado (Error 1146)",
    suggestedAction: "Verifica que el nombre de la tabla esté bien escrito y que estés conectado a la base de datos correcta (`USE database;` o califica con `db.table`).",
    explanation: "La tabla o vista especificada no existe en el esquema seleccionado. En sistemas Linux, los nombres de tablas son sensibles a mayúsculas y minúsculas según la variable `lower_case_table_names`.",
  },
  {
    code: 1054,
    sqlstate: "42S22",
    pattern: /unknown column/i,
    category: "Columna Desconocida (Error 1054)",
    suggestedAction: "Verifica los nombres de las columnas con el inspector de tablas o ejecuta 'DESCRIBE `tabla`;'.",
    explanation: "Una o más columnas especificadas en SELECT, WHERE, ORDER BY o JOIN no existen en las tablas involucradas en la consulta.",
  },
  {
    code: 1062,
    sqlstate: "23000",
    pattern: /duplicate entry .* for key/i,
    category: "Violación de Clave Única (Error 1062)",
    suggestedAction: "Verifica si el registro ya existe antes de insertarlo, o utiliza 'INSERT ... ON DUPLICATE KEY UPDATE' o 'INSERT IGNORE'.",
    explanation: "Intentaste insertar o actualizar una fila con un valor que ya existe en una columna o conjunto de columnas con restricción PRIMARY KEY o UNIQUE KEY.",
  },
  {
    code: 1452,
    sqlstate: "23000",
    pattern: /cannot add or update a child row: a foreign key constraint fails/i,
    category: "Restricción de Clave Foránea (Error 1452)",
    suggestedAction: "Verifica que el valor de la clave foránea exista en la tabla padre referenciada antes de insertar o modificar el registro hijo.",
    explanation: "La restricción de integridad referencial (Foreign Key) bloqueó la operación porque el ID referenciado no existe en la tabla principal.",
  },
  {
    code: 1451,
    sqlstate: "23000",
    pattern: /cannot delete or update a parent row: a foreign key constraint fails/i,
    category: "Restricción de Clave Foránea (Error 1451)",
    suggestedAction: "Elimina o actualiza primero los registros hijos dependientes, o configura la clave foránea con 'ON DELETE CASCADE' si es apropiado.",
    explanation: "No se puede eliminar la fila padre porque existen registros secundarios en otra tabla que dependen de ella.",
  },
  {
    code: 1205,
    sqlstate: "HY000",
    pattern: /lock wait timeout exceeded/i,
    category: "Tiempo de Espera de Bloqueo Excedido (Error 1205)",
    suggestedAction: "Verifica transacciones abiertas no confirmadas ('SHOW ENGINE INNODB STATUS') o reduce el tiempo que duran las transacciones en tu aplicación.",
    explanation: "Una transacción InnoDB esperó por un bloqueo de fila retenido por otra sesión durante más tiempo que 'innodb_lock_wait_timeout'.",
  },
  {
    code: 1213,
    sqlstate: "40001",
    pattern: /deadlock found when trying to get lock/i,
    category: "Interbloqueo (Deadlock 1213)",
    suggestedAction: "Reintenta la transacción en la aplicación y asegúrate de que todas las consultas accedan a las tablas en el mismo orden.",
    explanation: "Dos o más transacciones quedaron bloqueadas mutuamente esperando recursos que la otra retiene. El motor InnoDB canceló automáticamente una de las transacciones.",
  },
  {
    code: 1045,
    sqlstate: "28000",
    pattern: /access denied for user/i,
    category: "Autenticación / Permisos (Error 1045)",
    suggestedAction: "Verifica las credenciales (usuario y contraseña) y asegúrate de que el usuario tenga permisos ('GRANT') para conectarse desde tu host.",
    explanation: "El servidor rechazó las credenciales proporcionadas o el usuario no tiene permisos suficientes sobre el recurso solicitado.",
  },
  {
    code: 1114,
    sqlstate: "HY000",
    pattern: /the table .* is full/i,
    category: "Espacio de Tabla Agotado (Error 1114)",
    suggestedAction: "Verifica el espacio en disco del servidor o incrementa 'innodb_data_file_path' y 'max_heap_table_size'.",
    explanation: "El espacio asignado al tablespace de la tabla o a las tablas temporales en memoria se ha agotado.",
  },
  {
    code: 1364,
    sqlstate: "HY000",
    pattern: /doesn't have a default value/i,
    category: "Columna Requerida Sin Valor (Error 1364)",
    suggestedAction: "Especifica un valor para la columna en la sentencia INSERT o define un valor por defecto ('DEFAULT') en la tabla.",
    explanation: "En modo estricto (STRICT_TRANS_TABLES), MariaDB/MySQL no permite omitir columnas NOT NULL que no tengan un valor por defecto configurado.",
  },
];

/**
 * Parses raw error strings and server error objects to produce structured diagnostics.
 * NEVER obscures or modifies the original error message.
 */
export function diagnoseSqlError(rawError: unknown): SqlDiagnosticResult {
  const errorStr =
    typeof rawError === "string"
      ? rawError
      : (rawError as Error)?.message || JSON.stringify(rawError);

  // Extract error code if present (e.g., Error 1064, Code: 1064, (errno: 1064))
  const codeMatch = errorStr.match(/(?:error|errno|code)\s*[:=]?\s*(\d{4,5})/i);
  const errorCode = codeMatch ? parseInt(codeMatch[1], 10) : undefined;

  // Extract SQLSTATE if present (e.g. SQLSTATE[42000] or SQLSTATE: 42000)
  const sqlStateMatch = errorStr.match(/SQLSTATE(?:\[|:\s*)([A-Z0-9]{5})/i);
  const sqlstate = sqlStateMatch ? sqlStateMatch[1] : undefined;

  // Extract query position if present (e.g. at line 1, column 15)
  const posMatch = errorStr.match(/(?:at line|line)\s*(\d+)/i);
  const errorPosition = posMatch ? parseInt(posMatch[1], 10) : undefined;

  // Match with known diagnostic catalog
  let matchedPattern: ErrorDiagnosticPattern | undefined;

  if (errorCode) {
    matchedPattern = ERROR_PATTERNS.find((p) => p.code === errorCode);
  }

  if (!matchedPattern && sqlstate) {
    matchedPattern = ERROR_PATTERNS.find((p) => p.sqlstate === sqlstate);
  }

  if (!matchedPattern) {
    matchedPattern = ERROR_PATTERNS.find((p) => p.pattern && p.pattern.test(errorStr));
  }

  if (matchedPattern) {
    return {
      original_error: errorStr,
      error_code: errorCode || matchedPattern.code,
      sqlstate: sqlstate || matchedPattern.sqlstate,
      message: errorStr,
      error_position: errorPosition,
      category: matchedPattern.category,
      suggested_action: matchedPattern.suggestedAction,
      explanation: matchedPattern.explanation,
      documentation_link: matchedPattern.docLink,
    };
  }

  // Fallback for unrecognized errors
  return {
    original_error: errorStr,
    error_code: errorCode,
    sqlstate,
    message: errorStr,
    error_position: errorPosition,
    category: "Error de Ejecución SQL",
    suggested_action: "Verifica los parámetros de la consulta y revisa el log del servidor MariaDB para más detalles.",
    explanation: "El servidor de base de datos devolvió un error durante la ejecución de la sentencia.",
  };
}
