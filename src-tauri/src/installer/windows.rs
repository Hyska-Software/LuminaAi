//! Windows install engine. Everything here is user-data sensitive: every
//! destructive action is scoped to paths the installer created, and app data is
//! only removed after an explicit opt-in.

use std::fs;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread::sleep;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use chrono::Local;
use tauri::ipc::Channel;
use winreg::enums::*;
use winreg::RegKey;

use super::{
    ExistingInstall, InstallOptions, InstallScope, InstallStep, InstallerEvent, InstallerState,
};

const APP_EXE: &str = "Zylara.exe";
/// Dedicated uninstaller copied next to the app. It is the same binary: the
/// file name alone puts it in uninstall mode, so no second build is needed.
const UNINSTALLER_EXE: &str = "Uninstall Zylara.exe";
/// Setup used to point the shortcut and the registry at `Zylara.exe
/// --uninstall`; older shortcuts are removed on the next install/update.
const LEGACY_UNINSTALL_SHORTCUT: &str = "Desinstalar Zylara.lnk";
const APP_ID: &str = "app.zylara.chat";
const INSTALL_MARKER: &str = ".zylara-install";
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Zylara";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const WEBVIEW2_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

/* ------------------------------------------------------------------ */
/* Paths and environment                                               */
/* ------------------------------------------------------------------ */

pub fn default_install_path(scope: InstallScope) -> String {
    let path = match scope {
        InstallScope::User => std::env::var("LOCALAPPDATA")
            .map(|base| PathBuf::from(base).join("Programs").join("Zylara"))
            .unwrap_or_else(|_| PathBuf::from(r"C:\Users\Public\Zylara")),
        InstallScope::Machine => std::env::var("ProgramFiles")
            .map(|base| PathBuf::from(base).join("Zylara"))
            .unwrap_or_else(|_| PathBuf::from(r"C:\Program Files\Zylara")),
    };
    path.to_string_lossy().to_string()
}

fn appdata_dir() -> Option<PathBuf> {
    std::env::var("APPDATA").ok().map(PathBuf::from)
}

fn localappdata_dir() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA").ok().map(PathBuf::from)
}

pub fn data_paths() -> Vec<String> {
    let mut paths = Vec::new();
    if let Some(base) = appdata_dir() {
        paths.push(base.join(APP_ID).to_string_lossy().to_string());
    }
    if let Some(base) = localappdata_dir() {
        paths.push(base.join(APP_ID).to_string_lossy().to_string());
    }
    paths
}

/// The setup window is a WebView2 app too. Keep its profile outside the app's
/// local data so an uninstall with "remove my data" can delete the app profile
/// while the uninstaller UI is still running.
pub fn setup_webview_data_dir() -> PathBuf {
    std::env::temp_dir()
        .join("ZylaraSetup")
        .join(format!("WebView2-{}", std::process::id()))
}

fn desktop_dir(scope: InstallScope) -> Option<PathBuf> {
    match scope {
        InstallScope::User => std::env::var("USERPROFILE")
            .ok()
            .map(PathBuf::from)
            .map(|home| home.join("Desktop")),
        InstallScope::Machine => std::env::var("PUBLIC")
            .ok()
            .map(PathBuf::from)
            .map(|public| public.join("Desktop")),
    }
}

fn start_menu_dir(scope: InstallScope) -> Option<PathBuf> {
    match scope {
        InstallScope::User => appdata_dir().map(|base| {
            base.join(r"Microsoft\Windows\Start Menu\Programs")
                .join("Zylara")
        }),
        InstallScope::Machine => std::env::var("ProgramData").ok().map(|base| {
            PathBuf::from(base)
                .join(r"Microsoft\Windows\Start Menu\Programs")
                .join("Zylara")
        }),
    }
}

pub fn payload_size() -> u64 {
    std::env::current_exe()
        .ok()
        .and_then(|path| fs::metadata(path).ok())
        .map(|meta| meta.len())
        .unwrap_or(25 * 1024 * 1024)
}

/// Bytes an installation occupies: the app payload plus the uninstaller copy.
pub fn installed_size(payload: u64) -> u64 {
    payload.saturating_mul(2)
}

pub fn free_bytes(path: &Path) -> Option<u64> {
    let root = if path.is_absolute() {
        path.components().next().map(|component| {
            let mut root = PathBuf::from(component.as_os_str());
            root.push(std::path::MAIN_SEPARATOR.to_string());
            root
        })?
    } else {
        std::env::current_dir().ok()?
    };
    let root = root.to_string_lossy().to_string();
    let wide = to_wide(&root);
    let mut free = 0u64;
    let ok = unsafe {
        windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            windows::core::PCWSTR(wide.as_ptr()),
            Some(&mut free),
            None,
            None,
        )
    };
    ok.is_ok().then_some(free)
}

pub fn is_admin() -> bool {
    unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().as_bool() }
}

pub fn is_current_exe_in(path: &str) -> bool {
    let Ok(current) = std::env::current_exe() else {
        return false;
    };
    same_path(
        current.parent().unwrap_or(Path::new("")),
        Path::new(path),
    )
}

fn same_path(a: &Path, b: &Path) -> bool {
    let normalize = |path: &Path| {
        path.to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_ascii_lowercase()
    };
    normalize(a) == normalize(b)
}

pub fn new_log_path() -> PathBuf {
    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    std::env::temp_dir().join(format!("Zylara-Setup-{stamp}.log"))
}

