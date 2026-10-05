use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{CellUpdateRequest, DeleteRowRequest};

/// Updates a single cell safely, enforcing primary key constraints.
pub async fn update_cell(
    backend: &dyn DatabaseBackend,
    req: CellUpdateRequest,
) -> Result<(), PyroError> {
    backend.update_cell(&req).await
}

/// Deletes a row safely using primary key conditions.
pub async fn delete_row(
    backend: &dyn DatabaseBackend,
    req: DeleteRowRequest,
) -> Result<(), PyroError> {
    backend.delete_row(&req).await
}
