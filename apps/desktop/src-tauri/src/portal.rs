//! Wayland screen capture through xdg-desktop-portal and PipeWire.
//!
//! ffmpeg cannot do this. Its only Linux screen grabber is x11grab, which under
//! Wayland sees Xwayland clients and nothing else — a black frame. There is no
//! pipewire input device in the binary we bundle; `ffmpeg -devices` lists
//! x11grab and no other capture source.
//!
//! This is a port of the sequence OBS drives in
//! `plugins/linux-pipewire/screencast-portal.c`:
//!
//!   1. `CreateSession`      — open a ScreenCast session
//!   2. `SelectSources`      — monitors and/or windows, and a cursor mode
//!   3. `Start`              — shows the picker; returns the PipeWire node id
//!   4. `OpenPipeWireRemote` — a file descriptor onto the PipeWire daemon
//!
//! OBS then consumes the node with its own PipeWire client. We hand the node to
//! GStreamer's `pipewiresrc`, which is the same PipeWire stream by a shorter
//! route, and pipe raw frames into the bundled ffmpeg for encoding — so the
//! encoder, the output format and the rest of the recorder stay exactly as they
//! are on X11, macOS and Windows.

#[cfg(target_os = "linux")]
use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType};
use ashpd::desktop::PersistMode;

/// What the portal handed back, and what `pipewiresrc` needs to open it.
#[cfg(target_os = "linux")]
pub struct PortalStream {
    /// PipeWire node id for the selected screen or window.
    pub node_id: u32,
    /// Descriptor onto the PipeWire daemon, owned for the session's lifetime.
    ///
    /// Held rather than used directly: `pipewiresrc` connects to the same
    /// daemon on its own, and the portal keeps the grant alive only while a
    /// remote stays open. Dropping this ends the capture.
    pub _remote: std::os::fd::OwnedFd,
    /// Kept alive for the same reason — closing the session revokes the node.
    pub _session: ashpd::desktop::Session<'static, Screencast<'static>>,
}

/// Whether this machine can capture through the portal at all.
#[cfg(target_os = "linux")]
pub async fn portal_available() -> bool {
    Screencast::new().await.is_ok()
}

/**
 * Runs the portal handshake and returns a live PipeWire node.
 *
 * The picker is shown by the desktop, not by us: the user chooses the screen or
 * window and that consent is what produces the node. There is no way to capture
 * without it, which is the point of the portal.
 */
#[cfg(target_os = "linux")]
pub async fn open_screencast(with_cursor: bool) -> Result<PortalStream, String> {
    let proxy = Screencast::new()
        .await
        .map_err(|e| format!("screencast portal unavailable: {e}"))?;

    let session = proxy
        .create_session()
        .await
        .map_err(|e| format!("create_session failed: {e}"))?;

    // Cursor modes are negotiated: ask for embedded only when the user wants
    // the pointer, and fall back to hidden. OBS prefers metadata where the
    // compositor offers it, which matters for its own compositing; we are
    // encoding straight to a file, so embedded is what we want.
    let cursor = if with_cursor {
        CursorMode::Embedded
    } else {
        CursorMode::Hidden
    };

    proxy
        .select_sources(
            &session,
            cursor,
            SourceType::Monitor | SourceType::Window,
            false,
            None,
            PersistMode::DoNot,
        )
        .await
        .map_err(|e| format!("select_sources failed: {e}"))?;

    let response = proxy
        .start(&session, None)
        .await
        .map_err(|e| format!("start failed: {e}"))?
        .response()
        .map_err(|e| format!("screen selection cancelled: {e}"))?;

    let stream = response
        .streams()
        .first()
        .ok_or_else(|| "the portal returned no streams".to_string())?;

    let node_id = stream.pipe_wire_node_id();

    let remote = proxy
        .open_pipe_wire_remote(&session)
        .await
        .map_err(|e| format!("open_pipe_wire_remote failed: {e}"))?;

    Ok(PortalStream {
        node_id,
        _remote: remote,
        _session: session,
    })
}