pub fn write_log(state: &InstallerState, message: &str) {
    let path = state.log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "[{}] {message}", Local::now().format("%H:%M:%S"));
    }
}

fn log_event(state: &InstallerState, emit: &dyn Fn(InstallerEvent), message: impl Into<String>) {
    let message = message.into();
    write_log(state, &message);
    emit(InstallerEvent::Log {
        line: format!("{} {message}", Local::now().format("%H:%M:%S")),
    });
}

fn step(
    emit: &dyn Fn(InstallerEvent),
    id: &str,
    label: &str,
    status: &str,
    detail: Option<String>,
) {
    let _ = emit(InstallerEvent::Step {
        step: InstallStep {
            id: id.to_string(),
            label: label.to_string(),
            status: status.to_string(),
            detail,
        },
    });
}

fn progress(emit: &dyn Fn(InstallerEvent), percent: f32, message: impl Into<String>) {
    let _ = emit(InstallerEvent::Progress {
        percent,
        message: message.into(),
    });
}

fn cancelled(state: &InstallerState) -> bool {
    state.cancel_requested()
}

fn check_cancel(state: &InstallerState) -> Result<()> {
    if cancelled(state) {
        bail!(crate::i18n::t("installer.errors.cancelled"));
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

fn uninstall_root(scope: InstallScope) -> RegKey {
    match scope {
        InstallScope::User => RegKey::predef(HKEY_CURRENT_USER),
        InstallScope::Machine => RegKey::predef(HKEY_LOCAL_MACHINE),
    }
}

pub fn find_install_scope(scope: InstallScope) -> Option<ExistingInstall> {
    let key = uninstall_root(scope)
        .open_subkey_with_flags(UNINSTALL_KEY, KEY_READ | KEY_WOW64_64KEY)
        .ok()?;
    let raw_path: String = key.get_value("InstallLocation").ok()?;
    let path = raw_path.trim_matches('"').to_string();
    if path.is_empty() {
        return None;
    }
    let version: String = key
        .get_value("DisplayVersion")
        .unwrap_or_else(|_| "0.0.0".to_string());
    Some(ExistingInstall {
        scope,
        path,
        version,
    })
}

pub fn find_install() -> Option<ExistingInstall> {
    find_install_scope(InstallScope::Machine).or_else(|| find_install_scope(InstallScope::User))
}

fn register_uninstall(scope: InstallScope, install_path: &Path) -> Result<()> {
    let root = uninstall_root(scope);
    let (key, _) = root
        .create_subkey_with_flags(UNINSTALL_KEY, KEY_WRITE | KEY_WOW64_64KEY)
        .with_context(|| {
            format!(
                "falha ao escrever no registro do Windows ({}). Execute como administrador.",
                scope.label()
            )
        })?;
    let target = install_path.join(APP_EXE);
    let location = format!("\"{}\"", install_path.display());
    let quoted = format!("\"{}\"", target.display());
    let (uninstall_string, quiet_uninstall_string) = uninstall_strings(install_path);
    key.set_value("DisplayName", &"Zylara".to_string())?;
    key.set_value("DisplayVersion", &env!("CARGO_PKG_VERSION").to_string())?;
    key.set_value("Publisher", &"Zylara".to_string())?;
    key.set_value("InstallLocation", &location)?;
    key.set_value("DisplayIcon", &format!("{},0", quoted))?;
    key.set_value("UninstallString", &uninstall_string)?;
    key.set_value("QuietUninstallString", &quiet_uninstall_string)?;
    key.set_value("NoModify", &1u32)?;
    key.set_value("NoRepair", &1u32)?;
    let size_kb = installed_size(payload_size())
        .div_ceil(1024)
        .min(u32::MAX as u64) as u32;
    key.set_value("EstimatedSize", &size_kb)?;
    Ok(())
}

/// Apps & features runs the dedicated uninstaller shipped inside the install
/// folder. Older builds pointed at `Zylara.exe --uninstall`, which still works.
fn uninstall_strings(install_path: &Path) -> (String, String) {
    let exe = install_path.join(UNINSTALLER_EXE);
    let quoted = format!("\"{}\"", exe.display());
    (quoted.clone(), format!("{quoted} --silent"))
}

fn unregister(scope: InstallScope) -> Result<()> {
    let root = uninstall_root(scope);
    match root.delete_subkey_all(UNINSTALL_KEY) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("falha ao remover a entrada de desinstalação"),
    }
}

/* ------------------------------------------------------------------ */
/* Shortcuts                                                           */
/* ------------------------------------------------------------------ */

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn create_shortcut(
    path: &Path,
    target: &Path,
    working_dir: &Path,
    description: &str,
    arguments: Option<&str>,
) -> Result<()> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let target_w = to_wide(&target.to_string_lossy());
    let work_w = to_wide(&working_dir.to_string_lossy());
    let description_w = to_wide(description);
    let path_w = to_wide(&path.to_string_lossy());
    let icon_w = to_wide(&target.to_string_lossy());
    let arguments_w = arguments.map(to_wide);

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .context("falha ao criar o atalho do Windows")?;
        link.SetPath(PCWSTR(target_w.as_ptr()))?;
        link.SetWorkingDirectory(PCWSTR(work_w.as_ptr()))?;
        link.SetDescription(PCWSTR(description_w.as_ptr()))?;
        link.SetIconLocation(PCWSTR(icon_w.as_ptr()), 0)?;
        if let Some(arguments) = arguments_w.as_ref() {
            link.SetArguments(PCWSTR(arguments.as_ptr()))?;
        }
        let persist: IPersistFile = link.cast()?;
        persist.Save(PCWSTR(path_w.as_ptr()), true)?;
    }
    Ok(())
}

