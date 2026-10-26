//! Configurable workspaces: a user-chosen folder (local or synced, e.g. Google Drive
//! for desktop) holding shareable, non-secret resources — connection definitions and
//! saved SQL queries. Secrets stay in the local vault (`db::credentials`).
//! Format documentation: `docs/WORKSPACES.md`.

pub mod commands;
pub mod error;
pub mod groups;
pub mod migration;
pub mod models;
pub mod query_files;
pub mod repository;
pub mod service;

#[cfg(test)]
mod tests;

pub use commands::*;
