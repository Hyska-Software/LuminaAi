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
mod jobs;
mod mcp;
mod oauth;
mod policy;
mod providers;
mod state;
mod terminal;
mod tools;
mod workspace;

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
            commands::conversations::list_subagent_conversations,
            commands::conversations::create_conversation,
            commands::conversations::get_conversation,
            commands::cache::get_cache_stats,
            commands::conversations::rename_conversation,
            commands::conversations::delete_conversation,
            commands::conversations::set_conversation_pinned,
            commands::conversations::set_conversation_code_linked,
            commands::conversations::set_conversation_model,
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
            /* -------- harness de código: workspace -------- */
            commands::workspace::pick_workspace_folder,
            commands::workspace::add_workspace,
            commands::workspace::list_workspaces,
            commands::workspace::get_workspace_context,
            commands::workspace::rename_workspace,
            commands::workspace::remove_workspace,
            commands::workspace::set_workspace_trusted,
            commands::workspace::set_conversation_workspace,
            commands::workspace::open_workspace_in_explorer,
            commands::workspace::list_workspace_files,
            commands::workspace::search_workspace_files,
            commands::workspace::read_workspace_file,
            /* -------- harness de código: sessão -------- */
            commands::code::get_code_session_state,
            commands::code::set_permission_mode,
            commands::code::set_plan_mode,
            commands::code::respond_approval,
            commands::code::respond_question,
            commands::code::mcp_status,
            commands::code::list_approval_rules,
            commands::code::save_approval_rule,
            commands::code::delete_approval_rule,
            commands::code::get_workspace_changes,
            commands::code::get_file_diff,
            commands::code::revert_file,
            commands::code::revert_turn,
            commands::code::compact_session,
            /* -------- harness de código: objetivo (Goal) -------- */
            commands::code::create_goal,
            commands::code::update_goal,
            commands::code::list_goal_rounds,
            commands::code::goal_can_continue,
            /* -------- harness de código: jobs em background -------- */
            commands::code::list_jobs,
            commands::code::get_job_output,
            commands::code::kill_job,
            /* -------- harness de código: git -------- */
            commands::git::git_status,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::git_diff,
            commands::git::git_stage,
            commands::git::git_stage_all,
            commands::git::git_unstage,
            commands::git::git_unstage_all,
            commands::git::git_discard,
            commands::git::git_commit,
            commands::git::git_branches,
            commands::git::git_switch_branch,
            commands::git::git_log,
            commands::git::git_commit_detail,
            commands::git::suggest_commit_message,
            /* -------- terminal PTY -------- */
            commands::terminal::open_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::terminal::list_terminals,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumina");
}