fn remove_shortcuts(scope: InstallScope) {
    if let Some(programs) = start_menu_dir(scope) {
        let _ = fs::remove_file(programs.join("Zylara.lnk"));
        let _ = fs::remove_file(programs.join("Uninstall Zylara.lnk"));
        let _ = fs::remove_file(programs.join(LEGACY_UNINSTALL_SHORTCUT));
        let _ = fs::remove_dir(&programs);
    }
    if let Some(desktop) = desktop_dir(scope) {
        let shortcut = desktop.join("Zylara.lnk");
        // Only remove a shortcut that points at the executable we installed.
        if shortcut_target(&shortcut)
            .map(|target| target.to_ascii_lowercase().ends_with("zylara.exe"))
            .unwrap_or(false)
        {
            let _ = fs::remove_file(shortcut);
        }
    }
}

fn shortcut_target(path: &Path) -> Option<String> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    if !path.exists() {
        return None;
    }
    let path_w = to_wide(&path.to_string_lossy());
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: IPersistFile = link.cast().ok()?;
        persist.Load(PCWSTR(path_w.as_ptr()), STGM_READ).ok()?;
        let mut buffer = [0u16; 1024];
        link.GetPath(&mut buffer, std::ptr::null_mut(), 0).ok()?;
        let end = buffer.iter().position(|value| *value == 0).unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..end]))
    }
}

/* ------------------------------------------------------------------ */
/* Running app                                                         */
/* ------------------------------------------------------------------ */

fn running_pids() -> Vec<u32> {
    let Ok(output) = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq Zylara.exe", "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let current = std::process::id();
    let mut pids = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('"') {
            continue;
        }
        let mut fields = line.split("\",\"");
        let Some(image) = fields.next() else {
            continue;
        };
        if !image.trim_start_matches('"').eq_ignore_ascii_case("zylara.exe") {
            continue;
        }
        let Some(pid) = fields
            .next()
            .and_then(|value| value.trim_end_matches('"').parse::<u32>().ok())
        else {
            continue;
        };
        if pid != current {
            pids.push(pid);
        }
    }
    pids
}

pub fn app_running() -> bool {
    !running_pids().is_empty()
}

pub fn close_running_app() -> Result<()> {
    let pids = running_pids();
    if pids.is_empty() {
        return Ok(());
    }
    for pid in &pids {
        // `/PID` without `/F` asks the window to close; never kill the current
        // setup/uninstall process by image name.
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        if !app_running() {
            return Ok(());
        }
        sleep(Duration::from_millis(250));
    }
    bail!("O Zylara não fechou. Feche o aplicativo manualmente e tente novamente.")
}

/* ------------------------------------------------------------------ */
/* WebView2                                                            */
/* ------------------------------------------------------------------ */

pub fn webview2_version() -> Option<String> {
    let read = |root: RegKey, prefix: &str| -> Option<String> {
        let path = format!("{prefix}\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2_GUID}");
        let key = root
            .open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY)
            .or_else(|_| {
                root.open_subkey_with_flags(
                    format!("{prefix}\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2_GUID}"),
                    KEY_READ,
                )
            })
            .ok()?;
        key.get_value::<String, _>("pv").ok()
    };

    read(RegKey::predef(HKEY_LOCAL_MACHINE), "SOFTWARE\\WOW6432Node")
        .or_else(|| read(RegKey::predef(HKEY_CURRENT_USER), "SOFTWARE"))
}

