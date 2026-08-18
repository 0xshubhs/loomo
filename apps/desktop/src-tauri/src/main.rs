// Prevents an extra console window from opening alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Deliberately no WEBKIT_DISABLE_DMABUF_RENDERER here. Turning the DMABuf
    // renderer off does make a black <video> visible on hybrid-GPU Linux, but
    // it drops WebKit onto a software compositing path that renders video
    // far too slowly to edit against — measured as a complete stall where the
    // accelerated path delivered 12 distinct frames in 5 seconds. The preview
    // paints decoded frames onto a canvas instead, which does not depend on
    // the webview compositing video at all.
    loomo_desktop_lib::run()
}
