//! SQLite engine: local database files through SQLx (bundled SQLite).

pub mod alter;
pub mod backend;
pub mod connect;
pub mod introspector;
pub mod row;

pub use backend::SqliteBackend;

#[cfg(test)]
pub mod tests;
