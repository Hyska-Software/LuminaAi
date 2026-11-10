//! Desktop notifications for background turns/tasks.
//!
//! The renderer decides *when* to notify (focus, active thread, settings); this
//! command only bridges to the OS notification plugin.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub fn notify_desktop(app: AppHandle, title: String, body: String) -> Result<bool, String> {
    let title = title.trim();
    let body = body.trim();
    if title.is_empty() {
        return Err(crate::i18n::t("notifications.errors.emptyTitle"));
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("NOTIFICATION_FAILED: {error}"))?;
    Ok(true)
}
