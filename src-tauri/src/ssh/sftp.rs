use crate::ssh::handler::Client;
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Transfer progress callback: `(file, file_index, file_total, bytes, total)`.
/// `total` is 0 when the file size is unknown. Called per chunk — throttling is
/// the caller's responsibility.
pub type ProgressFn = Box<dyn FnMut(&str, usize, usize, u64, u64) + Send>;

/// How to treat a directory-entry name received from the remote server when
/// building local paths. A hostile SFTP server can return names containing
/// path separators (or NUL) that would let `Path::join` escape the chosen
/// download root.
#[derive(Debug, PartialEq)]
enum EntryName {
    /// Normal readdir noise ("." / ".." / empty) — ignore the entry.
    Skip,
    /// Would escape the download root — abort the whole transfer.
    Unsafe,
    /// Safe to join onto a local path.
    Ok,
}

fn classify_entry_name(name: &str) -> EntryName {
    if name.is_empty() || name == "." || name == ".." {
        EntryName::Skip
    } else if name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || !is_single_normal_component(name)
        || (cfg!(windows) && is_unsafe_windows_name(name))
    {
        EntryName::Unsafe
    } else {
        EntryName::Ok
    }
}

/// Whether a remote-supplied file name can be used verbatim as a single local
/// path component (no traversal, drive prefixes, or Windows device names).
pub fn is_safe_local_file_name(name: &str) -> bool {
    classify_entry_name(name) == EntryName::Ok
}

/// Whether `name`, parsed with the HOST platform's path rules, is exactly one
/// plain file-name component. Catches what separator checks alone miss — on
/// Windows `C:evil.dll` parses as a drive prefix + name, and `Path::join`
/// would then discard the download root entirely.
fn is_single_normal_component(name: &str) -> bool {
    use std::path::Component;
    let mut components = Path::new(name).components();
    matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    )
}

/// Windows-only hazards in an otherwise single-component name: `:` (drive
/// prefixes / NTFS alternate data streams), reserved device names (`CON`,
/// `NUL`, `COM1`, … with or without an extension), and trailing dots/spaces
/// (silently stripped by Win32, so the written name differs from the checked
/// one).
fn is_unsafe_windows_name(name: &str) -> bool {
    if name.contains(':') || name.ends_with('.') || name.ends_with(' ') {
        return true;
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or(name)
        .trim_end()
        .to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ((stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem.len() == 4
        && stem.as_bytes()[3].is_ascii_digit())
}

/// A single remote directory entry, in the exact shape the SFTP panel expects.
#[derive(Debug, Serialize, Clone)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
}

/// Open a fresh SFTP subsystem channel on an existing connection.
///
/// Bounded by a 15-second timeout so a host with a stalled or unsupported
/// SFTP subsystem cannot wedge the cached SFTP mutex forever.
pub async fn open_sftp(conn: &Handle<Client>) -> Result<SftpSession, String> {
    let work = async {
        let channel = conn
            .channel_open_session()
            .await
            .map_err(|e| format!("SFTP channel failed: {}", e))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("SFTP subsystem failed: {}", e))?;
        SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("SFTP init failed: {}", e))
    };
    tokio::time::timeout(std::time::Duration::from_secs(15), work)
        .await
        .map_err(|_| "SFTP initialization timed out".to_string())?
}

