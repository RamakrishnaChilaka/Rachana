mod menu;
mod security;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const LEGACY_APP_IDENTIFIER: &str = "com.tchen.excaliapp";
const PREFERENCES_FILE_NAME: &str = "preferences.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExcalidrawFile {
    pub name: String,
    pub path: String,
    pub modified: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileContent {
    pub content: String,
    pub content_hash: String,
    pub file_identity: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SaveFileResult {
    pub content_hash: String,
    pub file_identity: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub modified: bool,
    pub children: Option<Vec<FileTreeNode>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Preferences {
    pub last_directory: Option<String>,
    pub recent_directories: Vec<String>,
    pub theme: String,
    pub sidebar_visible: bool,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u16,
    #[serde(default = "default_true")]
    pub show_decorations: bool,
}

fn default_sidebar_width() -> u16 {
    248
}

fn default_true() -> bool {
    true
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            last_directory: None,
            recent_directories: Vec::new(),
            theme: "system".to_string(),
            sidebar_visible: true,
            sidebar_width: default_sidebar_width(),
            show_decorations: true,
        }
    }
}

fn migrate_legacy_preferences(app_data_dir: &Path) -> std::io::Result<bool> {
    let destination = app_data_dir.join(PREFERENCES_FILE_NAME);
    let Some(data_root) = app_data_dir.parent() else {
        return Ok(false);
    };
    let legacy_preferences = data_root
        .join(LEGACY_APP_IDENTIFIER)
        .join(PREFERENCES_FILE_NAME);
    if !legacy_preferences.is_file() {
        return Ok(false);
    }

    fs::create_dir_all(app_data_dir)?;
    let mut source = fs::File::open(legacy_preferences)?;
    let mut destination_file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(error) => return Err(error),
    };

    if let Err(error) =
        std::io::copy(&mut source, &mut destination_file).and_then(|_| destination_file.sync_all())
    {
        drop(destination_file);
        let _ = fs::remove_file(destination);
        return Err(error);
    }

    Ok(true)
}

pub struct AppState {
    pub current_directory: Mutex<Option<PathBuf>>,
    pub modified_files: Mutex<Vec<String>>,
    pub active_watcher: Mutex<Option<RecommendedWatcher>>,
    regular_save_operation: Mutex<()>,
    save_as_operation: Mutex<()>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_directory: Mutex::new(None),
            modified_files: Mutex::new(Vec::new()),
            active_watcher: Mutex::new(None),
            regular_save_operation: Mutex::new(()),
            save_as_operation: Mutex::new(()),
        }
    }
}

#[tauri::command]
async fn select_directory(app: AppHandle) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = mpsc::channel();

    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });

    match rx.recv() {
        Ok(Some(path)) => Ok(Some(path.to_string())),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn list_excalidraw_files(directory: String) -> Result<Vec<ExcalidrawFile>, String> {
    let path = Path::new(&directory);

    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }

    let mut files = Vec::new();
    collect_excalidraw_files_recursive(path, &mut files)?;
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[tauri::command]
async fn get_file_tree(directory: String) -> Result<Vec<FileTreeNode>, String> {
    let path = Path::new(&directory);

    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }

    let mut tree = Vec::new();
    build_file_tree(path, &mut tree)?;
    tree.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(tree)
}

fn collect_excalidraw_files_recursive(
    dir: &Path,
    files: &mut Vec<ExcalidrawFile>,
) -> Result<(), String> {
    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_hidden_path(&path) {
                    continue;
                }

                if path.is_file() {
                    if let Some(extension) = path.extension() {
                        if extension == "excalidraw" {
                            if let Some(file_name) = path.file_name() {
                                files.push(ExcalidrawFile {
                                    name: file_name.to_string_lossy().to_string(),
                                    path: path.to_string_lossy().to_string(),
                                    modified: false,
                                });
                            }
                        }
                    }
                } else if path.is_dir() {
                    collect_excalidraw_files_recursive(&path, files)?;
                }
            }
        }
        Err(e) => return Err(e.to_string()),
    }
    Ok(())
}

fn is_hidden_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

fn build_file_tree(dir: &Path, tree: &mut Vec<FileTreeNode>) -> Result<(), String> {
    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_hidden_path(&path) {
                    continue;
                }

                let name = path
                    .file_name()
                    .ok_or("Invalid file name")?
                    .to_string_lossy()
                    .to_string();

                if path.is_dir() {
                    let mut children = Vec::new();
                    build_file_tree(&path, &mut children)?;

                    children.sort_by(|a, b| match (a.is_directory, b.is_directory) {
                        (true, false) => std::cmp::Ordering::Less,
                        (false, true) => std::cmp::Ordering::Greater,
                        _ => a.name.cmp(&b.name),
                    });

                    tree.push(FileTreeNode {
                        name,
                        path: path.to_string_lossy().to_string(),
                        is_directory: true,
                        modified: false,
                        children: Some(children),
                    });
                } else if path.is_file() {
                    if let Some(extension) = path.extension() {
                        if extension == "excalidraw" {
                            tree.push(FileTreeNode {
                                name,
                                path: path.to_string_lossy().to_string(),
                                is_directory: false,
                                modified: false,
                                children: None,
                            });
                        }
                    }
                }
            }
        }
        Err(e) => return Err(e.to_string()),
    }
    Ok(())
}

#[tauri::command]
async fn read_file(file_path: String) -> Result<String, String> {
    Ok(read_excalidraw_file_with_hash(&file_path)?.content)
}

#[tauri::command]
async fn read_file_with_hash(file_path: String) -> Result<FileContent, String> {
    read_excalidraw_file_with_hash(&file_path)
}

#[tauri::command]
async fn hash_file_content(file_path: String) -> Result<String, String> {
    Ok(read_excalidraw_file_with_hash(&file_path)?.content_hash)
}

#[tauri::command]
async fn excalidraw_file_exists(file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    if !path.try_exists().map_err(|e| e.to_string())? {
        return Ok(false);
    }

    let validated_path = security::validate_path(path, None)?;
    security::validate_excalidraw_file(&validated_path)?;
    Ok(validated_path.is_file())
}

fn read_excalidraw_file_with_hash(file_path: &str) -> Result<FileContent, String> {
    read_excalidraw_file_with_hash_using(file_path, || {})
}

