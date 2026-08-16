//! Native screen capture.
//!
//! The browser recorder depends on `getDisplayMedia`, which is unavailable or
//! unreliable in the system webviews Tauri uses (notably WebKitGTK on Linux).
//! Capturing through ffmpeg instead gives us the same screen grab on all three
//! platforms, encodes straight to H.264 on the way to disk, and never has to
//! hold the recording in memory.
//!
//! Each platform has its own grabber: x11grab, avfoundation, gdigrab. Where a
//! platform can't deliver — a Wayland session, most importantly — we report it
//! and the frontend falls back to the browser recorder.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Notify;

use crate::scratch::Scratch;

struct CaptureHandle {
    child: CommandChild,
    output_name: String,
    output_path: PathBuf,
    started: Instant,
    finished: Arc<Notify>,
    exit_code: Arc<Mutex<Option<i32>>>,
    log: Arc<Mutex<Vec<String>>>,
}

#[derive(Default)]
pub struct CaptureState {
    active: Mutex<Option<CaptureHandle>>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOptions {
    #[serde(default = "default_fps")]
    pub fps: u32,
    /// Platform screen id: X11 display (`:0.0`), avfoundation index (`1`), or
    /// `desktop` on Windows. Defaults to the primary screen.
    pub screen: Option<String>,
    /// Platform audio id. `None` records silence.
    pub audio_device: Option<String>,
    pub region: Option<Region>,
    #[serde(default = "default_crf")]
    pub crf: u32,
    #[serde(default = "default_preset")]
    pub preset: String,
    pub output_name: Option<String>,
}

fn default_fps() -> u32 {
    30
}
fn default_crf() -> u32 {
    20
}
fn default_preset() -> String {
    "veryfast".to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStarted {
    pub output_name: String,
    pub output_path: String,
    pub command: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub output_name: String,
    pub output_path: String,
    pub duration: f64,
    pub size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureCapabilities {
    pub available: bool,
    pub backend: String,
    /// Populated when `available` is false, so the UI can explain the fallback.
    pub reason: Option<String>,
    pub supports_audio: bool,
    pub supports_region: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub id: String,
    pub label: String,
    pub kind: String, // "screen" | "audio"
}

// One definition per platform, rather than `#[cfg]` blocks inside a single
// body: a bare block in tail position parses as a statement, so the cfg'd
// variants would not be seen as the function's return value.

#[cfg(target_os = "linux")]
fn platform_capabilities() -> CaptureCapabilities {
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let wayland =
        session.eq_ignore_ascii_case("wayland") || std::env::var("WAYLAND_DISPLAY").is_ok();
    let has_x11 = std::env::var("DISPLAY").is_ok();

    // Under Wayland, x11grab only ever sees Xwayland clients — usually a black
    // frame. Portal/PipeWire capture is the real answer there and isn't wired
    // up yet, so we hand back to the browser recorder.
    if wayland {
        return CaptureCapabilities {
            available: false,
            backend: "x11grab".into(),
            reason: Some(
                "This is a Wayland session. Native capture needs X11; \
                 falling back to the browser recorder."
                    .into(),
            ),
            supports_audio: true,
            supports_region: true,
        };
    }

    CaptureCapabilities {
        available: has_x11,
        backend: "x11grab".into(),
        reason: (!has_x11).then(|| "No X11 DISPLAY found.".to_string()),
        supports_audio: true,
        supports_region: true,
    }
}

#[cfg(target_os = "macos")]
fn platform_capabilities() -> CaptureCapabilities {
    CaptureCapabilities {
        available: true,
        backend: "avfoundation".into(),
        reason: None,
        supports_audio: true,
        // avfoundation grabs whole displays; we crop after the fact.
        supports_region: false,
    }
}

#[cfg(target_os = "windows")]
fn platform_capabilities() -> CaptureCapabilities {
    CaptureCapabilities {
        available: true,
        backend: "gdigrab".into(),
        reason: None,
        supports_audio: true,
        supports_region: true,
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn platform_capabilities() -> CaptureCapabilities {
    CaptureCapabilities {
        available: false,
        backend: "none".into(),
        reason: Some("Unsupported platform.".into()),
        supports_audio: false,
        supports_region: false,
    }
}

#[tauri::command]
pub fn capture_capabilities() -> CaptureCapabilities {
    platform_capabilities()
}

/// Builds the platform-specific input half of the ffmpeg command line.
fn input_args(options: &CaptureOptions) -> Vec<String> {
    let fps = options.fps.to_string();
    let mut args: Vec<String> = Vec::new();

    #[cfg(target_os = "linux")]
    {
        let display = options
            .screen
            .clone()
            .or_else(|| std::env::var("DISPLAY").ok())
            .unwrap_or_else(|| ":0.0".into());

        args.extend(["-f".into(), "x11grab".into()]);
        args.extend(["-framerate".into(), fps.clone()]);
        args.extend(["-draw_mouse".into(), "1".into()]);

        let input = match &options.region {
            Some(r) => {
                args.extend(["-video_size".into(), format!("{}x{}", r.width, r.height)]);
                format!("{display}+{},{}", r.x, r.y)
            }
            // Without -video_size, x11grab measures the display itself.
            None => display,
        };
        args.extend(["-i".into(), input]);

        if let Some(device) = &options.audio_device {
            args.extend(["-f".into(), "pulse".into()]);
            args.extend(["-i".into(), device.clone()]);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let screen = options.screen.clone().unwrap_or_else(|| "1".into());
        args.extend(["-f".into(), "avfoundation".into()]);
        args.extend(["-capture_cursor".into(), "1".into()]);
        args.extend(["-framerate".into(), fps.clone()]);
        // avfoundation takes a single "video:audio" spec; a trailing colon
        // with no index means "no audio".
        let audio = options.audio_device.clone().unwrap_or_default();
        args.extend(["-i".into(), format!("{screen}:{audio}")]);
    }

    #[cfg(target_os = "windows")]
    {
        args.extend(["-f".into(), "gdigrab".into()]);
        args.extend(["-framerate".into(), fps.clone()]);
        args.extend(["-draw_mouse".into(), "1".into()]);
        if let Some(r) = &options.region {
            args.extend(["-offset_x".into(), r.x.to_string()]);
            args.extend(["-offset_y".into(), r.y.to_string()]);
            args.extend(["-video_size".into(), format!("{}x{}", r.width, r.height)]);
        }
        let screen = options.screen.clone().unwrap_or_else(|| "desktop".into());
        args.extend(["-i".into(), screen]);

        if let Some(device) = &options.audio_device {
            args.extend(["-f".into(), "dshow".into()]);
            args.extend(["-i".into(), format!("audio={device}")]);
        }
    }

    let _ = fps;
    args
}

fn encode_args(options: &CaptureOptions, output: &str) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        options.preset.clone(),
        "-crf".into(),
        options.crf.to_string(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        // Screens are routinely an odd number of pixels wide; yuv420p demands
        // even dimensions, so round down rather than fail at startup.
        "-vf".into(),
        "scale=trunc(iw/2)*2:trunc(ih/2)*2".into(),
        "-movflags".into(),
        "+faststart".into(),
    ];

    if options.audio_device.is_some() {
        args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "160k".into()]);
    }

    args.push(output.to_string());
    args
}

#[tauri::command]
pub async fn capture_start(
    app: AppHandle,
    state: State<'_, CaptureState>,
    scratch: State<'_, Scratch>,
    options: CaptureOptions,
) -> Result<CaptureStarted, String> {
    if state.active.lock().unwrap().is_some() {
        return Err("A recording is already running.".into());
    }

    let capabilities = capture_capabilities();
    if !capabilities.available {
        return Err(capabilities
            .reason
            .unwrap_or_else(|| "Native capture unavailable.".into()));
    }

    let output_name = options
        .output_name
        .clone()
        .unwrap_or_else(|| "capture.mp4".to_string());
    let output_path = scratch.resolve(&output_name)?;

    // Deliberately no `-nostdin` here, unlike ffmpeg_exec: capture_stop ends
    // the recording by writing "q" to stdin, and -nostdin would make ffmpeg
    // ignore it — the stop would time out and fall back to a kill, leaving an
    // MP4 with no index.
    let mut argv = vec!["-hide_banner".to_string(), "-y".to_string()];
    argv.extend(input_args(&options));
    argv.extend(encode_args(&options, &output_name));

    let (mut rx, child) = app
        .shell()
        .sidecar("loomo-ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar missing: {e}"))?
        .current_dir(scratch.root().to_path_buf())
        .args(&argv)
        .spawn()
        .map_err(|e| format!("cannot start capture: {e}"))?;

    let finished = Arc::new(Notify::new());
    let exit_code = Arc::new(Mutex::new(None));
    let log = Arc::new(Mutex::new(Vec::new()));

    // The event stream must be drained continuously or ffmpeg blocks writing
    // to a full pipe, so this runs for the whole life of the recording.
    {
        let finished = finished.clone();
        let exit_code = exit_code.clone();
        let log = log.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                        let chunk = String::from_utf8_lossy(&bytes);
                        let mut log = log.lock().unwrap();
                        for line in chunk.lines() {
                            if log.len() == 60 {
                                log.remove(0);
                            }
                            log.push(line.to_string());
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        *exit_code.lock().unwrap() = Some(payload.code.unwrap_or(-1));
                    }
                    _ => {}
                }
            }
            // notify_one leaves a permit behind, so capture_stop still wakes
            // even if ffmpeg exits before it starts waiting.
            finished.notify_one();
        });
    }

    *state.active.lock().unwrap() = Some(CaptureHandle {
        child,
        output_name: output_name.clone(),
        output_path: output_path.clone(),
        started: Instant::now(),
        finished,
        exit_code,
        log,
    });

    Ok(CaptureStarted {
        output_name,
        output_path: output_path.to_string_lossy().into_owned(),
        command: argv,
    })
}