pub async fn list_dir(sftp: &SftpSession, path: &str) -> Result<Vec<SftpEntry>, String> {
    let mut out = Vec::new();
    let dir = sftp
        .read_dir(path)
        .await
        .map_err(|e| format!("SFTP readdir failed: {}", e))?;
    for entry in dir {
        let meta = entry.metadata();
        let name = entry.file_name();
        let full = format!("{}/{}", path.trim_end_matches('/'), name);
        // Resolve symlinks via `stat` (`metadata`) so links pointing to
        // directories open as directories rather than failing as downloads.
        let is_dir = if meta.is_symlink() {
            sftp.metadata(&full)
                .await
                .map(|m| m.is_dir())
                .unwrap_or(false)
        } else {
            meta.is_dir()
        };
        out.push(SftpEntry {
            name,
            path: full,
            is_dir,
            size: meta.size.unwrap_or(0),
            modified: meta.mtime.map(|t| t as u64),
            permissions: meta.permissions,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

pub async fn realpath(sftp: &SftpSession, path: &str) -> Result<String, String> {
    sftp.canonicalize(path)
        .await
        .map_err(|e| format!("SFTP realpath failed: {}", e))
}

pub async fn mkdir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    sftp.create_dir(path)
        .await
        .map_err(|e| format!("SFTP mkdir failed: {}", e))
}

/// Delete a remote directory. Tries a single `remove_dir` first; if the
/// directory is non-empty, walks it iteratively in post-order and removes
/// files/symlinks (never following symlinks!) before removing subdirectories.
pub async fn rmdir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Refusing to delete the filesystem root".into());
    }
    if sftp.remove_dir(trimmed).await.is_ok() {
        return Ok(());
    }
    rmdir_recursive(sftp, trimmed).await
}

async fn rmdir_recursive(sftp: &SftpSession, root: &str) -> Result<(), String> {
    // Verify the root itself isn't a symlink — if it is, unlink it instead of
    // recursing into whatever it points to.
    if let Ok(meta) = sftp.symlink_metadata(root).await {
        if meta.is_symlink() {
            return sftp
                .remove_file(root)
                .await
                .map_err(|e| format!("SFTP unlink {} failed: {}", root, e));
        }
    }

    let mut stack: Vec<(String, bool)> = vec![(root.to_string(), false)];
    let mut visited_dirs: usize = 0;
    const MAX_DIRS: usize = 10_000;

    while let Some((dir, expanded)) = stack.pop() {
        if expanded {
            sftp.remove_dir(&dir)
                .await
                .map_err(|e| format!("SFTP rmdir {} failed: {}", dir, e))?;
            continue;
        }
        visited_dirs += 1;
        if visited_dirs > MAX_DIRS {
            return Err(format!(
                "Aborted recursive delete after visiting {} directories",
                MAX_DIRS
            ));
        }
        stack.push((dir.clone(), true));

        let entries = sftp
            .read_dir(&dir)
            .await
            .map_err(|e| format!("SFTP readdir {} failed: {}", dir, e))?;
        for entry in entries {
            let name = entry.file_name();
            match classify_entry_name(&name) {
                EntryName::Skip => continue,
                EntryName::Unsafe => {
                    return Err(format!(
                        "SFTP server returned an unsafe entry name {:?} in {} — aborting delete",
                        name, dir
                    ));
                }
                EntryName::Ok => {}
            }
            let child = format!("{}/{}", dir, name);
            let meta = entry.metadata();
            // Never traverse symlinks during recursive delete.
            if meta.is_symlink() || !meta.is_dir() {
                sftp.remove_file(&child)
                    .await
                    .map_err(|e| format!("SFTP delete {} failed: {}", child, e))?;
            } else {
                stack.push((child, false));
            }
        }
    }
    Ok(())
}

pub async fn delete_file(sftp: &SftpSession, path: &str) -> Result<(), String> {
    sftp.remove_file(path)
        .await
        .map_err(|e| format!("SFTP delete failed: {}", e))
}

pub async fn rename(sftp: &SftpSession, old: &str, new: &str) -> Result<(), String> {
    sftp.rename(old, new)
        .await
        .map_err(|e| format!("SFTP rename failed: {}", e))
}

pub async fn read_text(sftp: &SftpSession, path: &str) -> Result<String, String> {
    use tokio::io::AsyncReadExt;

    // Guard against OOM: a multi-GB log file read via read_to_end would grow
    // `buf` without bound. Cap at 16 MiB — anything larger isn't meant to be
    // opened as in-app text and should be downloaded instead. Try metadata
    // first (cheap, avoids reading anything); fall back to a capped read.
    const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;
    if let Ok(meta) = sftp.metadata(path).await {
        if meta.len() > MAX_TEXT_BYTES {
            return Err(format!(
                "File is too large to read as text (exceeds {} MiB). Use download instead.",
                MAX_TEXT_BYTES / 1024 / 1024
            ));
        }
    }

    let f = sftp
        .open(path)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut buf = Vec::new();
    // Read up to MAX_TEXT_BYTES + 1 so files of exactly MAX_TEXT_BYTES succeed
    // while strictly larger files are rejected without unbounded allocation.
    f.take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut buf)
        .await
        .map_err(|e| format!("SFTP read failed: {}", e))?;
    if buf.len() as u64 > MAX_TEXT_BYTES {
        return Err(format!(
            "File is too large to read as text (exceeds {} MiB). Use download instead.",
            MAX_TEXT_BYTES / 1024 / 1024
        ));
    }
    String::from_utf8(buf).map_err(|_| "File is not valid UTF-8 text".into())
}

