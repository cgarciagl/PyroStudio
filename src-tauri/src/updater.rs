use futures_util::StreamExt as _;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

const GITHUB_RELEASE_BASE: &str = "https://github.com/cgarciagl/PyroStudio/releases/download";
const MIN_PORTABLE_EXE_BYTES: u64 = 1_024 * 1024; // 1 MB sanity floor

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableUpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// Removes any leftover `<exe>.old` file created during a previous portable self-update.
pub fn cleanup_old_portable_exe() {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            let old_path = old_backup_path(&exe);
            if old_path.exists() {
                let _ = fs::remove_file(&old_path);
            }
        }
    }
}

fn old_backup_path(exe_path: &Path) -> PathBuf {
    let mut os = exe_path.as_os_str().to_os_string();
    os.push(".old");
    PathBuf::from(os)
}

fn temp_download_path(exe_path: &Path, version: &str) -> Result<PathBuf, String> {
    let parent = exe_path
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta del ejecutable.".to_string())?;
    let file_name = exe_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("PyroStudio.exe");
    Ok(parent.join(format!(".{file_name}.v{version}.update.tmp")))
}

fn normalize_path_for_prefix(path: &Path) -> String {
    let s = path.to_string_lossy().replace('/', "\\");
    s.trim_end_matches('\\').to_ascii_lowercase()
}

/// Pure helper to determine whether a Windows executable path represents a portable binary
/// rather than an NSIS/MSI installation.
pub(crate) fn is_windows_portable_path(
    exe_path: &Path,
    has_uninstaller: bool,
    program_dirs: &[PathBuf],
) -> bool {
    if has_uninstaller {
        return false;
    }

    let normalized_exe = normalize_path_for_prefix(exe_path);
    for dir in program_dirs {
        let normalized_dir = normalize_path_for_prefix(dir);
        if normalized_dir.is_empty() {
            continue;
        }
        if normalized_exe == normalized_dir
            || normalized_exe.starts_with(&format!("{normalized_dir}\\"))
        {
            return false;
        }
    }

    true
}

fn detect_portable_mode_for_exe(exe_path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        let has_uninstaller = exe_path
            .parent()
            .map(|p| p.join("uninstall.exe").exists())
            .unwrap_or(false);

        let mut program_dirs: Vec<PathBuf> = Vec::new();
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Ok(val) = std::env::var(var) {
                if !val.trim().is_empty() {
                    program_dirs.push(PathBuf::from(val));
                }
            }
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            if !local_app_data.trim().is_empty() {
                program_dirs.push(PathBuf::from(local_app_data).join("Programs"));
            }
        }

        is_windows_portable_path(exe_path, has_uninstaller, &program_dirs)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = exe_path;
        false
    }
}

