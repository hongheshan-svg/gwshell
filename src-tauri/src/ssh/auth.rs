use crate::ssh_next::handler::Client;
use crate::ssh_next::params::ConnectParams;
use crate::ssh_next::transport::expand_tilde;
use russh::client::Handle;
use std::sync::Arc;

/// Authenticate `session` using the configured method, with graceful fallback.
/// Mirrors the auth method handling of the old ssh.rs but driven by russh.
pub async fn authenticate(session: &mut Handle<Client>, p: &ConnectParams) -> Result<(), String> {
    let user = &p.username;

    // Reveal allowed methods (also required by some servers before any auth).
    let _ = session.authenticate_none(user.clone()).await;

    let ok = match p.auth_method.as_str() {
        "publickey" => try_pubkey(session, p).await?,
        "agent" => try_agent(session, user).await?,
        "keyboardinteractive" => try_keyboard_interactive(session, p).await?,
        "none" => session
            .authenticate_none(user.clone())
            .await
            .map(|r| r.success())
            .unwrap_or(false),
        _ => {
            let pw = p.password.clone().unwrap_or_default();
            session
                .authenticate_password(user.clone(), pw)
                .await
                .map(|r| r.success())
                .map_err(|e| format!("Password auth failed: {}", e))?
        }
    };

    if ok {
        Ok(())
    } else {
        Err("Authentication failed".to_string())
    }
}

async fn try_pubkey(session: &mut Handle<Client>, p: &ConnectParams) -> Result<bool, String> {
    let path = p.private_key_path.as_deref().ok_or("Private key path is required")?;
    let key_path = expand_tilde(path);
    if !key_path.exists() {
        return Err(format!("SSH key file not found: {}", key_path.display()));
    }
    let key = russh::keys::load_secret_key(&key_path, p.password.as_deref())
        .map_err(|e| format!("Public key load failed ({}): {}", key_path.display(), e))?;
    let hash = session.best_supported_rsa_hash().await.ok().flatten().flatten();
    let res = session
        .authenticate_publickey(
            p.username.clone(),
            russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash),
        )
        .await
        .map_err(|e| format!("Public key auth failed: {}", e))?;
    Ok(res.success())
}

async fn try_agent(session: &mut Handle<Client>, user: &str) -> Result<bool, String> {
    // russh 0.61: connect to the agent, list identities, then call
    // authenticate_publickey_with for each public key until one succeeds. The
    // AgentClient itself acts as the Signer. request_identities returns
    // AgentIdentity values, so we extract the owned PublicKey for each.
    let mut agent = russh::keys::agent::client::AgentClient::connect_env()
        .await
        .map_err(|e| format!("SSH agent unavailable: {}", e))?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("Agent identities failed: {}", e))?;
    for id in identities {
        let public_key = id.public_key().into_owned();
        if let Ok(res) = session
            .authenticate_publickey_with(user.to_string(), public_key, None, &mut agent)
            .await
        {
            if res.success() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

async fn try_keyboard_interactive(
    session: &mut Handle<Client>,
    p: &ConnectParams,
) -> Result<bool, String> {
    use russh::client::KeyboardInteractiveAuthResponse as R;
    let mut resp = session
        .authenticate_keyboard_interactive_start(p.username.clone(), None)
        .await
        .map_err(|e| format!("Keyboard-interactive start failed: {}", e))?;
    loop {
        match resp {
            R::Success => return Ok(true),
            R::Failure { .. } => return Ok(false),
            R::InfoRequest { prompts, .. } => {
                // Auto-fill password for the first prompt, TOTP for any extra prompt.
                let answers: Vec<String> = prompts
                    .iter()
                    .enumerate()
                    .map(|(i, _)| {
                        if i == 0 {
                            p.password.clone().unwrap_or_default()
                        } else {
                            p.totp_code.clone().unwrap_or_default()
                        }
                    })
                    .collect();
                resp = session
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|e| format!("Keyboard-interactive response failed: {}", e))?;
            }
        }
    }
}