pub async fn write_text(sftp: &SftpSession, path: &str, content: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::AsyncWriteExt;
    let mut f = sftp
        .open_with_flags(
            path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| format!("SFTP create failed: {}", e))?;
    f.write_all(content.as_bytes())
        .await
        .map_err(|e| format!("SFTP write failed: {}", e))?;
    f.flush()
        .await
        .map_err(|e| format!("SFTP flush failed: {}", e))?;
    Ok(())
}

/// Download a single file on an already-open SFTP session, reporting progress.
async fn download_one(
    sftp: &SftpSession,
    remote: &str,
    local: &Path,
    file_index: usize,
    file_total: usize,
    progress: &mut Option<ProgressFn>,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let total = sftp
        .metadata(remote)
        .await
        .ok()
        .and_then(|m| m.size)
        .unwrap_or(0);
    let mut rf = sftp
        .open(remote)
        .await
        .map_err(|e| format!("SFTP open {} failed: {}", remote, e))?;
    let mut lf = tokio::fs::File::create(local)
        .await
        .map_err(|e| format!("Local create {} failed: {}", local.display(), e))?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    loop {
        let n = rf
            .read(&mut buf)
            .await
            .map_err(|e| format!("SFTP read failed: {}", e))?;
        if n == 0 {
            break;
        }
        lf.write_all(&buf[..n])
            .await
            .map_err(|e| format!("Local write failed: {}", e))?;
        done += n as u64;
        if let Some(p) = progress.as_mut() {
            p(remote, file_index, file_total, done, total);
        }
    }
    lf.flush()
        .await
        .map_err(|e| format!("Local flush failed: {}", e))?;
    Ok(())
}

/// Upload a single file on an already-open SFTP session, reporting progress.
async fn upload_one(
    sftp: &SftpSession,
    remote: &str,
    local: &Path,
    file_index: usize,
    file_total: usize,
    progress: &mut Option<ProgressFn>,
) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let total = tokio::fs::metadata(local)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let mut lf = tokio::fs::File::open(local)
        .await
        .map_err(|e| format!("Local read {} failed: {}", local.display(), e))?;
    let mut rf = sftp
        .open_with_flags(
            remote,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| format!("SFTP create {} failed: {}", remote, e))?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    loop {
        let n = lf
            .read(&mut buf)
            .await
            .map_err(|e| format!("Local read failed: {}", e))?;
        if n == 0 {
            break;
        }
        rf.write_all(&buf[..n])
            .await
            .map_err(|e| format!("SFTP write failed: {}", e))?;
        done += n as u64;
        if let Some(p) = progress.as_mut() {
            p(remote, file_index, file_total, done, total);
        }
    }
    rf.flush()
        .await
        .map_err(|e| format!("SFTP flush failed: {}", e))?;
    Ok(())
}