fn sanitize_version(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_start_matches('v');
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+')
    {
        return Err(format!("Versión inválida para actualización: {raw}"));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn portable_asset_url(version: &str) -> Result<String, String> {
    let clean = sanitize_version(version)?;
    Ok(format!(
        "{GITHUB_RELEASE_BASE}/v{clean}/PyroStudio_v{clean}_x64_portable.exe"
    ))
}

fn parse_sha256_file(text: &str) -> Option<String> {
    let token = text.split_whitespace().next()?.trim().to_ascii_lowercase();
    if token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(token)
    } else {
        None
    }
}

#[tauri::command]
pub fn is_portable_mode() -> bool {
    match std::env::current_exe() {
        Ok(exe) => detect_portable_mode_for_exe(&exe),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn install_portable_update(app: AppHandle, version: String) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, version);
        return Err("La actualización portable in-place solo aplica a Windows.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("No se pudo localizar el ejecutable actual: {e}"))?;

        if !detect_portable_mode_for_exe(&current_exe) {
            return Err("La aplicación no se está ejecutando en modo portable.".to_string());
        }

        let clean_version = sanitize_version(&version)?;
        let url = portable_asset_url(&clean_version)?;
        let tmp_path = temp_download_path(&current_exe, &clean_version)?;

        let client = reqwest::Client::builder()
            .user_agent("PyroStudio-Portable-Updater")
            .build()
            .map_err(|e| format!("No se pudo inicializar el cliente HTTP: {e}"))?;

        // Fetch optional .sha256 checksum published alongside the portable binary.
        let expected_sha256 = match client.get(format!("{url}.sha256")).send().await {
            Ok(resp) if resp.status().is_success() => resp
                .text()
                .await
                .ok()
                .and_then(|body| parse_sha256_file(&body)),
            _ => None,
        };

        let mut response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Error al descargar la actualización portable: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "No se pudo descargar el ejecutable portable (HTTP {}).",
                response.status()
            ));
        }

        let total = response.content_length();
        let _ = app.emit(
            "portable-update-progress",
            PortableUpdateProgress {
                downloaded: 0,
                total,
            },
        );

        let mut file = File::create(&tmp_path).map_err(|e| {
            format!(
                "No se pudo escribir en la carpeta del ejecutable portable ({}): {e}",
                tmp_path.display()
            )
        })?;

        let mut hasher = Sha256::new();
        let mut downloaded: u64 = 0;

        let download_result: Result<(), String> = async {
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|e| format!("Error durante la descarga: {e}"))?
            {
                file.write_all(&chunk)
                    .map_err(|e| format!("Error al guardar la descarga: {e}"))?;
                hasher.update(&chunk);
                downloaded += chunk.len() as u64;
                let _ = app.emit(
                    "portable-update-progress",
                    PortableUpdateProgress { downloaded, total },
                );
            }
            file.flush()
                .map_err(|e| format!("Error al finalizar la escritura del archivo: {e}"))?;
            Ok(())
        }
        .await;

        drop(file);

        if let Err(err) = download_result {
            let _ = fs::remove_file(&tmp_path);
            return Err(err);
        }

        // Validate PE header ("MZ") and minimum binary size.
        if downloaded < MIN_PORTABLE_EXE_BYTES {
            let _ = fs::remove_file(&tmp_path);
            return Err(
                "El archivo descargado es demasiado pequeño y no parece un ejecutable válido."
                    .to_string(),
            );
        }

        let header_ok = fs::read(&tmp_path)
            .ok()
            .map(|bytes| bytes.starts_with(b"MZ"))
            .unwrap_or(false);
        if !header_ok {
            let _ = fs::remove_file(&tmp_path);
            return Err(
                "El archivo descargado no tiene una cabecera de ejecutable Windows válida."
                    .to_string(),
            );
        }

        if let Some(expected) = expected_sha256 {
            let actual = format!("{:x}", hasher.finalize());
            if actual != expected {
                let _ = fs::remove_file(&tmp_path);
                return Err("La verificación SHA-256 del ejecutable portable falló.".to_string());
            }
        }

        // Replace the running executable in-place:
        // Windows allows renaming a running .exe on the same volume.
        let old_path = old_backup_path(&current_exe);
        if old_path.exists() {
            let _ = fs::remove_file(&old_path);
        }

        fs::rename(&current_exe, &old_path).map_err(|e| {
            let _ = fs::remove_file(&tmp_path);
            format!("No se pudo reemplazar el ejecutable portable actual: {e}")
        })?;

        if let Err(e) = fs::rename(&tmp_path, &current_exe) {
            // Rollback so the user is never left without their executable.
            let _ = fs::rename(&old_path, &current_exe);
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("No se pudo activar la nueva versión portable: {e}"));
        }

        // Relaunch the updated executable from the exact same path.
        if let Err(e) = std::process::Command::new(&current_exe).spawn() {
            return Err(format!(
                "El ejecutable se actualizó correctamente, pero no se pudo reiniciar automáticamente: {e}"
            ));
        }

        app.exit(0);
        Ok(())
    }
}

// Keep futures_util used cleanly across all targets if needed.
#[allow(dead_code)]
fn _ensure_stream_ext_import() {
    let _ = std::mem::size_of::<futures_util::stream::Empty<()>>();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_installed_when_uninstaller_present() {
        let exe = PathBuf::from(r"D:\Apps\Pyro Studio\pyro-studio.exe");
        assert!(!is_windows_portable_path(&exe, true, &[]));
    }

    #[test]
    fn detects_installed_inside_program_files_case_insensitive() {
        let dirs = vec![
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(r"C:\Program Files (x86)"),
            PathBuf::from(r"C:\Users\dev\AppData\Local\Programs"),
        ];
        assert!(!is_windows_portable_path(
            Path::new(r"c:\program files\Pyro Studio\pyro-studio.exe"),
            false,
            &dirs,
        ));
        assert!(!is_windows_portable_path(
            Path::new(r"C:\Users\dev\AppData\Local\Programs\Pyro Studio\pyro-studio.exe"),
            false,
            &dirs,
        ));
    }

    #[test]
    fn detects_portable_in_user_folder_without_uninstaller() {
        let dirs = vec![
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(r"C:\Users\dev\AppData\Local\Programs"),
        ];
        assert!(is_windows_portable_path(
            Path::new(r"D:\Portable\PyroStudio_v1.0.3_x64_portable.exe"),
            false,
            &dirs,
        ));
        assert!(is_windows_portable_path(
            Path::new(r"C:\Users\dev\Desktop\PyroStudio.exe"),
            false,
            &dirs,
        ));
    }

    #[test]
    fn builds_valid_portable_release_url() {
        assert_eq!(
            portable_asset_url("1.0.4").unwrap(),
            "https://github.com/cgarciagl/PyroStudio/releases/download/v1.0.4/PyroStudio_v1.0.4_x64_portable.exe"
        );
        assert_eq!(
            portable_asset_url("v1.0.4").unwrap(),
            "https://github.com/cgarciagl/PyroStudio/releases/download/v1.0.4/PyroStudio_v1.0.4_x64_portable.exe"
        );
        assert!(portable_asset_url("1.0.4/../../evil").is_err());
    }

    #[test]
    fn parses_sha256_checksum_file() {
        let hash = "a".repeat(64);
        let content = format!("{hash}  PyroStudio_v1.0.4_x64_portable.exe\n");
        assert_eq!(parse_sha256_file(&content), Some(hash));
        assert_eq!(parse_sha256_file("not-a-hash"), None);
    }
}