pub fn ensure_webview2(interactive: bool) -> Result<()> {
    if webview2_version().is_some() {
        return Ok(());
    }

    if interactive {
        native_message(
            "Zylara Setup",
            "O Zylara usa o Microsoft Edge WebView2. O instalador vai baixar e instalar esse componente agora.",
            false,
        );
    }

    let url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    let path = std::env::temp_dir().join("MicrosoftEdgeWebView2Setup.exe");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .context("falha ao preparar o download do WebView2")?;
    let bytes = client
        .get(url)
        .send()
        .context("falha ao baixar o WebView2")?
        .error_for_status()
        .context("o servidor do WebView2 retornou um erro")?
        .bytes()
        .context("falha ao ler o WebView2")?;
    fs::write(&path, &bytes).context("falha ao salvar o WebView2")?;

    let status = Command::new(&path)
        .args(["/silent", "/install"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .context("falha ao executar o instalador do WebView2")?;
    let _ = fs::remove_file(&path);
    if !status.success() {
        bail!("A instalação do WebView2 falhou (código {:?}).", status.code());
    }
    if webview2_version().is_none() {
        bail!("WebView2 não foi detectado depois da instalação. Instale-o manualmente e tente novamente.");
    }
    Ok(())
}

fn native_message(title: &str, message: &str, error: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONERROR, MB_ICONINFORMATION, MB_OK,
    };
    let title = to_wide(title);
    let message = to_wide(message);
    let icon = if error { MB_ICONERROR } else { MB_ICONINFORMATION };
    unsafe {
        MessageBoxW(
            None,
            windows::core::PCWSTR(message.as_ptr()),
            windows::core::PCWSTR(title.as_ptr()),
            MB_OK | icon,
        );
    }
}

pub fn fatal_message(title: &str, message: &str) {
    native_message(title, message, true);
}

/* ------------------------------------------------------------------ */
/* Elevation and relaunch                                              */
/* ------------------------------------------------------------------ */

fn quote_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn shell_execute(exe: &Path, args: &str, verb: &str) -> Result<()> {
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let exe_w = to_wide(&exe.to_string_lossy());
    let args_w = to_wide(args);
    let verb_w = to_wide(verb);
    let result = unsafe {
        windows::Win32::UI::Shell::ShellExecuteW(
            None,
            windows::core::PCWSTR(verb_w.as_ptr()),
            windows::core::PCWSTR(exe_w.as_ptr()),
            windows::core::PCWSTR(args_w.as_ptr()),
            None,
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        bail!("O Windows recusou a execução (código {}).", result.0 as isize);
    }
    Ok(())
}

pub fn relaunch_elevated(options: &InstallOptions) -> Result<()> {
    let exe = std::env::current_exe().context("não foi possível localizar o instalador")?;
    let mut args = format!(
        "--setup --elevated --scope {} --dir {}",
        options.scope.label(),
        quote_arg(&options.path)
    );
    args.push_str(if options.desktop_shortcut {
        " --desktop"
    } else {
        " --no-desktop"
    });
    args.push_str(if options.start_menu_shortcut {
        " --start-menu"
    } else {
        " --no-start-menu"
    });
    args.push_str(if options.launch_after_install {
        " --launch"
    } else {
        " --no-launch"
    });
    shell_execute(&exe, &args, "runas")
}

pub fn relaunch_self_elevated() -> Result<()> {
    let exe = std::env::current_exe().context("não foi possível localizar o instalador")?;
    let mut args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| arg != "--elevated")
        .collect();
    args.push("--elevated".to_string());
    let command_line = args
        .iter()
        .map(|arg| quote_arg(arg))
        .collect::<Vec<_>>()
        .join(" ");
    shell_execute(&exe, &command_line, "runas")
}

pub fn schedule_self_delete(state: &InstallerState) {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let temp = std::env::temp_dir();
    // Remove stale cleanup scripts from previous uninstalls. They are tiny,
    // but there is no reason to keep one around forever.
    if let Ok(entries) = fs::read_dir(&temp) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("Zylara-cleanup-") && name.ends_with(".cmd") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    let cleanup = temp.join(format!(
        "Zylara-cleanup-{}.cmd",
        Local::now().format("%Y%m%d-%H%M%S")
    ));
    // A small .cmd file avoids cmd.exe quote parsing surprises when the temp
    // path contains spaces. It waits for this process to exit, deletes the
    // temporary uninstaller and then removes itself.
    let script = format!(
        "@echo off\r\nping 127.0.0.1 -n 3 >nul\r\ndel /f /q \"{}\"\r\n",
        exe.display()
    );
    write_log(
        state,
        &format!(
            "agendando remoção do desinstalador temporário: {}",
            exe.display()
        ),
    );
    if let Err(error) = fs::write(&cleanup, script) {
        write_log(state, &format!("falha ao criar o script de limpeza: {error}"));
        return;
    }
    let cleanup_arg = cleanup.to_string_lossy().to_string();
    let child = Command::new("cmd.exe")
        .args(["/d", "/s", "/c", &cleanup_arg])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    if let Err(error) = child {
        write_log(state, &format!("falha ao agendar remoção: {error}"));
    }
}

pub fn relaunch_from_temp_uninstall() -> Result<()> {
    let exe = std::env::current_exe().context("não foi possível localizar o instalador")?;
    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    let temp = std::env::temp_dir().join(format!("Zylara-uninstall-{stamp}.exe"));
    fs::copy(&exe, &temp).context("falha ao preparar o desinstalador temporário")?;

    let original: Vec<String> = std::env::args().skip(1).collect();
    let mut args: Vec<String> = original
        .into_iter()
        .filter(|arg| arg != "--from-temp")
        .collect();
    if !args.iter().any(|arg| arg == "--uninstall") {
        args.push("--uninstall".to_string());
    }
    args.push("--from-temp".to_string());
    let command_line = args
        .iter()
        .map(|arg| quote_arg(arg))
        .collect::<Vec<_>>()
        .join(" ");
    Command::new(&temp)
        .raw_arg(command_line)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .context("falha ao iniciar o desinstalador temporário")?;
    Ok(())
}

pub fn launch_installed(install_path: &str) -> Result<()> {
    let exe = Path::new(install_path).join(APP_EXE);
    Command::new(&exe)
        .current_dir(install_path)
        .spawn()
        .with_context(|| format!("falha ao abrir {}", exe.display()))?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Install                                                             */
/* ------------------------------------------------------------------ */

fn validate_options(options: &InstallOptions, existing: Option<&ExistingInstall>) -> Result<()> {
    let path = options.path.trim();
    if path.is_empty() {
        bail!(crate::i18n::t("installer.errors.choosePath"));
    }
    let path_ref = Path::new(path);
    if !path_ref.is_absolute() {
        bail!(crate::i18n::t("installer.errors.pathNotAbsolute"));
    }
    if path_ref
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        bail!(crate::i18n::t("installer.errors.pathParent"));
    }
    if path_ref.parent().is_none() {
        bail!(crate::i18n::t("installer.errors.pathRoot"));
    }
    let lower = path.to_ascii_lowercase();
    if lower.starts_with(r"\\") {
        bail!(crate::i18n::t("installer.errors.networkPath"));
    }
    if let Some(windows_dir) = std::env::var("WINDIR").ok() {
        if lower.starts_with(&windows_dir.to_ascii_lowercase()) {
            bail!(crate::i18n::t("installer.errors.windowsDir"));
        }
    }
    if let Some(existing) = existing {
        if !same_path(Path::new(&existing.path), path_ref) {
            bail!(crate::i18n::t_args(
                "installer.errors.alreadyInstalledPath",
                &[("path", &existing.path)],
            ));
        }
    } else if path_ref.exists() {
        let has_entries = fs::read_dir(path_ref)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false);
        if has_entries {
            bail!(crate::i18n::t("installer.errors.folderNotEmpty"));
        }
    }
    Ok(())
}

