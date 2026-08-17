//! Real-disk replacement for ffmpeg.wasm's in-memory MEMFS.
//!
//! The editor was written against ffmpeg.wasm, so every call site refers to
//! bare virtual filenames — `writeFile("input.webm")`, `exec(["-i",
//! "input.webm", ..., "output.mp4"])`, `readFile("output.mp4")`. Rather than
//! rewriting those call sites, we hand ffmpeg a real scratch directory and
//! spawn it with its working directory set there. The exact same argv works
//! untouched, and files never have to fit in a wasm heap.

use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::ipc::{Request, Response};
use tauri::{Manager, State};

pub struct Scratch {
    root: PathBuf,
}

impl Scratch {
    /// Creates (and empties) the scratch directory. Emptying on launch clears
    /// intermediates left behind by a previous crash — they are never
    /// meaningful across runs.
    pub fn initialize(app: &tauri::AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("no cache dir: {e}"))?
            .join("scratch");

        if root.exists() {
            let _ = fs::remove_dir_all(&root);
        }
        fs::create_dir_all(&root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;

        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Maps a virtual filename onto the scratch directory.
    ///
    /// Only plain relative components are accepted. `..`, absolute paths and
    /// drive prefixes are rejected outright, so a crafted filename coming over
    /// the IPC boundary cannot reach outside the scratch directory.
    pub fn resolve(&self, virtual_path: &str) -> Result<PathBuf, String> {
        if virtual_path.is_empty() {
            return Err("empty path".into());
        }

        let candidate = Path::new(virtual_path);
        for component in candidate.components() {
            match component {
                Component::Normal(_) => {}
                _ => return Err(format!("illegal path {virtual_path:?}")),
            }
        }

        Ok(self.root.join(candidate))
    }
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// Writes bytes into the scratch dir, replacing or appending.
///
/// Takes a raw IPC body rather than a JSON argument, and supports appending so
/// the caller can stream a large file across in chunks. Sending a whole video
/// in one call means the browser holds the entire file, the IPC layer holds a
/// copy, and this side holds another — which is how importing a moderately
/// large clip managed to peak at several gigabytes and get the app OOM-killed.
#[tauri::command]
pub fn scratch_write(request: Request<'_>, scratch: State<'_, Scratch>) -> Result<(), String> {
    let virtual_path = header(&request, "x-loomo-path")
        .ok_or("scratch_write: missing x-loomo-path header")?
        .to_string();
    let append = header(&request, "x-loomo-append") == Some("1");

    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("scratch_write: expected a raw body".into());
    };

    let target = scratch.resolve(&virtual_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if append {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target)
            .map_err(|e| format!("open {}: {e}", target.display()))?;
        file.write_all(bytes)
            .map_err(|e| format!("append {}: {e}", target.display()))
    } else {
        fs::write(&target, bytes).map_err(|e| format!("write {}: {e}", target.display()))
    }
}

/// Reads bytes back out as a raw IPC response (an ArrayBuffer on the JS side).
#[tauri::command]
pub fn scratch_read(path: String, scratch: State<'_, Scratch>) -> Result<Response, String> {
    let target = scratch.resolve(&path)?;
    let bytes = fs::read(&target).map_err(|e| format!("read {}: {e}", target.display()))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn scratch_delete(path: String, scratch: State<'_, Scratch>) -> Result<(), String> {
    let target = scratch.resolve(&path)?;
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        // Deleting something already gone matches MEMFS cleanup semantics,
        // where callers fire deletes optimistically in a `catch {}`.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete {}: {e}", target.display())),
    }
}

/// Absolute on-disk location of a scratch file, for handing to a save dialog
/// or an `asset://` URL.
#[tauri::command]
pub fn scratch_path(path: String, scratch: State<'_, Scratch>) -> Result<String, String> {
    Ok(scratch.resolve(&path)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn scratch_size(path: String, scratch: State<'_, Scratch>) -> Result<u64, String> {
    let target = scratch.resolve(&path)?;
    Ok(fs::metadata(&target).map(|m| m.len()).unwrap_or(0))
}

/// Copies a finished artefact out of scratch to a user-chosen destination.
#[tauri::command]
pub fn scratch_export(
    path: String,
    destination: String,
    scratch: State<'_, Scratch>,
) -> Result<(), String> {
    let source = scratch.resolve(&path)?;
    fs::copy(&source, &destination)
        .map(|_| ())
        .map_err(|e| format!("copy to {destination}: {e}"))
}
