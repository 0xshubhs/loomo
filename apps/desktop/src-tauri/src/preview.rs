//! Native preview decoding.
//!
//! The webview's own media stack proved unusable for the preview on Linux:
//! WebKitGTK composites `<video>` as solid black on NVIDIA hybrid GPUs,
//! disabling DMABuf to work around that drops it to software compositing too
//! slow to edit against, and some ordinary MP4s intermittently wedge the
//! element at readyState 0. Rather than keep patching someone else's player,
//! the preview decodes with the bundled ffmpeg — the way a real editor does —
//! and the frontend paints the frames onto a canvas. The webview never touches
//! video again; audio stays on the (working) media element.
//!
//! Two paths:
//!  - `preview_frame`: one JPEG at a timestamp, for scrubbing (~100ms).
//!  - `preview_start`: an MJPEG stream at a fixed fps from a start time,
//!    frames pushed over an IPC channel as raw JPEG bytes.
//!
//! std::process is used instead of the shell plugin because the plugin
//! line-buffers stdout, which corrupts binary streams.

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::ipc::{Channel, Response};
use tauri::State;

use crate::scratch::Scratch;

#[derive(Default)]
pub struct PreviewState {
    streams: Mutex<HashMap<String, Child>>,
}

/// The bundled ffmpeg sits next to the executable (that is where Tauri
/// installs sidecars). Falls back to a system ffmpeg for dev runs.
fn ffmpeg_binary() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("no current exe: {e}"))?;
    let dir = exe.parent().ok_or("executable has no parent directory")?;
    let name = if cfg!(windows) { "loomo-ffmpeg.exe" } else { "loomo-ffmpeg" };
    let bundled = dir.join(name);
    if bundled.exists() {
        return Ok(bundled);
    }
    Ok(PathBuf::from("ffmpeg"))
}

fn fmt_time(seconds: f64) -> String {
    format!("{:.3}", seconds.max(0.0))
}

