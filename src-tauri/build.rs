fn main() {
    tauri_build::build();

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