fn copy_payload(install_path: &Path) -> Result<()> {
    let current = std::env::current_exe().context(crate::i18n::t("installer.errors.executableNotFound"))?;
    let target = install_path.join(APP_EXE);
    if !same_path(&current, &target) {
        fs::create_dir_all(install_path).with_context(|| {
            crate::i18n::t_args(
                "installer.errors.createFolder",
                &[("path", &install_path.display().to_string())],
            )
        })?;
        copy_file_atomic(&current, &target)?;
    }
    // The uninstaller is the same binary under its own name: the file name alone
    // selects uninstall mode, so the installation ships a self-contained
    // `Uninstall Zylara.exe` without a second build or a separate download.
    let uninstaller = install_path.join(UNINSTALLER_EXE);
    if !same_path(&current, &uninstaller) {
        copy_file_atomic(&current, &uninstaller)?;
    }
    Ok(())
}

/// Copies `source` over `target` through `<name>.new` + `ReplaceFileW`, so a
/// failure never leaves a half-written executable behind.
fn copy_file_atomic(source: &Path, target: &Path) -> Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).with_context(|| {
            crate::i18n::t_args(
                "installer.errors.createFolder",
                &[("path", &parent.display().to_string())],
            )
        })?;
    }
    let name = target
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let temporary = target.with_file_name(format!("{name}.new"));
    fs::copy(source, &temporary).with_context(|| {
        crate::i18n::t_args(
            "installer.errors.copyApp",
            &[("path", &temporary.display().to_string())],
        )
    })?;

    if target.exists() {
        let replaced = unsafe {
            windows::Win32::Storage::FileSystem::ReplaceFileW(
                windows::core::PCWSTR(to_wide(&target.to_string_lossy()).as_ptr()),
                windows::core::PCWSTR(to_wide(&temporary.to_string_lossy()).as_ptr()),
                None,
                windows::Win32::Storage::FileSystem::REPLACEFILE_IGNORE_MERGE_ERRORS,
                None,
                None,
            )
        };
        if replaced.is_err() {
            fs::remove_file(target).with_context(|| {
                crate::i18n::t_args(
                    "installer.errors.fileLocked",
                    &[("path", &target.display().to_string())],
                )
            })?;
            fs::rename(&temporary, target)?;
        }
    } else {
        fs::rename(&temporary, target).with_context(|| {
            crate::i18n::t_args(
                "installer.errors.finalizeFile",
                &[("path", &target.display().to_string())],
            )
        })?;
    }
    remove_zone_identifier(target);
    Ok(())
}

/// A setup downloaded from the browser carries Mark-of-the-Web. Copying the
/// executable would carry the `Zone.Identifier` ADS to the installed app and
/// make Windows treat it as a downloaded file. Installers strip it when they
/// extract their payload; we copy the file ourselves, so do the same.
fn remove_zone_identifier(path: &Path) {
    let stream = format!("{}:Zone.Identifier", path.display());
    let wide = to_wide(&stream);
    unsafe {
        let _ = windows::Win32::Storage::FileSystem::DeleteFileW(
            windows::core::PCWSTR(wide.as_ptr()),
        );
    }
}

fn write_install_marker(install_path: &Path) -> Result<()> {
    fs::write(
        install_path.join(INSTALL_MARKER),
        format!("{APP_ID}\n{}\n", env!("CARGO_PKG_VERSION")),
    )
    .with_context(|| format!("falha ao gravar o marcador em {}", install_path.display()))?;
    Ok(())
}

fn validate_install_marker(install_path: &Path) -> Result<()> {
    let marker = fs::read_to_string(install_path.join(INSTALL_MARKER)).unwrap_or_default();
    if marker.lines().any(|line| line.trim() == APP_ID) {
        return Ok(());
    }
    // Legacy builds installed by Tauri's NSIS bundle have `uninstall.exe` but
    // no marker. Accept that layout so an upgrade/uninstall can migrate it.
    if install_path.join(APP_EXE).exists() && install_path.join("uninstall.exe").exists() {
        return Ok(());
    }
    bail!(
        "A pasta {} não parece uma instalação do Zylara (marcador ausente).",
        install_path.display()
    )
}

