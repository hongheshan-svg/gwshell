use crate::ssh::handler::Client;
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use serde::Serialize;

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
async fn open_sftp(conn: &Handle<Client>) -> Result<SftpSession, String> {
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

pub async fn list_dir(conn: &Handle<Client>, path: &str) -> Result<Vec<SftpEntry>, String> {
    let sftp = open_sftp(conn).await?;
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

pub async fn realpath(conn: &Handle<Client>, path: &str) -> Result<String, String> {
    let sftp = open_sftp(conn).await?;
    sftp.canonicalize(path)
        .await
        .map_err(|e| format!("SFTP realpath failed: {}", e))
}

pub async fn mkdir(conn: &Handle<Client>, path: &str) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    sftp.create_dir(path)
        .await
        .map_err(|e| format!("SFTP mkdir failed: {}", e))
}

pub async fn rmdir(conn: &Handle<Client>, path: &str) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    sftp.remove_dir(path)
        .await
        .map_err(|e| format!("SFTP rmdir failed: {}", e))
}

pub async fn delete_file(conn: &Handle<Client>, path: &str) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    sftp.remove_file(path)
        .await
        .map_err(|e| format!("SFTP delete failed: {}", e))
}

pub async fn rename(conn: &Handle<Client>, old: &str, new: &str) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    sftp.rename(old, new)
        .await
        .map_err(|e| format!("SFTP rename failed: {}", e))
}

pub async fn read_text(conn: &Handle<Client>, path: &str) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    let sftp = open_sftp(conn).await?;
    let mut f = sftp
        .open(path)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)
        .await
        .map_err(|e| format!("SFTP read failed: {}", e))?;
    String::from_utf8(buf).map_err(|_| "File is not valid UTF-8 text".into())
}

pub async fn write_text(conn: &Handle<Client>, path: &str, content: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::AsyncWriteExt;
    let sftp = open_sftp(conn).await?;
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

pub async fn download(conn: &Handle<Client>, remote: &str, local: &str) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let sftp = open_sftp(conn).await?;
    let mut rf = sftp
        .open(remote)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut lf = tokio::fs::File::create(local)
        .await
        .map_err(|e| format!("Local create failed: {}", e))?;
    let mut buf = vec![0u8; 256 * 1024];
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
    }
    lf.flush()
        .await
        .map_err(|e| format!("Local flush failed: {}", e))?;
    Ok(())
}

pub async fn upload(conn: &Handle<Client>, remote: &str, local: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let sftp = open_sftp(conn).await?;
    let mut lf = tokio::fs::File::open(local)
        .await
        .map_err(|e| format!("Local read failed: {}", e))?;
    let mut rf = sftp
        .open_with_flags(
            remote,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| format!("SFTP create failed: {}", e))?;
    let mut buf = vec![0u8; 256 * 1024];
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
    }
    rf.flush()
        .await
        .map_err(|e| format!("SFTP flush failed: {}", e))?;
    Ok(())
}

pub async fn chmod(conn: &Handle<Client>, path: &str, mode: u32) -> Result<(), String> {
    // russh-sftp 2.3: `metadata` returns `Metadata` (= `FileAttributes` with a
    // `permissions: Option<u32>` field); `set_metadata(path, Metadata)` writes it back.
    let sftp = open_sftp(conn).await?;
    let mut meta = sftp
        .metadata(path)
        .await
        .map_err(|e| format!("SFTP stat failed: {}", e))?;
    meta.permissions = Some(mode);
    sftp.set_metadata(path, meta)
        .await
        .map_err(|e| format!("SFTP chmod failed: {}", e))
}

pub async fn create_file(conn: &Handle<Client>, path: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    let sftp = open_sftp(conn).await?;
    let _ = sftp
        .open_with_flags(path, OpenFlags::CREATE | OpenFlags::WRITE)
        .await
        .map_err(|e| format!("SFTP create file failed: {}", e))?;
    Ok(())
}