/// One decoded frame at `time`, as JPEG bytes. Used while scrubbing.
#[tauri::command]
pub fn preview_frame(
    scratch: State<'_, Scratch>,
    name: String,
    time: f64,
    width: u32,
) -> Result<Response, String> {
    let path = scratch.resolve(&name)?;
    let width = width.clamp(160, 1920) & !1;

    let output = Command::new(ffmpeg_binary()?)
        .args([
            "-hide_banner", "-loglevel", "error",
            "-ss", &fmt_time(time),
            "-i", &path.to_string_lossy(),
            "-frames:v", "1",
            "-vf", &format!("scale={width}:-2"),
            "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "4",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("cannot run ffmpeg: {e}"))?;

    if output.stdout.is_empty() {
        return Err(format!("no frame decoded at {time:.2}s"));
    }
    Ok(Response::new(output.stdout))
}

/// Starts a decode stream: JPEG frames at `fps` from `start_time`, pushed over
/// the channel in order. Frame N's source timestamp is `start_time + N/fps`.
#[tauri::command]
pub fn preview_start(
    state: State<'_, PreviewState>,
    scratch: State<'_, Scratch>,
    id: String,
    name: String,
    start_time: f64,
    fps: u32,
    width: u32,
    on_frame: Channel<String>,
) -> Result<(), String> {
    let path = scratch.resolve(&name)?;
    let fps = fps.clamp(5, 60);
    let width = width.clamp(160, 1920) & !1;

    // A stream id is one preview surface; a new stream replaces the old one.
    if let Some(mut old) = state.streams.lock().unwrap().remove(&id) {
        let _ = old.kill();
        let _ = old.wait();
    }

    let mut child = Command::new(ffmpeg_binary()?)
        .args([
            "-hide_banner", "-loglevel", "error",
            // Decode at realtime with a short head start. Running faster than
            // realtime overruns the consumer: the queue fills with frames the
            // playhead has not reached, trimming discards the oldest — exactly
            // the ones due next — and playback freezes after about a second.
            "-readrate", "1.0",
            "-readrate_initial_burst", "2",
            "-ss", &fmt_time(start_time),
            "-i", &path.to_string_lossy(),
            "-vf", &format!("fps={fps},scale={width}:-2"),
            "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "6",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start decoder: {e}"))?;

    let mut stdout = child.stdout.take().ok_or("decoder has no stdout")?;
    state.streams.lock().unwrap().insert(id, child);

    std::thread::spawn(move || {
        let mut buffer: Vec<u8> = Vec::with_capacity(256 * 1024);
        let mut chunk = [0u8; 64 * 1024];

        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    buffer.extend_from_slice(&chunk[..n]);
                    for frame in split_jpeg_frames(&mut buffer) {
                        // Base64 rather than raw bytes: a Tauri channel is a
                        // JSON transport, and raw payloads over it did not
                        // reach the page at all — the preview simply froze on
                        // its last frame with no error anywhere. The ~33% size
                        // cost is irrelevant next to frames that never arrive.
                        //
                        // A failed send means the window or channel is gone;
                        // stop decoding rather than spin for nobody.
                        if on_frame.send(base64_encode(&frame)).is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn preview_stop(state: State<'_, PreviewState>, id: String) -> Result<(), String> {
    if let Some(mut child) = state.streams.lock().unwrap().remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Kills every running decode stream. Called on window destroy.
pub fn kill_all(state: &PreviewState) {
    for (_, mut child) in state.streams.lock().unwrap().drain() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Standard base64, no line breaks. Hand-rolled to avoid a dependency for
/// something this small.
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[(triple >> 18) as usize & 63] as char);
        out.push(TABLE[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(triple >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[triple as usize & 63] as char } else { '=' });
    }

    out
}

/// Extracts complete JPEG frames from an MJPEG byte stream.
///
/// Frames are delimited by the SOI marker (FFD8) and EOI (FFD9). Within the
/// entropy-coded segment every FF is stuffed as FF00 and the only FFDx values
/// that appear are restart markers FFD0–FFD7, so scanning for FFD9 is a sound
/// frame boundary test for ffmpeg's MJPEG output. Incomplete trailing data is
/// left in the buffer for the next read.
fn split_jpeg_frames(buffer: &mut Vec<u8>) -> Vec<Vec<u8>> {
    let mut frames = Vec::new();
    let mut cursor = 0usize;

    loop {
        // Find the start-of-image from the cursor.
        let Some(soi) = find(buffer, cursor, &[0xFF, 0xD8, 0xFF]) else {
            break;
        };
        // Find the end-of-image after it.
        let Some(eoi) = find(buffer, soi + 2, &[0xFF, 0xD9]) else {
            // Frame incomplete: drop garbage before SOI, keep the rest.
            if soi > 0 {
                buffer.drain(..soi);
            }
            return frames;
        };
        frames.push(buffer[soi..eoi + 2].to_vec());
        cursor = eoi + 2;
    }

    buffer.drain(..cursor.min(buffer.len()));
    frames
}

fn find(haystack: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if from >= haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(payload: &[u8]) -> Vec<u8> {
        let mut f = vec![0xFF, 0xD8, 0xFF, 0xE0];
        f.extend_from_slice(payload);
        f.extend_from_slice(&[0xFF, 0xD9]);
        f
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        // High bytes must not sign-extend.
        assert_eq!(base64_encode(&[0xFF, 0xD8, 0xFF]), "/9j/");
    }

    #[test]
    fn splits_back_to_back_frames() {
        let a = jpeg(&[1, 2, 3]);
        let b = jpeg(&[4, 5]);
        let mut buf = [a.clone(), b.clone()].concat();
        let frames = split_jpeg_frames(&mut buf);
        assert_eq!(frames, vec![a, b]);
        assert!(buf.is_empty());
    }

    #[test]
    fn keeps_partial_frame_for_next_read() {
        let a = jpeg(&[9, 9]);
        let mut buf = a.clone();
        buf.extend_from_slice(&[0xFF, 0xD8, 0xFF, 0xE0, 7, 7]); // no EOI yet

        let frames = split_jpeg_frames(&mut buf);
        assert_eq!(frames, vec![a]);
        // The partial frame stays buffered.
        assert_eq!(&buf[..3], &[0xFF, 0xD8, 0xFF]);

        // Completing it on the next read yields the frame.
        buf.extend_from_slice(&[0xFF, 0xD9]);
        let frames = split_jpeg_frames(&mut buf);
        assert_eq!(frames.len(), 1);
        assert!(buf.is_empty());
    }

    #[test]
    fn survives_split_across_arbitrary_chunk_boundaries() {
        let a = jpeg(&[1; 100]);
        let b = jpeg(&[2; 50]);
        let whole = [a.clone(), b.clone()].concat();

        // Feed one byte at a time — the cruellest chunking.
        let mut buf = Vec::new();
        let mut got = Vec::new();
        for byte in whole {
            buf.push(byte);
            got.extend(split_jpeg_frames(&mut buf));
        }
        assert_eq!(got, vec![a, b]);
    }

    #[test]
    fn drops_garbage_before_first_frame() {
        let a = jpeg(&[5]);
        let mut buf = vec![0x00, 0x11, 0x22];
        buf.extend_from_slice(&a);
        let frames = split_jpeg_frames(&mut buf);
        assert_eq!(frames, vec![a]);
    }

    #[test]
    fn restart_markers_do_not_end_a_frame() {
        // FFD0..FFD7 appear inside entropy data; FFD9 must be the boundary.
        let mut payload = vec![0xFF, 0xD0, 0xAA, 0xFF, 0xD7, 0xBB];
        let a = jpeg(&payload);
        payload.clear();
        let mut buf = a.clone();
        let frames = split_jpeg_frames(&mut buf);
        assert_eq!(frames, vec![a]);
    }
}