fn install_inner(
    state: &InstallerState,
    options: &InstallOptions,
    allow_downgrade: bool,
    emit: &dyn Fn(InstallerEvent),
) -> Result<(String, bool)> {
    write_log(
        state,
        &format!(
            "instalação iniciada: versão={} escopo={} pasta={}",
            env!("CARGO_PKG_VERSION"),
            options.scope.label(),
            options.path
        ),
    );

    let existing = find_install_scope(options.scope);
    let conflicting = find_install_scope(match options.scope {
        InstallScope::User => InstallScope::Machine,
        InstallScope::Machine => InstallScope::User,
    });
    if conflicting.is_some() {
        bail!(crate::i18n::t("installer.errors.conflictingScope"));
    }

    step(emit, "prepare", &crate::i18n::t("installer.steps.validateDestination"), "running", None);
    progress(emit, 6.0, &crate::i18n::t("installer.progress.validatingDestination"));
    validate_options(options, existing.as_ref())?;
    if options.scope == InstallScope::Machine && !is_admin() {
        bail!(crate::i18n::t("installer.errors.adminRequiredInstall"));
    }
    if !allow_downgrade
        && existing
            .as_ref()
            .is_some_and(|install| compare_versions(&install.version, env!("CARGO_PKG_VERSION")) > 0)
    {
        bail!(crate::i18n::t_args(
            "installer.errors.newerVersion",
            &[
                ("version", existing.as_ref().map(|install| install.version.as_str()).unwrap_or("")),
                ("installer", env!("CARGO_PKG_VERSION")),
            ],
        ));
    }
    let install_path = PathBuf::from(options.path.trim());
    if install_path.exists() && !install_path.is_dir() {
        bail!(crate::i18n::t("installer.errors.pathIsFile"));
    }
    if let Some(free) = free_bytes(&install_path) {
        let required = installed_size(payload_size()).saturating_add(16 * 1024 * 1024);
        if free < required {
            bail!(crate::i18n::t_args(
                "installer.errors.insufficientSpace",
                &[("required", &human_bytes(required)), ("free", &human_bytes(free))],
            ));
        }
    }
    fs::create_dir_all(&install_path).with_context(|| {
        crate::i18n::t_args(
            "installer.errors.createPath",
            &[("path", &install_path.display().to_string())],
        )
    })?;
    let first_install = existing.is_none();
    let cancel_before_copy = |state: &InstallerState| -> Result<()> {
        if cancelled(state) {
            if first_install {
                let _ = fs::remove_dir_all(&install_path);
            }
            bail!(crate::i18n::t("installer.errors.cancelled"));
        }
        Ok(())
    };
    step(emit, "prepare", &crate::i18n::t("installer.steps.validateDestination"), "done", None);
    cancel_before_copy(state)?;

    step(emit, "closeApp", &crate::i18n::t("installer.steps.closeApp"), "running", None);
    progress(emit, 16.0, &crate::i18n::t("installer.progress.checkingRunningApp"));
    if app_running() {
        log_event(state, emit, "fechando o Zylara em execução");
        close_running_app()?;
    }
    step(emit, "closeApp", &crate::i18n::t("installer.steps.closeApp"), "done", None);
    cancel_before_copy(state)?;

    step(emit, "copy", &crate::i18n::t("installer.steps.copyFiles"), "running", None);
    progress(emit, 34.0, &crate::i18n::t("installer.progress.copyingApp"));
    copy_payload(&install_path)?;
    write_install_marker(&install_path)?;
    step(
        emit,
        "copy",
        &crate::i18n::t("installer.steps.copyFiles"),
        "done",
        Some(format!("{APP_EXE}, {UNINSTALLER_EXE}")),
    );

    step(emit, "shortcuts", &crate::i18n::t("installer.steps.createShortcuts"), "running", None);
    progress(emit, 62.0, &crate::i18n::t("installer.progress.creatingShortcuts"));
    if options.desktop_shortcut || options.start_menu_shortcut {
        let target = install_path.join(APP_EXE);
        let uninstaller = install_path.join(UNINSTALLER_EXE);
        if options.start_menu_shortcut {
            if let Some(programs) = start_menu_dir(options.scope) {
                create_shortcut(
                    &programs.join("Zylara.lnk"),
                    &target,
                    &install_path,
                    &crate::i18n::t("installer.shortcut.appDescription"),
                    None,
                )?;
                create_shortcut(
                    &programs.join("Uninstall Zylara.lnk"),
                    &uninstaller,
                    &install_path,
                    &crate::i18n::t("installer.shortcut.uninstallDescription"),
                    None,
                )?;
                // Upgrades replace the legacy `Desinstalar Zylara.lnk`, which
                // pointed at `Zylara.exe --uninstall`.
                let _ = fs::remove_file(programs.join(LEGACY_UNINSTALL_SHORTCUT));
            }
        }
        if options.desktop_shortcut {
            if let Some(desktop) = desktop_dir(options.scope) {
                create_shortcut(
                    &desktop.join("Zylara.lnk"),
                    &target,
                    &install_path,
                    &crate::i18n::t("installer.shortcut.appDescription"),
                    None,
                )?;
            }
        }
        step(
            emit,
            "shortcuts",
            &crate::i18n::t("installer.steps.createShortcuts"),
            "done",
            Some(crate::i18n::t("installer.steps.shortcutsCreated")),
        );
    } else {
        step(emit, "shortcuts", &crate::i18n::t("installer.steps.createShortcuts"), "skipped", None);
    }

    step(emit, "register", &crate::i18n::t("installer.steps.registerUninstall"), "running", None);
    progress(emit, 82.0, &crate::i18n::t("installer.progress.registeringWindows"));
    register_uninstall(options.scope, &install_path)?;
    step(emit, "register", &crate::i18n::t("installer.steps.registerUninstall"), "done", None);

    let mut launched = false;
    if options.launch_after_install {
        step(emit, "launch", &crate::i18n::t("installer.steps.launch"), "running", None);
        progress(emit, 94.0, &crate::i18n::t("installer.progress.launchingApp"));
        if let Err(error) = launch_installed(&install_path.to_string_lossy()) {
            log_event(state, emit, format!("aviso ao abrir o app: {error:#}"));
            step(
                emit,
                "launch",
                &crate::i18n::t("installer.steps.launch"),
                "error",
                Some(format!("{error:#}")),
            );
        } else {
            launched = true;
            step(emit, "launch", &crate::i18n::t("installer.steps.launch"), "done", None);
        }
    } else {
        step(emit, "launch", &crate::i18n::t("installer.steps.launch"), "skipped", None);
    }

    progress(emit, 100.0, &crate::i18n::t("installer.progress.done"));
    write_log(state, "instalação concluída");
    let path = install_path.to_string_lossy().to_string();
    emit(InstallerEvent::Done {
        install_path: path.clone(),
        launched,
        log_path: state.log_path().to_string_lossy().to_string(),
    });
    Ok((path, launched))
}

