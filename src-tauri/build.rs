fn main() {
    tauri_build::build();

    // `tauri-build` only tracks `tauri.conf.json` and `capabilities`, so a new
    // brand asset would otherwise leave the old icon embedded in the executable
    // resource. Watch the icons referenced by the desktop bundle.
    for icon in [
        "icons/32x32.png",
        "icons/64x64.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico",
        "icons/icon.png",
    ] {
        println!("cargo:rerun-if-changed={icon}");
    }

    // Unit-test binaries link the whole library — including the dialog plugin
    // (rfd) — but Rust only embeds an application manifest into `[[bin]]`
    // targets. Without a manifest, Windows resolves `comctl32` v5 and the test
    // process aborts with STATUS_ENTRYPOINT_NOT_FOUND (TaskDialogIndirect).
    // Asking the linker to add the Common Controls v6 dependency fixes every
    // target (the app binary already depends on v6, so this is a no-op there).
    #[cfg(windows)]
    {
        // Passed as a single argv entry by cargo/rustc, so no embedded quotes.
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
}