#[tauri::command]
pub async fn capture_stop(
    app: AppHandle,
    state: State<'_, CaptureState>,
) -> Result<CaptureResult, String> {
    // Signal a graceful stop, then release the lock before awaiting so a
    // concurrent status poll can't deadlock against us.
    let (finished, exit_code, log, output_name, output_path, started) = {
        let mut active = state.active.lock().unwrap();
        let handle = active.as_mut().ok_or("No recording is running.")?;
        // "q" on stdin makes ffmpeg finalise the container — killing it here
        // would leave an unplayable moov-less MP4.
        let _ = handle.child.write(b"q\n");
        (
            handle.finished.clone(),
            handle.exit_code.clone(),
            handle.log.clone(),
            handle.output_name.clone(),
            handle.output_path.clone(),
            handle.started,
        )
    };

    let graceful = tokio::time::timeout(Duration::from_secs(15), finished.notified())
        .await
        .is_ok();

    let handle = state.active.lock().unwrap().take();
    if !graceful {
        if let Some(handle) = handle {
            let _ = handle.child.kill();
        }
        return Err(format!(
            "Recording did not finalise in time; the file may be truncated.\n{}",
            log.lock().unwrap().join("\n")
        ));
    }

    let code = *exit_code.lock().unwrap();
    if !output_path.exists() {
        return Err(format!(
            "Capture produced no file (ffmpeg exit {:?}).\n{}",
            code,
            log.lock().unwrap().join("\n")
        ));
    }

    let size_bytes = std::fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);

    // Trust the container's own duration; the wall clock includes ffmpeg
    // startup and the drain on shutdown.
    let duration = probe_duration(&app, &output_path)
        .await
        .unwrap_or_else(|| started.elapsed().as_secs_f64());

    Ok(CaptureResult {
        output_name,
        output_path: output_path.to_string_lossy().into_owned(),
        duration,
        size_bytes,
    })
}

