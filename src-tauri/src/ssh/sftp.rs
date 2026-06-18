use crate::ssh::handler::Client;
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Transfer progress callback: `(file, file_index, file_total, bytes, total)`.
/// `total` is 0 when the file size is unknown. Called per chunk — throttling is
/// the caller's responsibility.
pub type ProgressFn = Box<dyn FnMut(&str, usize, usize, u64, u64) + Send>;

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
/// russh 0.61: `channel_open_session()` -> `Channel`; `request_subsystem(want_reply, name)`
/// is by `&self`; `into_stream()` consumes the channel into an `AsyncRead + AsyncWrite`
/// stream that `russh_sftp::client::SftpSession::new` accepts (it requires
/// `'static`, which `ChannelStream` satisfies).
pub async fn open_sftp(conn: &Handle<Client>) -> Result<SftpSession, String> {
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
        out.push(SftpEntry {
            name,
            path: full,
            is_dir: meta.is_dir(),
            // russh-sftp `Metadata` (= `FileAttributes`): `size: Option<u64>`,
            // `mtime: Option<u32>`, `permissions: Option<u32>`.
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

pub async fn rmdir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    sftp.remove_dir(path)
        .await
        .map_err(|e| format!("SFTP rmdir failed: {}", e))
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
    // Cap the read itself so even without metadata we never allocate past the limit.
    f.take(MAX_TEXT_BYTES)
        .read_to_end(&mut buf)
        .await
        .map_err(|e| format!("SFTP read failed: {}", e))?;
    if buf.len() as u64 >= MAX_TEXT_BYTES {
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
    let total = tokio::fs::metadata(local).await.map(|m| m.len()).unwrap_or(0);
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
    conn: &Handle<Client>,
    remote: &str,
    local: &str,
    mut progress: Option<ProgressFn>,
) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    download_one(&sftp, remote, Path::new(local), 1, 1, &mut progress).await
}

pub async fn upload(
    conn: &Handle<Client>,
    remote: &str,
    local: &str,
    mut progress: Option<ProgressFn>,
) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    upload_one(&sftp, remote, Path::new(local), 1, 1, &mut progress).await
}

/// Recursively download `remote_dir` into `local_parent` (a `{remote dir
/// basename}` folder is created inside it). One SFTP session is reused for the
/// whole walk + transfer. Returns the number of files transferred.
pub async fn download_dir(
    conn: &Handle<Client>,
    remote_dir: &str,
    local_parent: &str,
    mut progress: Option<ProgressFn>,
) -> Result<usize, String> {
    let sftp = open_sftp(conn).await?;
    let remote_dir = remote_dir.trim_end_matches('/');
    let base_name = remote_dir.rsplit('/').next().unwrap_or(remote_dir);
    if base_name.is_empty() {
        return Err("Cannot download the filesystem root".into());
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
            let rpath = format!("{}/{}", rdir, name);
            if entry.metadata().is_dir() {
                stack.push((rpath, ldir.join(&name)));
            } else {
                files.push((rpath, ldir.join(&name)));
            }
        }
    }

    let total = files.len();
    for (i, (rpath, lpath)) in files.iter().enumerate() {
        download_one(&sftp, rpath, lpath, i + 1, total, &mut progress).await?;
    }
    Ok(total)
}

/// Recursively upload the local directory `local_dir` into `remote_parent`
/// (a `{local dir basename}` folder is created inside it). Returns the number
/// of files transferred.
pub async fn upload_dir(
    conn: &Handle<Client>,
    remote_parent: &str,
    local_dir: &str,
    mut progress: Option<ProgressFn>,
) -> Result<usize, String> {
    let sftp = open_sftp(conn).await?;
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
        upload_one(&sftp, rpath, lpath, i + 1, total, &mut progress).await?;
    }
    Ok(total)
}

pub async fn chmod(sftp: &SftpSession, path: &str, mode: u32) -> Result<(), String> {
    // russh-sftp 2.3: `metadata` returns `Metadata` (= `FileAttributes` with a
    // `permissions: Option<u32>` field); `set_metadata(path, Metadata)` writes it back.
    let mut meta = sftp
        .metadata(path)
        .await
        .map_err(|e| format!("SFTP stat failed: {}", e))?;
    meta.permissions = Some(mode);
    sftp.set_metadata(path, meta)
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
