//! MariaDB/MySQL engine: the only place that knows SQLx `MySql*` types.

pub mod backend;
pub mod connect;
pub mod export;
pub mod introspector;
pub mod row;

pub use backend::DirectBackend;
