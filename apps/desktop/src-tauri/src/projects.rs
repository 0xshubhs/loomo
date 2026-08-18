//! On-disk project library.
//!
//! The web build keeps projects on the server. A desktop app has to work with
//! the network unplugged, so projects live in the OS app-data directory:
//!
//!   <app_data>/projects/<id>/project.json   timeline, serialised by the frontend
//!   <app_data>/projects/<id>/meta.json      name + timestamps, for fast listing
//!   <app_data>/projects/<id>/media/…        imported source media
//!
//! Media is copied into the project rather than referenced in place, so a
//! project keeps working after the user moves or deletes the original file.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::ipc::Request;
use tauri::{Manager, State};

pub struct Library {
    root: PathBuf,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub thumbnail: Option<String>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Recursively totals a directory, so the library can show real disk usage.
fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => directory_size(&entry.path()),
            Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

impl Library {
    pub fn initialize(app: &tauri::AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("no app data dir: {e}"))?
            .join("projects");
        fs::create_dir_all(&root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;
        Ok(Self { root })
    }

    /// Project ids come from the frontend, so they are validated before they
    /// ever reach the filesystem.
    fn project_dir(&self, id: &str) -> Result<PathBuf, String> {
        let valid = !id.is_empty()
            && id.len() <= 128
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if !valid {
            return Err(format!("invalid project id {id:?}"));
        }
        Ok(self.root.join(id))
    }
}

/// Rejects anything that isn't a plain filename, keeping imports inside the
/// project's own media directory.
fn safe_filename(name: &str) -> Result<&str, String> {
    let path = Path::new(name);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(name),
        _ => Err(format!("invalid filename {name:?}")),
    }
}

/// Decodes a percent-encoded value.
///
/// IPC headers are ASCII-only, but media filenames are whatever the user's
/// filesystem holds — "café.mp4", "録画.mov". The JS side percent-encodes the
/// filename so it survives the header; this puts it back.
fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes
                .get(i + 1..i + 3)
                .ok_or_else(|| format!("truncated escape in {input:?}"))?;
            let hex = std::str::from_utf8(hex).map_err(|_| "invalid escape".to_string())?;
            out.push(
                u8::from_str_radix(hex, 16).map_err(|_| format!("bad escape %{hex} in {input:?}"))?,
            );
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }

    String::from_utf8(out).map_err(|_| format!("filename {input:?} is not valid UTF-8"))
}

#[tauri::command]
pub fn projects_list(library: State<'_, Library>) -> Result<Vec<ProjectMeta>, String> {
    let Ok(entries) = fs::read_dir(&library.root) else {
        return Ok(Vec::new());
    };

    let mut projects: Vec<ProjectMeta> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|entry| {
            let raw = fs::read_to_string(entry.path().join("meta.json")).ok()?;
            let mut meta: ProjectMeta = serde_json::from_str(&raw).ok()?;
            meta.size_bytes = directory_size(&entry.path());
            Some(meta)
        })
        .collect();

    projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(projects)
}

#[tauri::command]
pub fn projects_load(library: State<'_, Library>, id: String) -> Result<String, String> {
    let path = library.project_dir(&id)?.join("project.json");
    fs::read_to_string(&path).map_err(|e| format!("cannot open project {id}: {e}"))
}

#[tauri::command]
pub fn projects_save(
    library: State<'_, Library>,
    id: String,
    name: String,
    document: String,
    duration: Option<f64>,
    thumbnail: Option<String>,
) -> Result<ProjectMeta, String> {
    let dir = library.project_dir(&id)?;
    fs::create_dir_all(dir.join("media")).map_err(|e| e.to_string())?;

    let meta_path = dir.join("meta.json");
    let created_at = fs::read_to_string(&meta_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<ProjectMeta>(&raw).ok())
        .map(|m| m.created_at)
        .unwrap_or_else(now_millis);

    // Write to a temp file and rename, so a crash mid-save can't leave a
    // half-written project.json behind.
    let document_path = dir.join("project.json");
    let temp_path = dir.join("project.json.tmp");
    fs::write(&temp_path, document).map_err(|e| format!("cannot write project: {e}"))?;
    fs::rename(&temp_path, &document_path).map_err(|e| format!("cannot commit project: {e}"))?;

    let meta = ProjectMeta {
        id,
        name,
        created_at,
        updated_at: now_millis(),
        duration: duration.unwrap_or(0.0),
        size_bytes: directory_size(&dir),
        thumbnail,
    };
    fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("cannot write project metadata: {e}"))?;

    Ok(meta)
}