pub async fn download(
    sftp: &SftpSession,
    remote: &str,
    local: &str,
    mut progress: Option<ProgressFn>,
) -> Result<(), String> {
    download_one(sftp, remote, Path::new(local), 1, 1, &mut progress).await
}

pub async fn upload(
    sftp: &SftpSession,
    remote: &str,
    local: &str,
    mut progress: Option<ProgressFn>,
) -> Result<(), String> {
    upload_one(sftp, remote, Path::new(local), 1, 1, &mut progress).await
}

/// Recursively download `remote_dir` into `local_parent` (a `{remote dir
/// basename}` folder is created inside it). One SFTP session is reused for the
/// whole walk + transfer. Returns the number of files transferred.
pub async fn download_dir(
    sftp: &SftpSession,
    remote_dir: &str,
    local_parent: &str,
    mut progress: Option<ProgressFn>,
) -> Result<usize, String> {
    let remote_dir = remote_dir.trim_end_matches('/');
    let base_name = remote_dir.rsplit('/').next().unwrap_or(remote_dir);
    if base_name.is_empty() {
        return Err("Cannot download the filesystem root".into());
    }
    // The remote folder's own name becomes a local path component too.
    if classify_entry_name(base_name) != EntryName::Ok {
        return Err(format!(
            "Remote folder name {:?} cannot be used as a local folder name",
            base_name
        ));
    }
    let local_root = Path::new(local_parent).join(base_name);

    // Walk the remote tree first (creating local dirs as we go) so the
    // transfer loop knows the total file count for progress reporting.
    let mut stack: Vec<(String, PathBuf)> = vec![(remote_dir.to_string(), local_root)];
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    while let Some((rdir, ldir)) = stack.pop() {
        tokio::fs::create_dir_all(&ldir)
            .await
            .map_err(|e| format!("Local mkdir {} failed: {}", ldir.display(), e))?;
        let entries = sftp
            .read_dir(&rdir)
            .await
            .map_err(|e| format!("SFTP readdir {} failed: {}", rdir, e))?;
        for entry in entries {
            let name = entry.file_name();
            match classify_entry_name(&name) {
                EntryName::Skip => continue,
                EntryName::Unsafe => {
                    return Err(format!(
                        "SFTP server returned an unsafe entry name {:?} in {} — aborting download",
                        name, rdir
                    ));
                }
                EntryName::Ok => {}
            }
            let rpath = format!("{}/{}", rdir, name);
            let meta = entry.metadata();
            if meta.is_symlink() {
                // Skip symlinks during recursive download (mirrors upload_dir)
                // to prevent directory-cycle loops and unexpected target reads.
                continue;
            }
            if meta.is_dir() {
                stack.push((rpath, ldir.join(&name)));
            } else {
                files.push((rpath, ldir.join(&name)));
            }
        }
    }

    let total = files.len();
    for (i, (rpath, lpath)) in files.iter().enumerate() {
        download_one(sftp, rpath, lpath, i + 1, total, &mut progress).await?;
    }
    Ok(total)
}

