//! Tauri command surface. Commands are grouped by concern; each file in this
//! module is owned by one subsystem.

pub mod artifacts;
pub mod attachments;
pub mod cache;
pub mod code;
pub mod conversations;
pub mod git;
pub mod models;
pub mod oauth;
pub mod settings;
pub mod skills;
pub mod terminal;
pub mod turn;
pub mod update;
pub mod workspace;