#[tauri::command]
pub fn projects_delete(library: State<'_, Library>, id: String) -> Result<(), String> {
    let dir = library.project_dir(&id)?;
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot delete project {id}: {e}")),
    }
}

/// Copies a file the user picked into the project's media vault.
#[tauri::command]
pub fn projects_import_media(
    library: State<'_, Library>,
    id: String,
    source: String,
    filename: String,
) -> Result<String, String> {
    let name = safe_filename(&filename)?;
    let media_dir = library.project_dir(&id)?.join("media");
    fs::create_dir_all(&media_dir).map_err(|e| e.to_string())?;

    let destination = media_dir.join(name);
    fs::copy(&source, &destination).map_err(|e| format!("cannot import {source}: {e}"))?;
    Ok(destination.to_string_lossy().into_owned())
}

/// Stores raw bytes (a browser `File`, a finished recording) as project media.
#[tauri::command]
pub fn projects_write_media(
    request: Request<'_>,
    library: State<'_, Library>,
) -> Result<String, String> {
    let headers = request.headers();
    let id = headers
        .get("x-loomo-project")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-loomo-project header")?;
    let filename = headers
        .get("x-loomo-filename")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-loomo-filename header")?;
    let filename = percent_decode(filename)?;

    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw body".into());
    };

    let name = safe_filename(&filename)?;
    let media_dir = library.project_dir(id)?.join("media");
    fs::create_dir_all(&media_dir).map_err(|e| e.to_string())?;

    let destination = media_dir.join(name);
    fs::write(&destination, bytes).map_err(|e| format!("cannot write media: {e}"))?;
    Ok(destination.to_string_lossy().into_owned())
}

/**
 * Copies a project's media into the scratch directory so ffmpeg can reach it.
 *
 * The reverse of `projects_import_media`, and the reason reopening a project is
 * cheap: both directions are a file copy inside Rust, so a gigabyte of footage
 * never crosses the IPC boundary or enters the webview's heap.
 */
#[tauri::command]
pub fn projects_stage_media(
    library: State<'_, Library>,
    scratch: State<'_, crate::scratch::Scratch>,
    id: String,
    filename: String,
    scratch_name: String,
) -> Result<String, String> {
    let name = safe_filename(&filename)?;
    let source = library.project_dir(&id)?.join("media").join(name);
    if !source.is_file() {
        return Err(format!("project media {} is missing", source.display()));
    }

    let destination = scratch.resolve(&scratch_name)?;
    fs::copy(&source, &destination)
        .map_err(|e| format!("cannot stage {}: {e}", source.display()))?;
    Ok(scratch_name)
}

/// Absolute path of a file in the scratch directory, for handing to an import.
#[tauri::command]
pub fn projects_scratch_path(
    scratch: State<'_, crate::scratch::Scratch>,
    name: String,
) -> Result<String, String> {
    Ok(scratch.resolve(&name)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn projects_dir(library: State<'_, Library>, id: Option<String>) -> Result<String, String> {
    let path = match id {
        Some(id) => library.project_dir(&id)?,
        None => library.root.clone(),
    };
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes() {
        // What encodeURIComponent("café.mp4") sends.
        assert_eq!(percent_decode("caf%C3%A9.mp4").unwrap(), "café.mp4");
        assert_eq!(percent_decode("%E9%8C%B2%E7%94%BB.mov").unwrap(), "録画.mov");
        assert_eq!(percent_decode("plain.mp4").unwrap(), "plain.mp4");
        assert_eq!(percent_decode("a%20b.mp4").unwrap(), "a b.mp4");
    }

    #[test]
    fn rejects_malformed_escapes() {
        assert!(percent_decode("bad%").is_err());
        assert!(percent_decode("bad%ZZ.mp4").is_err());
    }

    #[test]
    fn filename_must_be_a_single_plain_component() {
        assert!(safe_filename("clip.mp4").is_ok());
        assert!(safe_filename("../../etc/passwd").is_err());
        assert!(safe_filename("/etc/passwd").is_err());
        assert!(safe_filename("nested/clip.mp4").is_err());
    }
}
