mod capture;
mod ffmpeg;
mod projects;
mod scratch;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // A second launch should focus the running window rather than start a
    // rival instance that fights over the same project files.
    #[cfg(all(desktop, not(any(target_os = "android", target_os = "ios"))))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let handle = app.handle();
            app.manage(scratch::Scratch::initialize(handle)?);
            app.manage(projects::Library::initialize(handle)?);
            app.manage(ffmpeg::FfmpegState::default());
            app.manage(capture::CaptureState::default());
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                // Nothing useful survives the window: stop the encoder and the
                // recorder instead of orphaning them as background processes.
                let app = window.app_handle();
                ffmpeg::kill_all(&app.state::<ffmpeg::FfmpegState>());
                capture::abort(&app.state::<capture::CaptureState>());
            }
        })
        .invoke_handler(tauri::generate_handler![
            scratch::scratch_write,
            scratch::scratch_read,
            scratch::scratch_delete,
            scratch::scratch_path,
            scratch::scratch_size,
            scratch::scratch_export,
            scratch::diag_log,
            scratch::diag_log_path,
            ffmpeg::ffmpeg_init,
            ffmpeg::ffmpeg_exec,
            ffmpeg::ffmpeg_cancel,
            ffmpeg::ffprobe_media,
            capture::capture_capabilities,
            capture::capture_start,
            capture::capture_stop,
            capture::capture_status,
            capture::capture_sources,
            projects::projects_list,
            projects::projects_load,
            projects::projects_save,
            projects::projects_delete,
            projects::projects_import_media,
            projects::projects_write_media,
            projects::projects_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Loomo")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                ffmpeg::kill_all(&app.state::<ffmpeg::FfmpegState>());
                capture::abort(&app.state::<capture::CaptureState>());
            }
        });
}