fn read_excalidraw_file_with_hash_using<F>(
    file_path: &str,
    before_verification: F,
) -> Result<FileContent, String>
where
    F: FnOnce(),
{
    let path = Path::new(file_path);
    let validated_path = security::validate_path(path, None)?;

    security::validate_excalidraw_file(&validated_path)?;
    let mut file = fs::File::open(&validated_path).map_err(|e| e.to_string())?;
    fs2::FileExt::try_lock_shared(&file)
        .map_err(|_| "The drawing is being written by another process".to_string())?;
    let opened_handle = same_file::Handle::from_file(file.try_clone().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let opened_identity = file_identity_from_file(&file)?;
    let content = read_locked_file(&mut file)?;
    before_verification();
    let verification_content = read_locked_file(&mut file)?;
    let current_handle =
        same_file::Handle::from_path(&validated_path).map_err(|e| e.to_string())?;
    if content != verification_content
        || opened_handle != current_handle
        || opened_identity != file_identity(&validated_path)?
    {
        return Err(
            "The drawing changed or was replaced while it was being read; retry the operation"
                .to_string(),
        );
    }

    security::validate_excalidraw_content(&content)?;

    Ok(FileContent {
        content_hash: blake3_hash(&content),
        file_identity: opened_identity,
        content,
    })
}

fn blake3_hash(content: &str) -> String {
    blake3::hash(content.as_bytes()).to_hex().to_string()
}

#[cfg(unix)]
fn metadata_identity(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;
    format!("unix:{}:{}", metadata.dev(), metadata.ino())
}

#[cfg(not(any(unix, windows)))]
fn metadata_identity(metadata: &fs::Metadata) -> String {
    format!("fallback:{}:{:?}", metadata.len(), metadata.modified().ok())
}

#[cfg(unix)]
fn file_identity_from_file(file: &fs::File) -> Result<String, String> {
    Ok(metadata_identity(
        &file.metadata().map_err(|e| e.to_string())?,
    ))
}

#[cfg(windows)]
fn file_identity_from_file(file: &fs::File) -> Result<String, String> {
    use std::mem::MaybeUninit;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    let mut information = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    let succeeded =
        unsafe { GetFileInformationByHandle(file.as_raw_handle(), information.as_mut_ptr()) };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let information = unsafe { information.assume_init() };
    let file_index = ((information.nFileIndexHigh as u64) << 32) | information.nFileIndexLow as u64;
    Ok(format!(
        "windows:{}:{}",
        information.dwVolumeSerialNumber, file_index
    ))
}

#[cfg(not(any(unix, windows)))]
fn file_identity_from_file(file: &fs::File) -> Result<String, String> {
    Ok(metadata_identity(
        &file.metadata().map_err(|e| e.to_string())?,
    ))
}

fn file_identity(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    file_identity_from_file(&file)
}

#[cfg(unix)]
fn permissions_match(first: &fs::Permissions, second: &fs::Permissions) -> bool {
    use std::os::unix::fs::PermissionsExt;
    first.mode() == second.mode()
}

#[cfg(not(unix))]
fn permissions_match(first: &fs::Permissions, second: &fs::Permissions) -> bool {
    first.readonly() == second.readonly()
}

#[cfg(unix)]
fn privileged_mode_can_be_restored(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;

    let mode = metadata.mode();
    if mode & 0o6000 == 0 {
        return true;
    }

    let effective_user = unsafe { libc::geteuid() };
    if effective_user == 0 {
        return true;
    }
    if metadata.uid() != effective_user {
        return false;
    }
    if mode & 0o2000 == 0 {
        return true;
    }

    let file_group = metadata.gid();
    if file_group == unsafe { libc::getegid() } {
        return true;
    }
    let group_count = unsafe { libc::getgroups(0, std::ptr::null_mut()) };
    if group_count <= 0 {
        return false;
    }
    let mut groups = vec![0; group_count as usize];
    let loaded_groups = unsafe { libc::getgroups(group_count, groups.as_mut_ptr()) };
    loaded_groups == group_count && groups.contains(&file_group)
}

#[cfg(not(unix))]
fn privileged_mode_can_be_restored(_metadata: &fs::Metadata) -> bool {
    true
}

#[cfg(windows)]
fn open_existing_for_write(path: &Path) -> Result<fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn open_existing_for_write(path: &Path) -> Result<fs::File, String> {
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())
}

fn open_locked_file(path: &Path) -> Result<fs::File, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.permissions().readonly() {
        return Err("The drawing is read-only and cannot be saved".to_string());
    }

    let file = open_existing_for_write(path)?;
    if file
        .metadata()
        .map_err(|e| e.to_string())?
        .permissions()
        .readonly()
    {
        return Err("The drawing is read-only and cannot be saved".to_string());
    }
    fs2::FileExt::try_lock_exclusive(&file)
        .map_err(|_| "The drawing is locked by another process".to_string())?;
    reject_unpreservable_security_metadata(&file)?;
    let opened_metadata = file.metadata().map_err(|e| e.to_string())?;
    if !privileged_mode_can_be_restored(&opened_metadata) {
        return Err(
            "The drawing's set-user-ID or set-group-ID mode cannot be safely preserved".to_string(),
        );
    }
    Ok(file)
}

#[cfg(target_os = "linux")]
fn is_unsupported_xattr_error(error: &std::io::Error) -> bool {
    let Some(code) = error.raw_os_error() else {
        return false;
    };
    code == libc::ENOTSUP || code == libc::EOPNOTSUPP
}

#[cfg(target_os = "linux")]
fn reject_unpreservable_security_metadata(file: &fs::File) -> Result<(), String> {
    use xattr::FileExt;

    match file.get_xattr("security.capability") {
        Ok(Some(_)) => Err(
            "The drawing has Linux security capabilities that cannot be safely preserved"
                .to_string(),
        ),
        Ok(None) => Ok(()),
        Err(error) if is_unsupported_xattr_error(&error) => Ok(()),
        Err(error) => Err(format!(
            "The drawing's security metadata could not be verified: {error}"
        )),
    }
}

#[cfg(not(target_os = "linux"))]
fn reject_unpreservable_security_metadata(_file: &fs::File) -> Result<(), String> {
    Ok(())
}

fn read_locked_file(file: &mut fs::File) -> Result<String, String> {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| e.to_string())?;
    Ok(content)
}

fn prepare_synced_content(path: &Path, content: &str) -> Result<tempfile::NamedTempFile, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Save destination has no parent directory".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary
        .write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    Ok(temporary)
}

fn copy_prepared_content(
    path: &Path,
    original: &mut fs::File,
    original_content: &str,
    temporary: &mut tempfile::NamedTempFile,
) -> Result<(), String> {
    let original_permissions = original
        .metadata()
        .map_err(|e| e.to_string())?
        .permissions();
    temporary
        .as_file_mut()
        .seek(SeekFrom::Start(0))
        .map_err(|e| e.to_string())?;

    let write_result = (|| -> Result<(), std::io::Error> {
        original.set_len(0)?;
        original.seek(SeekFrom::Start(0))?;
        std::io::copy(temporary.as_file_mut(), original)?;
        original.flush()?;
        let saved_permissions = original.metadata()?.permissions();
        if !permissions_match(&saved_permissions, &original_permissions) {
            original.set_permissions(original_permissions.clone())?;
        }
        if !permissions_match(&original.metadata()?.permissions(), &original_permissions) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "The drawing's complete permissions were not preserved",
            ));
        }
        original.sync_all()?;
        Ok(())
    })();
    if let Err(write_error) = write_result {
        return restore_after_failed_write(
            original,
            original_content,
            &original_permissions,
            write_error,
        );
    }

    match path.try_exists() {
        Ok(true) => {}
        Ok(false) => {
            let write_error = std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "The drawing was deleted while it was being saved",
            );
            return restore_after_failed_write(
                original,
                original_content,
                &original_permissions,
                write_error,
            );
        }
        Err(write_error) => {
            return restore_after_failed_write(
                original,
                original_content,
                &original_permissions,
                write_error,
            );
        }
    }
    Ok(())
}

fn restore_after_failed_write(
    original: &mut fs::File,
    original_content: &str,
    original_permissions: &fs::Permissions,
    write_error: std::io::Error,
) -> Result<(), String> {
    let restore_result = original
        .set_len(0)
        .and_then(|_| original.seek(SeekFrom::Start(0)).map(|_| ()))
        .and_then(|_| original.write_all(original_content.as_bytes()))
        .and_then(|_| {
            let restored_permissions = original.metadata()?.permissions();
            if !permissions_match(&restored_permissions, original_permissions) {
                original.set_permissions(original_permissions.clone())?;
            }
            if permissions_match(&original.metadata()?.permissions(), original_permissions) {
                Ok(())
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "The drawing's complete permissions could not be restored",
                ))
            }
        })
        .and_then(|_| original.sync_all());
    match restore_result {
        Ok(()) => Err(format!("Failed to save drawing: {write_error}")),
        Err(restore_error) => Err(format!(
            "Failed to save drawing ({write_error}) and restore its previous content ({restore_error})"
        )),
    }
}