pub fn install(
    state: &InstallerState,
    options: &InstallOptions,
    channel: &Channel<InstallerEvent>,
) -> Result<()> {
    let emit = |event: InstallerEvent| {
        let _ = channel.send(event);
    };
    install_inner(state, options, false, &emit).map(|_| ())
}

pub fn silent_install(
    state: &InstallerState,
    options: Option<InstallOptions>,
    allow_downgrade: bool,
) -> Result<()> {
    let mut options = options.unwrap_or_else(|| InstallOptions {
        scope: InstallScope::User,
        path: default_install_path(InstallScope::User),
        desktop_shortcut: true,
        start_menu_shortcut: true,
        launch_after_install: false,
    });
    // Silent installs never launch the app unless the caller explicitly asks
    // with --launch. This keeps CI/VM smoke tests deterministic.
    if !std::env::args().any(|arg| arg == "--launch") {
        options.launch_after_install = false;
    }
    let emit = |_event: InstallerEvent| {};
    install_inner(state, &options, allow_downgrade, &emit).map(|_| ())
}

/* ------------------------------------------------------------------ */
/* Uninstall                                                           */
/* ------------------------------------------------------------------ */

fn remove_data(state: &InstallerState, emit: &dyn Fn(InstallerEvent)) -> Result<()> {
    step(emit, "removeData", &crate::i18n::t("installer.steps.removeData"), "running", None);
    progress(emit, 28.0, &crate::i18n::t("installer.progress.removingData"));
    for path in data_paths() {
        let path = PathBuf::from(path);
        if path.exists() {
            log_event(state, emit, format!("removendo {}", path.display()));
            fs::remove_dir_all(&path).with_context(|| {
                crate::i18n::t_args(
                    "installer.errors.removePath",
                    &[("path", &path.display().to_string())],
                )
            })?;
        }
    }
    step(emit, "removeData", &crate::i18n::t("installer.steps.removeData"), "done", None);
    Ok(())
}

fn uninstall_inner(
    state: &InstallerState,
    purge_data: bool,
    emit: &dyn Fn(InstallerEvent),
) -> Result<String> {
    let existing = find_install()
        .ok_or_else(|| anyhow!(crate::i18n::t("installer.errors.notInstalled")))?;
    write_log(
        state,
        &format!(
            "desinstalação iniciada: versão={} escopo={} pasta={}",
            existing.version,
            existing.scope.label(),
            existing.path
        ),
    );

    step(emit, "prepare", &crate::i18n::t("installer.steps.validateInstall"), "running", None);
    progress(emit, 6.0, &crate::i18n::t("installer.progress.validatingInstall"));
    let install_path = PathBuf::from(&existing.path);
    if !install_path.exists() {
        // Registry is stale; still remove the entry and shortcuts.
        log_event(state, emit, "a pasta de instalação não existe; limpando o registro");
    }
    if existing.scope == InstallScope::Machine && !is_admin() {
        bail!(crate::i18n::t("installer.errors.adminRequiredUninstall"));
    }
    if install_path.exists() {
        validate_install_marker(&install_path)?;
    }
    step(emit, "prepare", &crate::i18n::t("installer.steps.validateInstall"), "done", None);
    check_cancel(state)?;

    step(emit, "closeApp", &crate::i18n::t("installer.steps.closeApp"), "running", None);
    progress(emit, 16.0, &crate::i18n::t("installer.progress.closingApp"));
    if app_running() {
        close_running_app()?;
    }
    step(emit, "closeApp", &crate::i18n::t("installer.steps.closeApp"), "done", None);
    check_cancel(state)?;

    // Remove user data while the installation is still registered. If data
    // deletion fails (locked file, permission), the user can retry the same
    // uninstaller instead of being left with an orphaned profile.
    if purge_data {
        remove_data(state, emit)?;
    } else {
        step(
            emit,
            "removeData",
            &crate::i18n::t("installer.steps.removeData"),
            "skipped",
            Some(crate::i18n::t("installer.steps.dataPreserved")),
        );
    }

    step(emit, "removeFiles", &crate::i18n::t("installer.steps.removeFiles"), "running", None);
    progress(emit, 40.0, &crate::i18n::t("installer.progress.removingFiles"));
    if install_path.exists() {
        fs::remove_dir_all(&install_path).with_context(|| {
            crate::i18n::t_args(
                "installer.errors.removeInstallBusy",
                &[("path", &install_path.display().to_string())],
            )
        })?;
    }
    step(emit, "removeFiles", &crate::i18n::t("installer.steps.removeFiles"), "done", None);
    check_cancel(state)?;

    step(emit, "removeRegistry", &crate::i18n::t("installer.steps.removeRegistry"), "running", None);
    progress(emit, 62.0, &crate::i18n::t("installer.progress.removingRegistry"));
    remove_shortcuts(existing.scope);
    remove_shortcuts(match existing.scope {
        InstallScope::User => InstallScope::Machine,
        InstallScope::Machine => InstallScope::User,
    });
    unregister(existing.scope)?;
    step(emit, "removeRegistry", &crate::i18n::t("installer.steps.removeRegistry"), "done", None);
    check_cancel(state)?;

    step(emit, "cleanup", &crate::i18n::t("installer.steps.finish"), "running", None);
    progress(emit, 100.0, &crate::i18n::t("installer.progress.done"));
    step(emit, "cleanup", &crate::i18n::t("installer.steps.finish"), "done", None);
    write_log(state, "desinstalação concluída");
    emit(InstallerEvent::Done {
        install_path: existing.path.clone(),
        launched: false,
        log_path: state.log_path().to_string_lossy().to_string(),
    });
    Ok(existing.path)
}