#[tauri::command]
pub fn capture_status(state: State<'_, CaptureState>) -> Option<f64> {
    state
        .active
        .lock()
        .unwrap()
        .as_ref()
        .map(|h| h.started.elapsed().as_secs_f64())
}

async fn probe_duration(app: &AppHandle, path: &PathBuf) -> Option<f64> {
    let output = app
        .shell()
        .sidecar("loomo-ffprobe")
        .ok()?
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            &path.to_string_lossy(),
        ])
        .output()
        .await
        .ok()?;

    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

/// Enumerates screens and audio inputs the native backend can record from.
#[tauri::command]
pub async fn capture_sources(app: AppHandle) -> Result<Vec<CaptureSource>, String> {
    let mut sources = Vec::new();

    #[cfg(target_os = "linux")]
    {
        let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0.0".into());
        sources.push(CaptureSource {
            id: display.clone(),
            label: format!("Full desktop ({display})"),
            kind: "screen".into(),
        });

        // xrandr is not guaranteed to be installed; per-monitor entries are a
        // bonus on top of the whole-desktop option above.
        if let Ok(out) = std::process::Command::new("xrandr")
            .arg("--listmonitors")
            .output()
        {
            for line in String::from_utf8_lossy(&out.stdout).lines().skip(1) {
                // e.g. " 0: +*HDMI-1 1920/509x1080/286+0+0  HDMI-1"
                let Some(geometry) = line.split_whitespace().nth(2) else {
                    continue;
                };
                let name = line.split_whitespace().last().unwrap_or("monitor");
                let cleaned: String = geometry
                    .split('+')
                    .next()
                    .unwrap_or("")
                    .split('x')
                    .map(|part| part.split('/').next().unwrap_or("0").to_string())
                    .collect::<Vec<_>>()
                    .join("x");
                let offsets: Vec<&str> = geometry.split('+').skip(1).collect();
                if cleaned.contains('x') && offsets.len() == 2 {
                    sources.push(CaptureSource {
                        id: format!("{display}+{},{}", offsets[0], offsets[1]),
                        label: format!("{name} ({cleaned})"),
                        kind: "screen".into(),
                    });
                }
            }
        }

        sources.push(CaptureSource {
            id: "default".into(),
            label: "System default input".into(),
            kind: "audio".into(),
        });
        if let Ok(out) = std::process::Command::new("pactl")
            .args(["list", "short", "sources"])
            .output()
        {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let mut fields = line.split('\t');
                let _index = fields.next();
                if let Some(name) = fields.next() {
                    sources.push(CaptureSource {
                        id: name.to_string(),
                        label: name.replace('_', " "),
                        kind: "audio".into(),
                    });
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // avfoundation only lists devices via an intentionally-failing call.
        let output = app
            .shell()
            .sidecar("loomo-ffmpeg")
            .map_err(|e| e.to_string())?
            .args(["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""])
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let text = String::from_utf8_lossy(&output.stderr);
        let mut kind = "screen";
        for line in text.lines() {
            if line.contains("AVFoundation video devices") {
                kind = "screen";
                continue;
            }
            if line.contains("AVFoundation audio devices") {
                kind = "audio";
                continue;
            }
            // e.g. "[AVFoundation indev @ 0x…] [1] Capture screen 0"
            let Some(rest) = line.split("] [").nth(1) else {
                continue;
            };
            let Some((index, label)) = rest.split_once("] ") else {
                continue;
            };
            if index.parse::<u32>().is_err() {
                continue;
            }
            if kind == "screen" && !label.to_lowercase().contains("screen") {
                continue; // skip webcams; the browser path handles those
            }
            sources.push(CaptureSource {
                id: index.to_string(),
                label: label.trim().to_string(),
                kind: kind.into(),
            });
        }
    }

    #[cfg(target_os = "windows")]
    {
        sources.push(CaptureSource {
            id: "desktop".into(),
            label: "Full desktop".into(),
            kind: "screen".into(),
        });

        let output = app
            .shell()
            .sidecar("loomo-ffmpeg")
            .map_err(|e| e.to_string())?
            .args(["-hide_banner", "-f", "dshow", "-list_devices", "true", "-i", "dummy"])
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let text = String::from_utf8_lossy(&output.stderr);
        let mut in_audio = false;
        for line in text.lines() {
            if line.contains("DirectShow audio devices") {
                in_audio = true;
                continue;
            }
            if line.contains("DirectShow video devices") {
                in_audio = false;
                continue;
            }
            if !in_audio {
                continue;
            }
            // e.g. `[dshow @ …]  "Microphone (Realtek Audio)"`
            if let Some(name) = line.split('"').nth(1) {
                sources.push(CaptureSource {
                    id: name.to_string(),
                    label: name.to_string(),
                    kind: "audio".into(),
                });
            }
        }
    }

    let _ = &app;
    Ok(sources)
}

/// Stops any running capture without waiting — used on app shutdown.
pub fn abort(state: &CaptureState) {
    if let Some(handle) = state.active.lock().unwrap().take() {
        let _ = handle.child.kill();
    }
}