/// Recursively upload the local directory `local_dir` into `remote_parent`
/// (a `{local dir basename}` folder is created inside it). Returns the number
/// of files transferred.
pub async fn upload_dir(
    sftp: &SftpSession,
    remote_parent: &str,
    local_dir: &str,
    mut progress: Option<ProgressFn>,
) -> Result<usize, String> {
    let local_root = PathBuf::from(local_dir);
    let base_name = local_root
        .file_name()
        .ok_or("Invalid local directory")?
        .to_string_lossy()
        .to_string();
    let remote_root = format!("{}/{}", remote_parent.trim_end_matches('/'), base_name);

    let mut stack: Vec<(PathBuf, String)> = vec![(local_root, remote_root)];
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    while let Some((ldir, rdir)) = stack.pop() {
        // Create the remote dir; tolerate it already existing.
        if sftp.create_dir(&rdir).await.is_err() {
            let exists_as_dir = sftp
                .metadata(&rdir)
                .await
                .map(|m| m.is_dir())
                .unwrap_or(false);
            if !exists_as_dir {
                return Err(format!("SFTP mkdir {} failed", rdir));
            }
        }
        let mut rd = tokio::fs::read_dir(&ldir)
            .await
            .map_err(|e| format!("Local readdir {} failed: {}", ldir.display(), e))?;
        while let Some(ent) = rd
            .next_entry()
            .await
            .map_err(|e| format!("Local readdir failed: {}", e))?
        {
            let ft = ent
                .file_type()
                .await
                .map_err(|e| format!("Local stat failed: {}", e))?;
            let name = ent.file_name().to_string_lossy().to_string();
            let rpath = format!("{}/{}", rdir, name);
            if ft.is_dir() {
                stack.push((ent.path(), rpath));
            } else if ft.is_file() {
                files.push((ent.path(), rpath));
            }
            // Symlinks are skipped: following them risks cycles, and SFTP has
            // no portable way to recreate them.
        }
    }

    let total = files.len();
    for (i, (lpath, rpath)) in files.iter().enumerate() {
        upload_one(sftp, rpath, lpath, i + 1, total, &mut progress).await?;
    }
    Ok(total)
}

pub async fn chmod(sftp: &SftpSession, path: &str, mode: u32) -> Result<(), String> {
    // Only send the permissions attribute — round-tripping uid/gid/size/times
    // via `set_metadata` fails with Permission denied on strict servers for
    // non-root users.
    let attrs = russh_sftp::protocol::FileAttributes {
        permissions: Some(mode),
        ..Default::default()
    };
    sftp.set_metadata(path, attrs)
        .await
        .map_err(|e| format!("SFTP chmod failed: {}", e))
}

pub async fn create_file(sftp: &SftpSession, path: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    let _ = sftp
        .open_with_flags(path, OpenFlags::CREATE | OpenFlags::WRITE)
        .await
        .map_err(|e| format!("SFTP create file failed: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_names_with_separators_are_unsafe() {
        // The path-traversal vectors a hostile server can put in readdir.
        for name in ["../evil", "..\\evil", "a/b", "a\\b", "x\0y", "/etc/passwd"] {
            assert_eq!(classify_entry_name(name), EntryName::Unsafe, "{:?}", name);
        }
    }

    #[test]
    fn dot_entries_are_skipped_not_fatal() {
        for name in [".", "..", ""] {
            assert_eq!(classify_entry_name(name), EntryName::Skip, "{:?}", name);
        }
    }

    #[test]
    #[cfg(windows)]
    fn windows_prefix_ads_and_device_names_are_unsafe() {
        for name in [
            "C:evil.dll",
            "file.txt:stream",
            "CON",
            "nul.txt",
            "COM1",
            "lpt9.log",
            "trail.",
            "trail ",
        ] {
            assert_eq!(classify_entry_name(name), EntryName::Unsafe, "{:?}", name);
        }
        for name in ["COM10", "console.log", "LPT", "a.con"] {
            assert_eq!(classify_entry_name(name), EntryName::Ok, "{:?}", name);
        }
    }

    #[test]
    fn windows_name_rules_are_correct_on_every_host() {
        // The Windows checks are exercised everywhere so they stay tested on
        // the Unix CI runners too (they only gate classification on Windows).
        for name in [
            "C:evil.dll",
            "f.txt:ads",
            "CON",
            "nul.txt",
            "COM1",
            "x.",
            "x ",
        ] {
            assert!(is_unsafe_windows_name(name), "{:?}", name);
        }
        for name in ["COM10", "console.log", "LPT", "a.con", "file.txt"] {
            assert!(!is_unsafe_windows_name(name), "{:?}", name);
        }
    }

    #[test]
    fn ordinary_names_are_ok() {
        for name in ["file.txt", "..config", "a.b", "資料", "with space"] {
            assert_eq!(classify_entry_name(name), EntryName::Ok, "{:?}", name);
        }
    }
}