pub fn uninstall(
    state: &InstallerState,
    purge_data: bool,
    channel: &Channel<InstallerEvent>,
) -> Result<()> {
    let emit = |event: InstallerEvent| {
        let _ = channel.send(event);
    };
    uninstall_inner(state, purge_data, &emit).map(|_| ())
}

pub fn silent_uninstall(state: &InstallerState, purge_data: bool) -> Result<()> {
    let emit = |_event: InstallerEvent| {};
    uninstall_inner(state, purge_data, &emit).map(|_| ())
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

fn compare_versions(left: &str, right: &str) -> i32 {
    let parts = |value: &str| -> Vec<u64> {
        value
            .split(|character: char| !character.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<u64>().ok())
            .collect()
    };
    let left = parts(left);
    let right = parts(right);
    for index in 0..left.len().max(right.len()) {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        if a != b {
            return if a > b { 1 } else { -1 };
        }
    }
    0
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_the_dedicated_uninstaller_in_the_registry() {
        let path = Path::new(r"C:\Program Files\Zylara");
        let (uninstall, quiet) = uninstall_strings(path);
        assert_eq!(uninstall, r#""C:\Program Files\Zylara\Uninstall Zylara.exe""#);
        assert_eq!(
            quiet,
            r#""C:\Program Files\Zylara\Uninstall Zylara.exe" --silent"#
        );
    }

    #[test]
    fn installation_size_counts_the_uninstaller_copy() {
        assert_eq!(installed_size(1000), 2000);
        assert_eq!(installed_size(u64::MAX), u64::MAX);
    }

    #[test]
    fn compares_versions_numerically() {
        assert_eq!(compare_versions("0.2.0", "0.1.9"), 1);
        assert_eq!(compare_versions("0.1.0", "0.1.0"), 0);
        assert_eq!(compare_versions("0.1.0", "0.2.0"), -1);
        assert_eq!(compare_versions("0.1.10", "0.1.9"), 1);
    }

    #[test]
    fn quote_arg_escapes_quotes() {
        assert_eq!(quote_arg(r"C:\Program Files\Zylara"), r#""C:\Program Files\Zylara""#);
        assert_eq!(quote_arg(r#"a"b"#), r#""a\"b""#);
    }

    #[test]
    fn human_bytes_is_stable() {
        assert_eq!(human_bytes(1024), "1.0 KB");
        assert_eq!(human_bytes(1024 * 1024), "1.0 MB");
    }

    #[test]
    fn installer_events_use_camel_case_fields() {
        let done = serde_json::to_value(InstallerEvent::Done {
            install_path: r"C:\Zylara".to_string(),
            launched: true,
            log_path: r"C:\Temp\setup.log".to_string(),
        })
        .unwrap();
        assert_eq!(done["kind"], "done");
        assert_eq!(done["installPath"], r"C:\Zylara");
        assert_eq!(done["logPath"], r"C:\Temp\setup.log");

        let error = serde_json::to_value(InstallerEvent::Error {
            message: "falhou".to_string(),
            log_path: "log".to_string(),
        })
        .unwrap();
        assert_eq!(error["kind"], "error");
        assert_eq!(error["logPath"], "log");
    }

    #[test]
    fn options_deserialize_from_the_frontend_contract() {
        let options: InstallOptions = serde_json::from_str(
            r#"{"scope":"machine","path":"C:\\Program Files\\Zylara","desktopShortcut":true,"startMenuShortcut":false,"launchAfterInstall":true}"#,
        )
        .unwrap();
        assert_eq!(options.scope, InstallScope::Machine);
        assert!(options.desktop_shortcut);
        assert!(!options.start_menu_shortcut);
        assert!(options.launch_after_install);
    }
}