fn execute_regular_save<F>(
    state: &AppState,
    file_path: &str,
    content: &str,
    expected_hash: &str,
    expected_identity: &str,
    before_commit: F,
) -> Result<SaveFileResult, String>
where
    F: FnOnce(),
{
    let _operation_claim = match state.regular_save_operation.try_lock() {
        Ok(claim) => claim,
        Err(std::sync::TryLockError::WouldBlock) => {
            return Err("Another regular save operation is already in progress".to_string());
        }
        Err(std::sync::TryLockError::Poisoned(_)) => {
            return Err("Regular save operation state is unavailable".to_string());
        }
    };

    // Validate path to prevent traversal attacks
    let path = Path::new(file_path);
    let validated_path = security::validate_path(path, None)?;

    // Validate it's an excalidraw file
    security::validate_excalidraw_file(&validated_path)?;

    let mut original = open_locked_file(&validated_path)?;
    let original_handle =
        same_file::Handle::from_file(original.try_clone().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let original_identity = file_identity_from_file(&original)?;
    if original_identity != expected_identity {
        return Err(
            "The drawing was replaced on disk since it was opened. Reload or save a copy before retrying."
                .to_string(),
        );
    }

    let disk_content = read_locked_file(&mut original)?;
    if blake3_hash(&disk_content) != expected_hash {
        return Err(
            "The drawing changed on disk since it was opened. Reload or save a copy before retrying."
                .to_string(),
        );
    }

    // Validate the content before saving
    security::validate_excalidraw_content(content)?;
    let mut temporary = prepare_synced_content(&validated_path, content)?;
    before_commit();

    if !validated_path.try_exists().map_err(|e| e.to_string())? {
        return Err("The drawing was deleted while it was being saved".to_string());
    }
    let final_handle = same_file::Handle::from_path(&validated_path).map_err(|e| e.to_string())?;
    let final_content = read_locked_file(&mut original)?;
    if final_handle != original_handle || file_identity(&validated_path)? != expected_identity {
        return Err(
            "The drawing was replaced on disk while it was being saved. The replacement was not overwritten."
                .to_string(),
        );
    }
    if blake3_hash(&final_content) != expected_hash {
        return Err(
            "The drawing changed on disk while it was being saved. The external changes were not overwritten."
                .to_string(),
        );
    }

    let rollback_permissions = original
        .metadata()
        .map_err(|e| e.to_string())?
        .permissions();
    copy_prepared_content(
        &validated_path,
        &mut original,
        &disk_content,
        &mut temporary,
    )?;
    let saved_identity = (|| -> Result<String, String> {
        let saved_handle =
            same_file::Handle::from_path(&validated_path).map_err(|e| e.to_string())?;
        if saved_handle != original_handle {
            return Err(
                "The drawing was replaced while the save completed. The replacement was not overwritten."
                    .to_string(),
            );
        }
        file_identity_from_file(&original)
    })();
    let saved_identity = match saved_identity {
        Ok(identity) => identity,
        Err(error) => {
            let restore_error = restore_after_failed_write(
                &mut original,
                &disk_content,
                &rollback_permissions,
                std::io::Error::other(error),
            )
            .unwrap_err();
            return Err(restore_error);
        }
    };

    Ok(SaveFileResult {
        content_hash: blake3_hash(content),
        file_identity: saved_identity,
    })
}

#[tauri::command]
async fn save_file(
    state: State<'_, AppState>,
    file_path: String,
    content: String,
    expected_hash: String,
    expected_identity: String,
) -> Result<SaveFileResult, String> {
    execute_regular_save(
        &state,
        &file_path,
        &content,
        &expected_hash,
        &expected_identity,
        || {},
    )
}

#[tauri::command]
async fn select_save_file_path(app: AppHandle) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = mpsc::channel();

    app.dialog()
        .file()
        .add_filter("Excalidraw", &["excalidraw"])
        .set_title("Save As")
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    match rx.recv() {
        Ok(Some(path)) => Ok(Some(path.to_string())),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn platform_paths_are_case_insensitive() -> bool {
    cfg!(any(target_os = "windows", target_os = "macos"))
}

fn conservative_path_key(path: &str, case_insensitive: bool) -> String {
    let mut key = path.replace('\\', "/");
    while key.ends_with('/') && key.len() > 1 {
        key.pop();
    }
    if case_insensitive {
        key = key.to_lowercase();
    }
    key
}

fn path_is_within_directory(path: &Path, directory: &Path, case_insensitive: bool) -> bool {
    let path_key = conservative_path_key(&path.to_string_lossy(), case_insensitive);
    let directory_key = conservative_path_key(&directory.to_string_lossy(), case_insensitive);
    if path_key == directory_key {
        return true;
    }
    let directory_prefix = if directory_key.ends_with('/') {
        directory_key
    } else {
        format!("{directory_key}/")
    };
    path_key.starts_with(&directory_prefix)
}

fn validated_save_destination(path: &Path) -> Result<PathBuf, String> {
    security::validate_excalidraw_file(path)?;
    if path.exists() {
        return security::validate_path(path, None);
    }

    let parent = path
        .parent()
        .ok_or_else(|| "Save destination has no parent directory".to_string())?;
    let validated_parent = security::validate_path(parent, None)?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "Save destination has no file name".to_string())?;
    Ok(validated_parent.join(file_name))
}

fn destination_identity(path: &Path) -> Result<(PathBuf, String), String> {
    let validated_path = validated_save_destination(path)?;
    let key = conservative_path_key(
        &validated_path.to_string_lossy(),
        platform_paths_are_case_insensitive(),
    );
    Ok((validated_path, key))
}

fn paths_share_filesystem_identity(
    first: &Path,
    first_key: &str,
    second: &Path,
) -> Result<bool, String> {
    if conservative_path_key(
        &first.to_string_lossy(),
        platform_paths_are_case_insensitive(),
    ) == conservative_path_key(
        &second.to_string_lossy(),
        platform_paths_are_case_insensitive(),
    ) {
        return Ok(true);
    }

    let first_exists = first.try_exists().map_err(|e| e.to_string())?;
    let second_exists = second.try_exists().map_err(|e| e.to_string())?;
    if first_exists && second_exists {
        return same_file::is_same_file(first, second).map_err(|e| e.to_string());
    }

    match destination_identity(second) {
        Ok((_, second_key)) => Ok(first_key == second_key),
        Err(_) => Ok(false),
    }
}

fn deletion_scope_matches(
    target_path: &Path,
    is_directory: bool,
    candidate_paths: &[String],
) -> Result<Vec<bool>, String> {
    let case_insensitive = platform_paths_are_case_insensitive();
    let lexical_matches = || {
        candidate_paths
            .iter()
            .map(|candidate| {
                let candidate_path = Path::new(candidate);
                if is_directory {
                    path_is_within_directory(candidate_path, target_path, case_insensitive)
                } else {
                    conservative_path_key(&candidate_path.to_string_lossy(), case_insensitive)
                        == conservative_path_key(&target_path.to_string_lossy(), case_insensitive)
                }
            })
            .collect::<Vec<_>>()
    };
    if !target_path
        .try_exists()
        .map_err(|error| error.to_string())?
    {
        return Ok(lexical_matches());
    }
    let validated_target = security::validate_path(target_path, None)?;

    candidate_paths
        .iter()
        .zip(lexical_matches())
        .map(|(candidate, lexical_match)| {
            let candidate_path = Path::new(candidate);
            if lexical_match {
                return Ok(true);
            }
            if !candidate_path
                .try_exists()
                .map_err(|error| error.to_string())?
            {
                return Ok(false);
            }

            let validated_candidate = security::validate_path(candidate_path, None)?;
            if is_directory {
                Ok(path_is_within_directory(
                    &validated_candidate,
                    &validated_target,
                    case_insensitive,
                ))
            } else {
                Ok(
                    conservative_path_key(&validated_candidate.to_string_lossy(), case_insensitive)
                        == conservative_path_key(
                            &validated_target.to_string_lossy(),
                            case_insensitive,
                        ),
                )
            }
        })
        .collect()
}

#[tauri::command]
async fn get_deletion_scope_matches(
    target_path: String,
    is_directory: bool,
    candidate_paths: Vec<String>,
) -> Result<Vec<bool>, String> {
    deletion_scope_matches(Path::new(&target_path), is_directory, &candidate_paths)
}

fn write_file_safely(path: &Path, content: &str) -> Result<SaveFileResult, String> {
    write_file_safely_using(path, content, || {}, || {})
}

fn write_file_safely_using<F, G>(
    path: &Path,
    content: &str,
    before_new_destination_commit: F,
    after_new_destination_commit: G,
) -> Result<SaveFileResult, String>
where
    F: FnOnce(),
    G: FnOnce(),
{
    let mut temporary = prepare_synced_content(path, content)?;
    let saved_identity = if path.try_exists().map_err(|e| e.to_string())? {
        let mut original = open_locked_file(path)?;
        let original_handle =
            same_file::Handle::from_file(original.try_clone().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let original_content = read_locked_file(&mut original)?;
        let rollback_permissions = original
            .metadata()
            .map_err(|e| e.to_string())?
            .permissions();
        copy_prepared_content(path, &mut original, &original_content, &mut temporary)?;
        let saved_identity = (|| -> Result<String, String> {
            let saved_handle = same_file::Handle::from_path(path).map_err(|e| e.to_string())?;
            if saved_handle != original_handle {
                return Err(
                    "The save destination was replaced while it was being written".to_string(),
                );
            }
            file_identity_from_file(&original)
        })();
        match saved_identity {
            Ok(identity) => identity,
            Err(error) => {
                let restore_error = restore_after_failed_write(
                    &mut original,
                    &original_content,
                    &rollback_permissions,
                    std::io::Error::other(error),
                )
                .unwrap_err();
                return Err(restore_error);
            }
        }
    } else {
        before_new_destination_commit();
        let persisted = temporary
            .persist_noclobber(path)
            .map_err(|e| e.error.to_string())?;
        after_new_destination_commit();
        let persisted_handle =
            same_file::Handle::from_file(persisted.try_clone().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let path_handle = same_file::Handle::from_path(path).map_err(|e| e.to_string())?;
        if persisted_handle != path_handle {
            return Err(
                "The new save destination was replaced before the save completed".to_string(),
            );
        }
        file_identity_from_file(&persisted)?
    };

    Ok(SaveFileResult {
        content_hash: blake3_hash(content),
        file_identity: saved_identity,
    })
}

fn execute_save_file_as<F>(
    state: &AppState,
    file_path: &str,
    content: &str,
    open_paths: &[String],
    source_path: &str,
    is_recovery: bool,
    forbidden_directory: Option<&str>,
    after_claim: F,
) -> Result<SaveFileResult, String>
where
    F: FnOnce(),
{
    let _operation_claim = match state.save_as_operation.try_lock() {
        Ok(claim) => claim,
        Err(std::sync::TryLockError::WouldBlock) => {
            return Err("Another Save As operation is already in progress".to_string());
        }
        Err(std::sync::TryLockError::Poisoned(_)) => {
            return Err("Save As operation state is unavailable".to_string());
        }
    };
    after_claim();

    let path = Path::new(file_path);
    security::validate_excalidraw_content(content)?;
    let (validated_path, destination_key) = destination_identity(path)?;
    let source = Path::new(source_path);

    if let Some(forbidden_directory) = forbidden_directory {
        let forbidden_directory = security::validate_path(Path::new(forbidden_directory), None)?;
        if path_is_within_directory(
            &validated_path,
            &forbidden_directory,
            platform_paths_are_case_insensitive(),
        ) {
            return Err(
                "The save destination must be outside the folder being deleted".to_string(),
            );
        }
    }

    if is_recovery && paths_share_filesystem_identity(&validated_path, &destination_key, source)? {
        return Err("A recovery copy must be saved to a different destination".to_string());
    }

    for open_path in open_paths {
        let open_path = PathBuf::from(open_path);
        if paths_share_filesystem_identity(&validated_path, &destination_key, &open_path)? {
            return Err("That save destination is already open".to_string());
        }
    }

    write_file_safely(&validated_path, content)
}

#[tauri::command]
async fn save_file_as(
    state: State<'_, AppState>,
    file_path: String,
    content: String,
    open_paths: Vec<String>,
    source_path: String,
    is_recovery: bool,
    forbidden_directory: Option<String>,
) -> Result<SaveFileResult, String> {
    execute_save_file_as(
        &state,
        &file_path,
        &content,
        &open_paths,
        &source_path,
        is_recovery,
        forbidden_directory.as_deref(),
        || {},
    )
}

/// Creates a new folder in the specified directory
#[tauri::command]
async fn create_new_folder(directory: String, folder_name: String) -> Result<String, String> {
    // Validate and canonicalize the directory path
    let dir_path = Path::new(&directory);
    let validated_dir = security::validate_path(dir_path, None)?;

    if !validated_dir.is_dir() {
        return Err(format!("Path is not a directory: {}", directory));
    }

    // Safely join the folder name to the directory
    let mut path = security::safe_path_join(&validated_dir, &folder_name)?;

    // Check if folder already exists and find unique name
    if path.exists() {
        let mut counter = 1;
        let base_name = folder_name.trim_end_matches('/').to_string();

        loop {
            let new_name = format!("{}-{}", base_name, counter);
            path = security::safe_path_join(&validated_dir, &new_name)?;

            if !path.exists() {
                break;
            }
            counter += 1;

            if counter > 100 {
                return Err("Could not find unique folder name".to_string());
            }
        }
    }

    match fs::create_dir(&path) {
        Ok(_) => {
            // Verify the folder was created
            if !path.exists() {
                eprintln!("[create_new_folder] Folder doesn't exist after creation!");
                return Err("Folder creation verification failed".to_string());
            }

            // Verify it's actually a directory
            if !path.is_dir() {
                eprintln!("[create_new_folder] Path exists but is not a directory!");
                return Err("Created path is not a directory".to_string());
            }

            Ok(path.to_string_lossy().to_string())
        }
        Err(e) => {
            eprintln!("[create_new_folder] Failed to create folder: {}", e);
            Err(format!("Failed to create folder: {}", e))
        }
    }
}

#[tauri::command]
async fn create_new_file(directory: String, file_name: String) -> Result<String, String> {
    // Validate and canonicalize the directory path
    let dir_path = Path::new(&directory);
    let validated_dir = security::validate_path(dir_path, None)?;

    if !validated_dir.is_dir() {
        return Err(format!("Path is not a directory: {}", directory));
    }

    let final_file_name = if file_name.ends_with(".excalidraw") {
        file_name
    } else {
        format!("{}.excalidraw", file_name)
    };

    // Safely join the filename to the directory
    let mut path = security::safe_path_join(&validated_dir, &final_file_name)?;

    // Check if file already exists and suggest alternative
    if path.exists() {
        // Find a unique name by appending numbers
        let mut counter = 1;

        // Get the base name without extension
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Invalid file name")?
            .to_string(); // Convert to owned String

        // Handle the .excalidraw extension properly
        let base_stem = if stem.ends_with(".excalidraw") {
            stem.trim_end_matches(".excalidraw").to_string()
        } else {
            stem
        };

        loop {
            let new_name = format!("{}-{}.excalidraw", base_stem, counter);
            path = validated_dir.join(&new_name);

            if !path.exists() {
                break;
            }
            counter += 1;

            if counter > 100 {
                return Err("Could not find unique file name".to_string());
            }
        }
    }

    let default_content = serde_json::json!({
        "type": "excalidraw",
        "version": 2,
        "source": "Rachana",
        "elements": [],
        "appState": {
            "gridSize": null,
            "viewBackgroundColor": "#ffffff"
        },
        "files": {}
    });

    let content_str = serde_json::to_string_pretty(&default_content)
        .map_err(|e| format!("Failed to serialize content: {}", e))?;

    fs::write(&path, &content_str).map_err(|e| format!("Failed to create file: {}", e))?;

    if !path.exists() {
        return Err("File creation verification failed".to_string());
    }

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_preferences(app: AppHandle) -> Result<Preferences, String> {
    use tauri_plugin_store::StoreExt;

    let store = app.store("preferences.json").map_err(|e| e.to_string())?;

    let prefs = if let Some(value) = store.get("preferences") {
        // Try to deserialize, but ensure all fields have values
        match serde_json::from_value::<Preferences>(value.clone()) {
            Ok(mut p) => {
                // Ensure recent_directories is never None/null
                if p.recent_directories.is_empty() {
                    p.recent_directories = Vec::new();
                }
                p
            }
            Err(_) => Preferences::default(),
        }
    } else {
        Preferences::default()
    };

    Ok(prefs)
}

#[tauri::command]
async fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    // Validate the old path
    let old_path = Path::new(&old_path);
    let validated_old = security::validate_path(old_path, None)?;

    if !validated_old.exists() {
        return Err("File does not exist".to_string());
    }

    security::validate_excalidraw_file(&validated_old)?;

    let parent = validated_old.parent().ok_or("Invalid file path")?;

    // Safely create the new path
    let new_path = security::safe_path_join(parent, &new_name)?;

    // Ensure the new path also has .excalidraw extension
    let new_path = if new_path.extension() != Some(std::ffi::OsStr::new("excalidraw")) {
        new_path.with_extension("excalidraw")
    } else {
        new_path
    };

    if new_path.exists() && new_path != old_path {
        return Err("A file with that name already exists".to_string());
    }

    fs::rename(&validated_old, &new_path).map_err(|e| format!("Failed to rename file: {}", e))?;

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn rename_folder(old_path: String, new_name: String) -> Result<String, String> {
    let old_path = Path::new(&old_path);
    let validated_old = security::validate_path(old_path, None)?;

    if !validated_old.exists() {
        return Err("Folder does not exist".to_string());
    }

    if !validated_old.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    let parent = validated_old.parent().ok_or("Invalid folder path")?;
    let new_path = security::safe_path_join(parent, &new_name)?;

    if new_path.exists() && new_path != validated_old {
        return Err("A folder or file with that name already exists".to_string());
    }

    fs::rename(&validated_old, &new_path).map_err(|e| format!("Failed to rename folder: {}", e))?;

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_file(file_path: String) -> Result<(), String> {
    // Validate path to prevent traversal attacks
    let path = Path::new(&file_path);
    let validated_path = security::validate_path(path, None)?;

    if !validated_path.exists() {
        return Err("File does not exist".to_string());
    }

    // Ensure we're only deleting excalidraw files
    security::validate_excalidraw_file(&validated_path)?;

    fs::remove_file(&validated_path).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn delete_folder(folder_path: String) -> Result<(), String> {
    let path = Path::new(&folder_path);
    let validated_path = security::validate_path(path, None)?;

    if !validated_path.exists() {
        return Err("Folder does not exist".to_string());
    }

    if !validated_path.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    fs::remove_dir_all(&validated_path).map_err(|e| format!("Failed to delete folder: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn save_preferences(app: AppHandle, preferences: Preferences) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app.store("preferences.json").map_err(|e| e.to_string())?;

    store.set("preferences", serde_json::to_value(&preferences).unwrap());
    store.save().map_err(|e| e.to_string())?;

    // Update recent directories menu
    let _ = menu::update_recent_directories_menu(&app, preferences.recent_directories.clone());

    Ok(())
}

#[tauri::command]
#[cfg(target_os = "macos")]
async fn set_menu_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    if visible {
        let menu = menu::create_menu(&app).map_err(|e| e.to_string())?;
        window.set_menu(menu).map_err(|e| e.to_string())?;
    } else {
        window.remove_menu().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
async fn set_menu_visible(_app: AppHandle, _visible: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn set_decorations(app: AppHandle, visible: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    window.set_decorations(visible).map_err(|e| e.to_string())?;
    if visible {
        let menu = menu::create_menu(&app).map_err(|e| e.to_string())?;
        window.set_menu(menu).map_err(|e| e.to_string())?;
    } else {
        window.remove_menu().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn force_close_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

type WatchEventReceiver = std::sync::mpsc::Receiver<notify::Result<Event>>;

fn retain_directory_watcher(state: &AppState, path: &Path) -> Result<WatchEventReceiver, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *state
        .active_watcher
        .lock()
        .map_err(|_| "Directory watcher state is unavailable".to_string())? = Some(watcher);
    *state
        .current_directory
        .lock()
        .map_err(|_| "Current directory state is unavailable".to_string())? =
        Some(path.to_path_buf());

    Ok(rx)
}

#[tauri::command]
async fn watch_directory(
    app: AppHandle,
    directory: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = PathBuf::from(&directory);
    let app_handle = app.clone();
    let rx = retain_directory_watcher(&state, &path)?;

    // Spawn a thread to handle file system events
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            match event {
                Ok(Event {
                    kind: EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_),
                    paths,
                    ..
                }) => {
                    for path in paths {
                        if let Some(extension) = path.extension() {
                            if extension == "excalidraw" {
                                let _ = app_handle.emit("file-system-change", &path);
                            }
                        }
                    }
                }
                Err(e) => eprintln!("Watch error: {:?}", e),
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_webkit_rendering_defaults(
    appimage_launch: bool,
    dmabuf_preference_configured: bool,
    compositing_preference_configured: bool,
) -> (bool, bool) {
    let apply_appimage_defaults =
        appimage_launch && !dmabuf_preference_configured && !compositing_preference_configured;

    (
        apply_appimage_defaults,
        !compositing_preference_configured
            && (dmabuf_preference_configured || apply_appimage_defaults),
    )
}

#[cfg(target_os = "linux")]
pub fn configure_linux_webkit_rendering_before_startup() {
    use std::os::unix::process::CommandExt;

    let (disable_dmabuf_renderer, force_compositing) = linux_webkit_rendering_defaults(
        std::env::var_os("APPIMAGE").is_some(),
        std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some(),
        std::env::var_os("WEBKIT_FORCE_COMPOSITING_MODE").is_some()
            || std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some(),
    );

    if disable_dmabuf_renderer || force_compositing {
        let executable = match std::env::current_exe() {
            Ok(executable) => executable,
            Err(error) => {
                eprintln!("Unable to prepare WebKit compositing: {error}");
                return;
            }
        };
        let mut command = std::process::Command::new(executable);
        command.args(std::env::args_os().skip(1));
        if disable_dmabuf_renderer {
            command.env("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if force_compositing {
            command.env("WEBKIT_FORCE_COMPOSITING_MODE", "1");
        }
        let error = command.exec();

        eprintln!("Unable to restart with configured WebKit rendering: {error}");
        // SAFETY: this runs at the start of main(), before Tauri creates worker threads.
        unsafe {
            if disable_dmabuf_renderer {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
            if force_compositing {
                std::env::set_var("WEBKIT_FORCE_COMPOSITING_MODE", "1");
            }
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn configure_linux_webkit_rendering_before_startup() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            match app.path().app_data_dir() {
                Ok(app_data_dir) => {
                    if let Err(error) = migrate_legacy_preferences(&app_data_dir) {
                        eprintln!("Unable to migrate legacy application preferences: {error}");
                    }
                }
                Err(error) => eprintln!("Unable to resolve the Rachana data directory: {error}"),
            }

            app.manage(AppState::default());

            #[cfg(target_os = "macos")]
            {
                let menu = menu::create_menu(app.handle())?;
                app.set_menu(menu)?;
                menu::setup_menu_event_handler(app.handle());
            }

            // Load preferences and update recent directories menu
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_store::StoreExt;
                if let Ok(store) = app_handle.store("preferences.json") {
                    if let Some(value) = store.get("preferences") {
                        if let Ok(prefs) = serde_json::from_value::<Preferences>(value.clone()) {
                            let _ = menu::update_recent_directories_menu(
                                &app_handle,
                                prefs.recent_directories,
                            );
                        }
                    }
                }
            });

            // Add window close handler
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Prevent default close
                    api.prevent_close();

                    // Emit event to frontend to check for unsaved changes
                    let _ = window_clone.emit("check-unsaved-before-close", ());
                }
            });
            window.show()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_directory,
            list_excalidraw_files,
            get_file_tree,
            read_file,
            read_file_with_hash,
            hash_file_content,
            excalidraw_file_exists,
            get_deletion_scope_matches,
            save_file,
            select_save_file_path,
            save_file_as,
            create_new_file,
            create_new_folder,
            rename_file,
            rename_folder,
            delete_file,
            delete_folder,
            get_preferences,
            save_preferences,
            watch_directory,
            set_menu_visible,
            set_decorations,
            force_close_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn retained_watcher_observes_events_after_setup_returns() {
        let directory = tempfile::tempdir().unwrap();
        let state = AppState::default();
        let receiver = retain_directory_watcher(&state, directory.path()).unwrap();
        assert!(state.active_watcher.lock().unwrap().is_some());

        let drawing_path = directory.path().join("watched.excalidraw");
        fs::write(&drawing_path, "{}").unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut observed = false;
        while Instant::now() < deadline {
            match receiver.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(event)) if event.paths.iter().any(|path| path == &drawing_path) => {
                    observed = true;
                    break;
                }
                Ok(_) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(error) => panic!("watch channel disconnected: {error}"),
            }
        }

        assert!(
            observed,
            "retained watcher did not observe the created drawing"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn classifies_only_unsupported_xattr_errors_as_absent_metadata() {
        assert!(is_unsupported_xattr_error(
            &std::io::Error::from_raw_os_error(libc::ENOTSUP)
        ));
        assert!(is_unsupported_xattr_error(
            &std::io::Error::from_raw_os_error(libc::EOPNOTSUPP)
        ));
        assert!(!is_unsupported_xattr_error(
            &std::io::Error::from_raw_os_error(libc::EACCES)
        ));
        assert!(!is_unsupported_xattr_error(
            &std::io::Error::from_raw_os_error(libc::EIO)
        ));
        assert!(!is_unsupported_xattr_error(&std::io::Error::other(
            "missing raw OS error"
        )));
    }

    #[test]
    fn conservative_keys_handle_windows_and_macos_case_rules() {
        assert_eq!(
            conservative_path_key(r"C:\Drawings\Plan.excalidraw", true),
            conservative_path_key("c:/drawings/PLAN.excalidraw", true)
        );
        assert_eq!(
            conservative_path_key("/Users/Mira/Plan.excalidraw", true),
            conservative_path_key("/users/mira/plan.excalidraw", true)
        );
        assert_eq!(
            conservative_path_key("/Users/Mira/\u{dc}bung.excalidraw", true),
            conservative_path_key("/users/mira/\u{fc}BUNG.excalidraw", true)
        );
        assert_ne!(
            conservative_path_key("/home/Mira/Plan.excalidraw", false),
            conservative_path_key("/home/mira/plan.excalidraw", false)
        );
        assert!(path_is_within_directory(
            Path::new(r"C:\DRAWINGS\Folder\Recovery.excalidraw"),
            Path::new(r"c:\drawings\folder"),
            true
        ));
        assert!(!path_is_within_directory(
            Path::new("/drawings/folder-copy/Recovery.excalidraw"),
            Path::new("/drawings/folder"),
            false
        ));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn configures_known_good_webkit_rendering_for_appimage_launches() {
        assert_eq!(
            linux_webkit_rendering_defaults(true, false, false),
            (true, true)
        );
        assert_eq!(
            linux_webkit_rendering_defaults(false, false, false),
            (false, false)
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn preserves_explicit_webkit_rendering_preferences() {
        assert_eq!(
            linux_webkit_rendering_defaults(true, true, false),
            (false, true)
        );
        assert_eq!(
            linux_webkit_rendering_defaults(true, false, true),
            (false, false)
        );
        assert_eq!(
            linux_webkit_rendering_defaults(false, true, false),
            (false, true)
        );
    }

    #[test]
    fn migrates_legacy_preferences_without_overwriting_rachana_state() {
        let root = tempfile::tempdir().unwrap();
        let legacy_dir = root.path().join(LEGACY_APP_IDENTIFIER);
        let rachana_dir = root.path().join("io.github.ramakrishnachilaka.rachana");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(
            legacy_dir.join(PREFERENCES_FILE_NAME),
            r#"{"preferences":{"theme":"dark"}}"#,
        )
        .unwrap();

        assert!(migrate_legacy_preferences(&rachana_dir).unwrap());
        assert_eq!(
            fs::read_to_string(rachana_dir.join(PREFERENCES_FILE_NAME)).unwrap(),
            r#"{"preferences":{"theme":"dark"}}"#
        );

        fs::write(
            rachana_dir.join(PREFERENCES_FILE_NAME),
            r#"{"preferences":{"theme":"light"}}"#,
        )
        .unwrap();
        assert!(!migrate_legacy_preferences(&rachana_dir).unwrap());
        assert_eq!(
            fs::read_to_string(rachana_dir.join(PREFERENCES_FILE_NAME)).unwrap(),
            r#"{"preferences":{"theme":"light"}}"#
        );
    }

    #[test]
    fn skips_preference_migration_when_legacy_state_is_missing() {
        let root = tempfile::tempdir().unwrap();
        let rachana_dir = root.path().join("io.github.ramakrishnachilaka.rachana");

        assert!(!migrate_legacy_preferences(&rachana_dir).unwrap());
        assert!(!rachana_dir.exists());
    }

    #[cfg(unix)]
    #[test]
    fn filesystem_identity_detects_symlink_aliases() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("original.excalidraw");
        let alias = directory.path().join("alias.excalidraw");
        fs::write(&original, "{}").unwrap();
        symlink(&original, &alias).unwrap();

        let (validated_alias, alias_key) = destination_identity(&alias).unwrap();
        assert!(paths_share_filesystem_identity(&validated_alias, &alias_key, &original).unwrap());
    }

    #[test]
    fn filesystem_identity_detects_hard_link_aliases() {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("original.excalidraw");
        let alias = directory.path().join("alias.excalidraw");
        fs::write(&original, "{}").unwrap();
        fs::hard_link(&original, &alias).unwrap();

        let (validated_alias, alias_key) = destination_identity(&alias).unwrap();
        assert!(paths_share_filesystem_identity(&validated_alias, &alias_key, &original).unwrap());
    }

    #[test]
    fn filesystem_identity_keeps_distinct_paths_separate() {
        let directory = tempfile::tempdir().unwrap();
        let first = directory.path().join("first.excalidraw");
        let second = directory.path().join("second.excalidraw");
        fs::write(&first, "{}").unwrap();
        fs::write(&second, "{}").unwrap();

        let (validated_first, first_key) = destination_identity(&first).unwrap();
        assert!(!paths_share_filesystem_identity(&validated_first, &first_key, &second).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn deletion_scope_finds_symlink_file_aliases_but_not_surviving_hard_links() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target.excalidraw");
        let symlink_alias = directory.path().join("symlink.excalidraw");
        let hard_link_alias = directory.path().join("hard-link.excalidraw");
        let distinct = directory.path().join("distinct.excalidraw");
        fs::write(&target, "{}").unwrap();
        fs::write(&distinct, "{}").unwrap();
        symlink(&target, &symlink_alias).unwrap();
        fs::hard_link(&target, &hard_link_alias).unwrap();

        let matches = deletion_scope_matches(
            &target,
            false,
            &[
                symlink_alias.to_string_lossy().into_owned(),
                hard_link_alias.to_string_lossy().into_owned(),
                distinct.to_string_lossy().into_owned(),
            ],
        )
        .unwrap();

        assert_eq!(matches, vec![true, false, false]);
    }

    #[cfg(unix)]
    #[test]
    fn deletion_scope_finds_folder_symlink_descendants_but_not_surviving_hard_links() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let target_folder = directory.path().join("folder");
        let folder_alias = directory.path().join("folder-alias");
        let nested = target_folder.join("nested.excalidraw");
        let hard_link_outside = directory.path().join("surviving.excalidraw");
        fs::create_dir(&target_folder).unwrap();
        fs::write(&nested, "{}").unwrap();
        symlink(&target_folder, &folder_alias).unwrap();
        fs::hard_link(&nested, &hard_link_outside).unwrap();

        let matches = deletion_scope_matches(
            &target_folder,
            true,
            &[
                folder_alias
                    .join("nested.excalidraw")
                    .to_string_lossy()
                    .into_owned(),
                hard_link_outside.to_string_lossy().into_owned(),
            ],
        )
        .unwrap();

        assert_eq!(matches, vec![true, false]);
    }

    fn drawing_content(id: &str) -> String {
        format!(r#"{{"type":"excalidraw","version":2,"elements":[{{"id":"{id}"}}]}}"#)
    }

    #[test]
    fn save_as_rejects_a_destination_within_a_folder_being_deleted() {
        let directory = tempfile::tempdir().unwrap();
        let deleted_folder = directory.path().join("deleted");
        fs::create_dir(&deleted_folder).unwrap();
        let destination = deleted_folder.join("recovery.excalidraw");

        let error = execute_save_file_as(
            &AppState::default(),
            destination.to_str().unwrap(),
            &drawing_content("recovery"),
            &[],
            "/source.excalidraw",
            true,
            Some(deleted_folder.to_str().unwrap()),
            || {},
        )
        .unwrap_err();

        assert_eq!(
            error,
            "The save destination must be outside the folder being deleted"
        );
        assert!(!destination.exists());
    }

    #[cfg(unix)]
    #[test]
    fn save_as_rejects_a_symlinked_destination_within_a_folder_being_deleted() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let deleted_folder = directory.path().join("deleted");
        let alias = directory.path().join("alias");
        fs::create_dir(&deleted_folder).unwrap();
        symlink(&deleted_folder, &alias).unwrap();
        let destination = alias.join("recovery.excalidraw");

        let error = execute_save_file_as(
            &AppState::default(),
            destination.to_str().unwrap(),
            &drawing_content("recovery"),
            &[],
            "/source.excalidraw",
            true,
            Some(deleted_folder.to_str().unwrap()),
            || {},
        )
        .unwrap_err();

        assert_eq!(
            error,
            "The save destination must be outside the folder being deleted"
        );
        assert!(!destination.exists());
    }

    #[cfg(unix)]
    #[test]
    fn file_read_rejects_a_replacement_between_content_and_identity_checks() {
        let directory = tempfile::tempdir().unwrap();
        let drawing = directory.path().join("read-snapshot.excalidraw");
        let detached = directory.path().join("read-snapshot-detached.excalidraw");
        let opened_content = drawing_content("opened");
        let replacement_content = drawing_content("replacement");
        fs::write(&drawing, &opened_content).unwrap();

        let error = read_excalidraw_file_with_hash_using(drawing.to_str().unwrap(), || {
            fs::rename(&drawing, &detached).unwrap();
            fs::write(&drawing, &replacement_content).unwrap();
        })
        .unwrap_err();

        assert!(error.contains("changed or was replaced while it was being read"));
        assert_eq!(fs::read_to_string(&drawing).unwrap(), replacement_content);
    }

    #[test]
    fn regular_save_rejects_an_external_disk_change() {
        let directory = tempfile::tempdir().unwrap();
        let drawing = directory.path().join("conflict.excalidraw");
        let opened_content = drawing_content("opened");
        let external_content = drawing_content("external");
        fs::write(&drawing, &opened_content).unwrap();
        let opened_hash = blake3_hash(&opened_content);
        let opened_identity = file_identity(&drawing).unwrap();
        fs::write(&drawing, &external_content).unwrap();

        let error = execute_regular_save(
            &AppState::default(),
            drawing.to_str().unwrap(),
            &drawing_content("local"),
            &opened_hash,
            &opened_identity,
            || {},
        )
        .unwrap_err();

        assert!(error.contains("changed on disk"));
        assert_eq!(fs::read_to_string(&drawing).unwrap(), external_content);
    }

    #[test]
    fn regular_save_does_not_overwrite_a_change_before_commit() {
        let directory = tempfile::tempdir().unwrap();
        let drawing = directory.path().join("changed-before-commit.excalidraw");
        let opened_content = drawing_content("opened");
        let external_content = drawing_content("external");
        fs::write(&drawing, &opened_content).unwrap();

        let error = execute_regular_save(
            &AppState::default(),
            drawing.to_str().unwrap(),
            &drawing_content("local"),
            &blake3_hash(&opened_content),
            &file_identity(&drawing).unwrap(),
            || fs::write(&drawing, &external_content).unwrap(),
        )
        .unwrap_err();

        assert!(error.contains("changed on disk while it was being saved"));
        assert_eq!(fs::read_to_string(&drawing).unwrap(), external_content);
    }

    #[test]
    fn regular_save_does_not_recreate_a_deletion_before_commit() {
        let directory = tempfile::tempdir().unwrap();
        let drawing = directory.path().join("deleted-before-commit.excalidraw");
        let opened_content = drawing_content("opened");
        fs::write(&drawing, &opened_content).unwrap();

        let error = execute_regular_save(
            &AppState::default(),
            drawing.to_str().unwrap(),
            &drawing_content("local"),
            &blake3_hash(&opened_content),
            &file_identity(&drawing).unwrap(),
            || fs::remove_file(&drawing).unwrap(),
        )
        .unwrap_err();

        assert!(error.contains("deleted while it was being saved"));
        assert!(!drawing.exists());
    }

    #[test]
    fn regular_save_does_not_overwrite_a_same_content_replacement() {
        let directory = tempfile::tempdir().unwrap();
        let drawing = directory.path().join("replaced-before-commit.excalidraw");
        let detached = directory.path().join("detached-original.excalidraw");
        let opened_content = drawing_content("opened");
        fs::write(&drawing, &opened_content).unwrap();
        let opened_identity = file_identity(&drawing).unwrap();

        let error = execute_regular_save(
            &AppState::default(),
            drawing.to_str().unwrap(),
            &drawing_content("local"),
            &blake3_hash(&opened_content),
            &opened_identity,
            || {
                fs::rename(&drawing, &detached).unwrap();
                fs::write(&drawing, &opened_content).unwrap();
            },
        )
        .unwrap_err();

        assert!(error.contains("replaced on disk while it was being saved"));
        assert_eq!(fs::read_to_string(&drawing).unwrap(), opened_content);
        assert_eq!(fs::read_to_string(&detached).unwrap(), opened_content);
    }

    #[cfg(unix)]
    #[test]
    fn failed_post_write_validation_restores_the_original_handle() {
        let directory = tempfile::tempdir().unwrap();
        let drawing = directory.path().join("restore-after-write.excalidraw");
        let original_content = drawing_content("original");
        let replacement_content = drawing_content("replacement");
        fs::write(&drawing, &original_content).unwrap();
        let mut original = open_locked_file(&drawing).unwrap();
        let mut temporary = prepare_synced_content(&drawing, &replacement_content).unwrap();
        fs::remove_file(&drawing).unwrap();

        let error =
            copy_prepared_content(&drawing, &mut original, &original_content, &mut temporary)
                .unwrap_err();

        assert!(error.contains("deleted while it was being saved"));
        assert_eq!(read_locked_file(&mut original).unwrap(), original_content);
    }

    #[cfg(unix)]
    #[test]
    fn concurrent_regular_save_aliases_are_serialized_before_write() {
        use std::os::unix::fs::symlink;
        use std::sync::{Arc, mpsc};

        let directory = tempfile::tempdir().unwrap();
        let drawing = directory.path().join("regular-original.excalidraw");
        let symlink_alias = directory.path().join("regular-symlink.excalidraw");
        let hard_link_alias = directory.path().join("regular-hard-link.excalidraw");
        let opened_content = drawing_content("opened");
        let first_content = drawing_content("first");
        fs::write(&drawing, &opened_content).unwrap();
        symlink(&drawing, &symlink_alias).unwrap();
        fs::hard_link(&drawing, &hard_link_alias).unwrap();

        let state = Arc::new(AppState::default());
        let first_state = Arc::clone(&state);
        let first_path = symlink_alias.to_string_lossy().into_owned();
        let expected_hash = blake3_hash(&opened_content);
        let expected_identity = file_identity(&drawing).unwrap();
        let first_expected_hash = expected_hash.clone();
        let first_expected_identity = expected_identity.clone();
        let (prepared_tx, prepared_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first = std::thread::spawn(move || {
            execute_regular_save(
                &first_state,
                &first_path,
                &first_content,
                &first_expected_hash,
                &first_expected_identity,
                || {
                    prepared_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                },
            )
        });
        prepared_rx.recv_timeout(Duration::from_secs(5)).unwrap();

        for alias in [&drawing, &hard_link_alias] {
            let second = execute_regular_save(
                &state,
                alias.to_str().unwrap(),
                &drawing_content("second"),
                &expected_hash,
                &expected_identity,
                || {},
            );
            assert_eq!(
                second.unwrap_err(),
                "Another regular save operation is already in progress"
            );
            assert_eq!(fs::read_to_string(&drawing).unwrap(), opened_content);
        }

        release_tx.send(()).unwrap();
        assert!(first.join().unwrap().is_ok());
        assert_eq!(
            fs::read_to_string(&drawing).unwrap(),
            drawing_content("first")
        );
    }

    #[test]
    fn concurrent_save_file_as_commands_reject_the_loser_before_write() {
        use std::sync::{Arc, mpsc};

        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("concurrent.excalidraw");
        let destination_string = destination.to_string_lossy().into_owned();
        let first_content = drawing_content("first");
        let second_content = drawing_content("second");
        let state = Arc::new(AppState::default());
        let first_state = Arc::clone(&state);
        let first_destination = destination_string.clone();
        let first_expected_content = first_content.clone();
        let (claimed_tx, claimed_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();

        let first = std::thread::spawn(move || {
            execute_save_file_as(
                &first_state,
                &first_destination,
                &first_content,
                &[],
                "/source-first.excalidraw",
                false,
                None,
                || {
                    claimed_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                },
            )
        });
        claimed_rx.recv_timeout(Duration::from_secs(5)).unwrap();

        let second = execute_save_file_as(
            &state,
            &destination_string,
            &second_content,
            &[],
            "/source-second.excalidraw",
            false,
            None,
            || {},
        );
        let destination_existed_before_release = destination.exists();
        release_tx.send(()).unwrap();
        let first_result = first.join().unwrap();

        assert_eq!(
            second.unwrap_err(),
            "Another Save As operation is already in progress"
        );
        assert!(!destination_existed_before_release);
        assert!(first_result.is_ok());
        assert_eq!(
            fs::read_to_string(&destination).unwrap(),
            first_expected_content
        );
    }

    #[cfg(unix)]
    #[test]
    fn concurrent_alias_save_file_as_command_is_rejected_before_write() {
        use std::os::unix::fs::symlink;
        use std::sync::{Arc, mpsc};

        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("original.excalidraw");
        let alias = directory.path().join("alias.excalidraw");
        let initial_content = drawing_content("initial");
        fs::write(&destination, &initial_content).unwrap();
        symlink(&destination, &alias).unwrap();

        let destination_string = destination.to_string_lossy().into_owned();
        let alias_string = alias.to_string_lossy().into_owned();
        let first_content = drawing_content("first-alias");
        let first_expected_content = first_content.clone();
        let state = Arc::new(AppState::default());
        let first_state = Arc::clone(&state);
        let first_destination = destination_string.clone();
        let (claimed_tx, claimed_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();

        let first = std::thread::spawn(move || {
            execute_save_file_as(
                &first_state,
                &first_destination,
                &first_content,
                &[],
                "/source-first.excalidraw",
                false,
                None,
                || {
                    claimed_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                },
            )
        });
        claimed_rx.recv_timeout(Duration::from_secs(5)).unwrap();

        let second = execute_save_file_as(
            &state,
            &alias_string,
            &drawing_content("second-alias"),
            &[],
            "/source-second.excalidraw",
            false,
            None,
            || {},
        );
        let content_before_release = fs::read_to_string(&destination).unwrap();
        release_tx.send(()).unwrap();
        let first_result = first.join().unwrap();

        assert_eq!(
            second.unwrap_err(),
            "Another Save As operation is already in progress"
        );
        assert_eq!(content_before_release, initial_content);
        assert!(first_result.is_ok());
        assert_eq!(fs::read_to_string(&alias).unwrap(), first_expected_content);
    }

    #[test]
    fn failed_save_file_as_command_releases_the_entry_claim() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("retry.excalidraw");
        let destination_string = destination.to_string_lossy().into_owned();
        let state = AppState::default();

        let invalid = execute_save_file_as(
            &state,
            &destination_string,
            "not valid Excalidraw JSON",
            &[],
            "/source.excalidraw",
            false,
            None,
            || {},
        );
        assert!(invalid.is_err());

        let valid_content = drawing_content("retry");
        assert!(
            execute_save_file_as(
                &state,
                &destination_string,
                &valid_content,
                &[],
                "/source.excalidraw",
                false,
                None,
                || {},
            )
            .is_ok()
        );
        assert_eq!(fs::read_to_string(destination).unwrap(), valid_content);
    }

    #[test]
    fn new_save_as_does_not_clobber_a_concurrently_created_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("created-during-save-as.excalidraw");
        let external_content = drawing_content("external");

        let error = write_file_safely_using(
            &destination,
            &drawing_content("local"),
            || fs::write(&destination, &external_content).unwrap(),
            || {},
        )
        .unwrap_err();

        assert!(
            error.contains("exists"),
            "unexpected no-clobber error: {error}"
        );
        assert_eq!(fs::read_to_string(destination).unwrap(), external_content);
    }

    #[cfg(unix)]
    #[test]
    fn new_save_as_does_not_report_a_replaced_destination_as_saved() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("replaced-new-save-as.excalidraw");
        let detached = directory.path().join("detached-new-save-as.excalidraw");
        let replacement_content = drawing_content("external-replacement");

        let error = write_file_safely_using(
            &destination,
            &drawing_content("local"),
            || {},
            || {
                fs::rename(&destination, &detached).unwrap();
                fs::write(&destination, &replacement_content).unwrap();
            },
        )
        .unwrap_err();

        assert!(error.contains("replaced before the save completed"));
        assert_eq!(
            fs::read_to_string(destination).unwrap(),
            replacement_content
        );
    }

    #[cfg(unix)]
    #[test]
    fn existing_file_save_refuses_read_only_content() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("read-only.excalidraw");
        let original = drawing_content("original");
        fs::write(&destination, &original).unwrap();
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o444)).unwrap();

        let error = execute_regular_save(
            &AppState::default(),
            destination.to_str().unwrap(),
            &drawing_content("replacement"),
            &blake3_hash(&original),
            &file_identity(&destination).unwrap(),
            || {},
        )
        .unwrap_err();

        assert!(error.contains("read-only"));
        assert_eq!(fs::read_to_string(destination).unwrap(), original);
    }

    #[cfg(unix)]
    #[test]
    fn existing_file_save_preserves_identity_mode_and_xattrs() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("existing.excalidraw");
        let original = drawing_content("original");
        let replacement = drawing_content("replacement");
        fs::write(&destination, &original).unwrap();
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o6640)).unwrap();
        let original_identity = file_identity(&destination).unwrap();
        let attribute_name = "user.rachana-test";
        let attribute_value = b"retained";
        let xattr_supported = xattr::set(&destination, attribute_name, attribute_value).is_ok();

        execute_regular_save(
            &AppState::default(),
            destination.to_str().unwrap(),
            &replacement,
            &blake3_hash(&original),
            &original_identity,
            || {},
        )
        .unwrap();

        assert_eq!(fs::read_to_string(&destination).unwrap(), replacement);
        assert_eq!(file_identity(&destination).unwrap(), original_identity);
        assert_eq!(
            fs::metadata(&destination).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert_eq!(
            fs::metadata(&destination).unwrap().permissions().mode() & 0o6000,
            0o6000
        );
        if xattr_supported {
            assert_eq!(
                xattr::get(&destination, attribute_name).unwrap(),
                Some(attribute_value.to_vec())
            );
        }
    }
}
