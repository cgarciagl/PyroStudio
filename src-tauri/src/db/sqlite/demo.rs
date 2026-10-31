//! Optional demo database (a small shop) the user can create from the first-run
//! wizard or the command palette. It lives in the app data folder and is built
//! on demand, so nothing is bundled and nothing is written unless asked.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::PathBuf;

use crate::db::error::PyroError;

const DEMO_FILE: &str = "tienda_demo.sqlite3";

const SCHEMA_AND_DATA: &str = r#"
CREATE TABLE clientes (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  ciudad TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE productos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  precio REAL NOT NULL CHECK (precio >= 0),
  stock INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  total REAL NOT NULL DEFAULT 0
);
CREATE TABLE pedido_lineas (
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario REAL NOT NULL,
  PRIMARY KEY (pedido_id, producto_id)
);
CREATE INDEX idx_pedidos_cliente ON pedidos(cliente_id);

-- Keeps pedidos.total in sync with its lines.
CREATE TRIGGER trg_lineas_total AFTER INSERT ON pedido_lineas
BEGIN
  UPDATE pedidos SET total = (
    SELECT COALESCE(SUM(cantidad * precio_unitario), 0) FROM pedido_lineas WHERE pedido_id = NEW.pedido_id
  ) WHERE id = NEW.pedido_id;
END;

CREATE VIEW v_ventas_por_cliente AS
SELECT c.id, c.nombre, c.ciudad, COUNT(p.id) AS pedidos, COALESCE(SUM(p.total), 0) AS total_gastado
FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id
GROUP BY c.id, c.nombre, c.ciudad;

INSERT INTO clientes (id, nombre, email, ciudad, creado_en) VALUES
  (1, 'Ana López', 'ana@example.com', 'Madrid', '2026-01-10 09:15:00'),
  (2, 'Bruno Díaz', 'bruno@example.com', 'Ciudad de México', '2026-02-03 18:40:00'),
  (3, 'Carla Ruiz', 'carla@example.com', 'Bogotá', '2026-02-21 11:05:00'),
  (4, 'Diego Peña', 'diego@example.com', 'Buenos Aires', '2026-03-14 16:20:00'),
  (5, 'Elena Soto', 'elena@example.com', NULL, '2026-04-01 08:00:00');

INSERT INTO productos (id, nombre, categoria, precio, stock) VALUES
  (1, 'Teclado mecánico', 'Periféricos', 89.90, 25),
  (2, 'Ratón inalámbrico', 'Periféricos', 29.50, 60),
  (3, 'Monitor 27"', 'Pantallas', 249.00, 8),
  (4, 'Cable USB-C', 'Accesorios', 9.99, 200),
  (5, 'Base para portátil', 'Accesorios', 39.00, 0);

INSERT INTO pedidos (id, cliente_id, fecha, estado) VALUES
  (1, 1, '2026-04-02', 'entregado'),
  (2, 2, '2026-04-05', 'enviado'),
  (3, 1, '2026-04-11', 'pendiente'),
  (4, 3, '2026-04-12', 'cancelado');

INSERT INTO pedido_lineas (pedido_id, producto_id, cantidad, precio_unitario) VALUES
  (1, 1, 1, 89.90), (1, 4, 2, 9.99),
  (2, 3, 1, 249.00),
  (3, 2, 2, 29.50), (3, 4, 1, 9.99),
  (4, 5, 1, 39.00);
"#;

fn demo_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PyroStudio")
        .join("demo")
        .join(DEMO_FILE)
}

/// Returns the demo database path, creating it first if it does not exist.
/// An existing file (maybe edited by the user) is reused, never overwritten.
pub async fn ensure_demo_database() -> Result<PathBuf, PyroError> {
    let path = demo_path();
    if path.exists() {
        return Ok(path);
    }
    let dir = path.parent().expect("demo path has a parent");
    std::fs::create_dir_all(dir)
        .map_err(|e| PyroError::Database(format!("No se pudo crear la carpeta de la demo: {e}")))?;
    // Built aside and renamed, so a failure never leaves a half-filled demo.
    let partial = path.with_extension("sqlite3.partial");
    let _ = std::fs::remove_file(&partial);
    let build = async {
        let options = SqliteConnectOptions::new()
            .filename(&partial)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        let result = sqlx::raw_sql(SCHEMA_AND_DATA).execute(&pool).await;
        pool.close().await;
        result.map(|_| ())
    };
    if let Err(error) = build.await {
        let _ = std::fs::remove_file(&partial);
        return Err(PyroError::Database(format!(
            "Error creando la base de demostración: {error}"
        )));
    }
    std::fs::rename(&partial, &path).map_err(|e| {
        PyroError::Database(format!("No se pudo guardar la base de demostración: {e}"))
    })?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Connection, SqliteConnection};

    #[tokio::test]
    async fn demo_script_builds_a_consistent_database() {
        let mut conn = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(SCHEMA_AND_DATA)
            .execute(&mut conn)
            .await
            .unwrap();
        let (total,): (f64,) = sqlx::query_as("SELECT total FROM pedidos WHERE id = 1")
            .fetch_one(&mut conn)
            .await
            .unwrap();
        assert!(
            (total - 109.88).abs() < 1e-9,
            "trigger keeps totals: {total}"
        );
        let (rows,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM v_ventas_por_cliente")
            .fetch_one(&mut conn)
            .await
            .unwrap();
        assert_eq!(rows, 5);
    }
}
