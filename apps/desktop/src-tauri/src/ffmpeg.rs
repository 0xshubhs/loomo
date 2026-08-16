//! Native FFmpeg execution.
//!
//! Mirrors the surface of the browser `FFmpegBridge` (exec / progress / log /
//! cancel) so the editor's export pipeline runs unchanged, but against the
//! real ffmpeg binary shipped as a Tauri sidecar.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::scratch::Scratch;

#[derive(Default)]
pub struct FfmpegState {
    running: Mutex<HashMap<String, CommandChild>>,
    cancelled: Mutex<Vec<String>>,
}

/// Exit code reported when an operation was killed by `ffmpeg_cancel`.
pub const EXIT_CANCELLED: i32 = 130;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ExecEvent {
    /// Fractional completion in 0..=1, plus the encoded timestamp in seconds.
    // `rename_all` renames enum *variants*, not their fields, so the field
    // needs its own rename to reach JS as camelCase.
    Progress {
        progress: f64,
        #[serde(rename = "outTime")]
        out_time: f64,
    },
    Log {
        line: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub version: String,
    pub scratch_dir: String,
}

/// Global flags prepended to every invocation.
///
/// `-progress pipe:1` emits machine-readable `key=value` progress on stdout,
/// which is far more reliable than scraping the human-readable stats line.
/// `-nostdin` stops ffmpeg from consuming our stdin and hanging, and `-y`
/// makes overwrites non-interactive (MEMFS never prompted).
fn global_flags() -> Vec<String> {
    [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-loglevel",
        "level+info",
        "-progress",
        "pipe:1",
        "-nostats",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Parses `HH:MM:SS.ff` into seconds.
fn parse_timestamp(value: &str) -> Option<f64> {
    let mut total = 0.0;
    for part in value.trim().split(':') {
        total = total * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(total)
}

/// Pulls `Duration: 00:01:23.45` out of an ffmpeg stderr line.
fn parse_duration_line(line: &str) -> Option<f64> {
    let rest = line.split("Duration:").nth(1)?;
    let value = rest.split(',').next()?;
    if value.contains("N/A") {
        return None;
    }
    parse_timestamp(value)
}

#[tauri::command]
pub async fn ffmpeg_init(app: AppHandle, scratch: State<'_, Scratch>) -> Result<FfmpegInfo, String> {
    let output = app
        .shell()
        .sidecar("loomo-ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar missing: {e}"))?
        .args(["-hide_banner", "-version"])
        .output()
        .await
        .map_err(|e| format!("cannot run ffmpeg: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg -version exited with {:?}",
            output.status.code()
        ));
    }

    let version = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("ffmpeg")
        .to_string();

    Ok(FfmpegInfo {
        version,
        scratch_dir: scratch.root().to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn ffmpeg_exec(
    app: AppHandle,
    state: State<'_, FfmpegState>,
    scratch: State<'_, Scratch>,
    id: String,
    args: Vec<String>,
    duration_hint: Option<f64>,
    on_event: Channel<ExecEvent>,
) -> Result<i32, String> {
    let mut argv = global_flags();
    argv.extend(args);

    let (mut rx, child) = app
        .shell()
        .sidecar("loomo-ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar missing: {e}"))?
        // Running in the scratch dir is what lets the editor keep passing bare
        // filenames straight through from its ffmpeg.wasm days.
        .current_dir(scratch.root().to_path_buf())
        .args(&argv)
        .spawn()
        .map_err(|e| format!("cannot spawn ffmpeg: {e}"))?;

    state.running.lock().unwrap().insert(id.clone(), child);

    // Longest input duration seen so far, used to turn out_time into a ratio.
    let mut total_duration = duration_hint.filter(|d| *d > 0.0);
    let mut exit_code = -1i32;
    let mut stderr_tail: Vec<String> = Vec::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let chunk = String::from_utf8_lossy(&bytes);
                for line in chunk.lines() {
                    let Some((key, value)) = line.split_once('=') else {
                        continue;
                    };
                    if key.trim() != "out_time_us" && key.trim() != "out_time_ms" {
                        continue;
                    }
                    // `out_time_ms` is a long-standing ffmpeg misnomer: both
                    // keys are microseconds.
                    let Ok(micros) = value.trim().parse::<f64>() else {
                        continue;
                    };
                    let out_time = micros / 1_000_000.0;
                    let progress = match total_duration {
                        Some(d) if d > 0.0 => (out_time / d).clamp(0.0, 1.0),
                        _ => 0.0,
                    };
                    let _ = on_event.send(ExecEvent::Progress { progress, out_time });
                }
            }

            CommandEvent::Stderr(bytes) => {
                let chunk = String::from_utf8_lossy(&bytes);
                for line in chunk.lines() {
                    if total_duration.is_none() {
                        if let Some(d) = parse_duration_line(line) {
                            total_duration = Some(d);
                        }
                    }
                    if stderr_tail.len() == 40 {
                        stderr_tail.remove(0);
                    }
                    stderr_tail.push(line.to_string());
                    let _ = on_event.send(ExecEvent::Log {
                        line: line.to_string(),
                    });
                }
            }

            CommandEvent::Terminated(payload) => {
                exit_code = payload.code.unwrap_or(-1);
            }

            CommandEvent::Error(message) => {
                let _ = on_event.send(ExecEvent::Log {
                    line: format!("[error] {message}"),
                });
            }

            _ => {}
        }
    }

    state.running.lock().unwrap().remove(&id);

    {
        let mut cancelled = state.cancelled.lock().unwrap();
        if let Some(pos) = cancelled.iter().position(|c| *c == id) {
            cancelled.remove(pos);
            return Ok(EXIT_CANCELLED);
        }
    }

    if exit_code == 0 {
        // Report a clean 1.0 even when the last progress tick landed short.
        let _ = on_event.send(ExecEvent::Progress {
            progress: 1.0,
            out_time: total_duration.unwrap_or(0.0),
        });
        return Ok(0);
    }

    // Surface ffmpeg's own diagnostics instead of a bare exit code — a failed
    // filtergraph is otherwise invisible from the UI.
    Err(format!(
        "ffmpeg exited with {exit_code}\n{}",
        stderr_tail.join("\n")
    ))
}

#[tauri::command]
pub fn ffmpeg_cancel(state: State<'_, FfmpegState>, id: String) -> Result<(), String> {
    let child = state.running.lock().unwrap().remove(&id);
    match child {
        Some(child) => {
            state.cancelled.lock().unwrap().push(id);
            child.kill().map_err(|e| format!("cannot kill ffmpeg: {e}"))
        }
        // Already finished on its own — nothing to do.
        None => Ok(()),
    }
}

/// Kills every in-flight operation. Used on window close so a long export
/// can't outlive the app.
pub fn kill_all(state: &FfmpegState) {
    let children: Vec<CommandChild> = state.running.lock().unwrap().drain().map(|(_, c)| c).collect();
    for child in children {
        let _ = child.kill();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    pub audio_codec: String,
    pub bitrate: u64,
}

/// Probes a scratch file with ffprobe. Much cheaper and more accurate than
/// loading the media into a hidden `<video>` element to read its metadata.
#[tauri::command]
pub async fn ffprobe_media(
    app: AppHandle,
    scratch: State<'_, Scratch>,
    path: String,
) -> Result<MediaProbe, String> {
    let target = scratch.resolve(&path)?;

    let output = app
        .shell()
        .sidecar("loomo-ffprobe")
        .map_err(|e| format!("ffprobe sidecar missing: {e}"))?
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate",
            "-of",
            "json",
            &target.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("cannot run ffprobe: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("bad ffprobe json: {e}"))?;

    let format = &json["format"];
    let mut probe = MediaProbe {
        duration: format["duration"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0),
        width: 0,
        height: 0,
        fps: 0.0,
        codec: String::new(),
        audio_codec: String::new(),
        bitrate: format["bit_rate"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0),
    };

    let no_streams = Vec::new();
    for stream in json["streams"].as_array().unwrap_or(&no_streams) {
        match stream["codec_type"].as_str() {
            Some("video") if probe.width == 0 => {
                probe.width = stream["width"].as_u64().unwrap_or(0) as u32;
                probe.height = stream["height"].as_u64().unwrap_or(0) as u32;
                probe.codec = stream["codec_name"].as_str().unwrap_or("").to_string();
                // avg_frame_rate is a rational like "30000/1001".
                if let Some(rate) = stream["avg_frame_rate"].as_str() {
                    if let Some((num, den)) = rate.split_once('/') {
                        let (n, d) = (num.parse::<f64>().ok(), den.parse::<f64>().ok());
                        if let (Some(n), Some(d)) = (n, d) {
                            if d != 0.0 {
                                probe.fps = n / d;
                            }
                        }
                    }
                }
            }
            Some("audio") if probe.audio_codec.is_empty() => {
                probe.audio_codec = stream["codec_name"].as_str().unwrap_or("").to_string();
            }
            _ => {}
        }
    }

    Ok(probe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hms_timestamps() {
        assert_eq!(parse_timestamp("00:00:10.50"), Some(10.5));
        assert_eq!(parse_timestamp("01:02:03.00"), Some(3723.0));
        assert_eq!(parse_timestamp("nope"), None);
    }

    #[test]
    fn parses_duration_from_stderr() {
        let line = "  Duration: 00:01:23.45, start: 0.000000, bitrate: 1234 kb/s";
        assert_eq!(parse_duration_line(line), Some(83.45));
        assert_eq!(parse_duration_line("  Duration: N/A, bitrate: N/A"), None);
        assert_eq!(parse_duration_line("Stream #0:0: Video: h264"), None);
    }
}
