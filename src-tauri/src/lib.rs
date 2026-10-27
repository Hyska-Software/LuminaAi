//! Lumina — desktop AI chat harness.
//!
//! Layer map:
//! - `catalog`:   bundled model catalog (protocols + reasoning capabilities)
//! - `providers`: wire protocols (OpenAI chat/responses, Anthropic, Google)
//! - `harness`:   agent loop (system prompt, tools, streaming, persistence)
//! - `tools`:     web search, page fetch, file creation, code execution and skills
//! - `documents`: attachment text extraction (pdf, docx, xlsx, pptx, text, images)
//!                and artifact previews (docx→html, xlsx, pptx)
//! - `db`:        SQLite persistence
//! - `commands`:  Tauri command surface used by the React app

mod catalog;
mod commands;
mod config;
mod db;
mod documents;
mod domain;
mod events;
mod harness;
mod http;
mod oauth;
mod providers;
mod state;
mod tools;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second instance focuses the existing
        // window instead of racing the rotating OAuth refresh token and the
        // secrets file.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            crate::state::ensure_dirs(app.handle()).expect("failed to create app dirs");
            let state = crate::state::AppState::init(app.handle())
                .expect("failed to initialize Lumina state");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::turn::run_turn,
            commands::turn::cancel_turn,
            commands::models::get_catalog,
            commands::models::refresh_catalog,
            commands::models::list_remote_models,
            commands::oauth::refresh_provider_models,
            commands::oauth::openai_login_start,
            commands::oauth::openai_login_wait,
            commands::oauth::openai_login_cancel,
            commands::oauth::openai_sign_out,
            commands::oauth::openai_auth_status,
            commands::conversations::list_conversations,
            commands::conversations::create_conversation,
            commands::conversations::get_conversation,
            commands::conversations::rename_conversation,
            commands::conversations::delete_conversation,
            commands::conversations::set_conversation_pinned,
            commands::conversations::search_conversations,
            commands::conversations::truncate_conversation,
            commands::conversations::export_conversation,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::set_provider_key,
            commands::settings::app_info,
            commands::settings::open_data_dir,
            commands::settings::reset_app_data,
            commands::settings::validate_provider,
            commands::settings::get_code_environment,
            commands::settings::open_skills_dir,
            commands::skills::get_skills,
            commands::skills::set_skill_enabled,
            commands::skills::delete_skill,
            commands::skills::get_skill_content,
            commands::attachments::import_attachments,
            commands::attachments::get_attachment,
            commands::attachments::delete_attachment,
            commands::artifacts::list_artifacts,
            commands::artifacts::list_library_artifacts,
            commands::artifacts::import_library_files,
            commands::artifacts::rename_artifact,
            commands::artifacts::set_artifact_favorite,
            commands::artifacts::get_artifact_thumbnail,
            commands::artifacts::get_artifact_content,
            commands::artifacts::get_artifact_preview,
            commands::artifacts::save_artifact,
            commands::artifacts::open_artifact,
            commands::artifacts::delete_artifact,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumina");
}
