
## Visor de tablas: carga rápida en tablas grandes (2026-11-06)
- Implementado: `fetch_table_chunk` ya no ejecuta `COUNT(*)` antes de los datos. Sin filtro devuelve la estimación de `information_schema.TABLES.TABLE_ROWS` (MariaDB/MySQL, `total_rows_estimated`), y la clave primaria, las columnas y la estimación se consultan en paralelo.
- Implementado: nuevo comando `count_table_rows`. `DataGridCanvas` lo lanza en segundo plano si la estimación es < 1 M o hay filtro; si es mayor, muestra «≈N» con el botón «contar exacto».
- Implementado: en modo paginado, el conteo y la página se consultan en paralelo.
- Pendiente de validar: medición real por túnel HTTP con la tabla `modulopa.mpa_calificaciones`.
