//! Camera and microphone access inside the webview.
//!
//! WebKitGTK routes every privileged capability through the embedder's
//! `permission-request` signal, and denies the request when nothing handles it.
//! Tauri does not handle it, so `getUserMedia` failed with `NotAllowedError`
//! and `enumerateDevices` came back empty — the recorder reported "No cameras
//! found" on a machine with two working cameras and a microphone.
//!
//! Granting is the right answer here, but only for the capabilities the
//! recorder actually needs, and only for our own bundled page. The webview
//! loads `tauri://localhost`; there is no remote content and no third-party
//! frame that could ask on its own behalf. Anything else stays denied, which is
//! also what the default behaviour was.

#[cfg(target_os = "linux")]
pub fn grant_media_access(window: &tauri::WebviewWindow) -> Result<(), tauri::Error> {
    use webkit2gtk::glib::Cast;
    use webkit2gtk::{
        DeviceInfoPermissionRequest, PermissionRequestExt, UserMediaPermissionRequest, WebViewExt,
    };

    window.with_webview(|webview| {
        let view = webview.inner();
        view.connect_permission_request(|_, request| {
            // Downcasting is how the signal distinguishes request types: the
            // argument is the base PermissionRequest and the concrete type is
            // the only thing that says what is being asked for.
            let media = request.downcast_ref::<UserMediaPermissionRequest>().is_some();
            // enumerateDevices() needs this one separately, and without it the
            // device list stays empty even after capture has been allowed.
            let device_info = request
                .downcast_ref::<DeviceInfoPermissionRequest>()
                .is_some();

            if media || device_info {
                request.allow();
            } else {
                request.deny();
            }

            // Handled either way — returning false would let WebKit fall back
            // to its own default, which is to deny.
            true
        });
    })
}

#[cfg(not(target_os = "linux"))]
pub fn grant_media_access(_window: &tauri::WebviewWindow) -> Result<(), tauri::Error> {
    // macOS and Windows ask the OS itself, through the usual system prompts.
    Ok(())
}
