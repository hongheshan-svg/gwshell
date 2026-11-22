use crate::ssh::handler::Client;
use crate::ssh::params::ConnectParams;
use crate::ssh::transport::expand_tilde;
use russh::client::{AuthResult, Handle};
use russh::MethodKind;
use std::sync::Arc;

/// Authenticate `session` using the configured method, supporting SSH
/// `partial_success` multi-factor authentication chains (e.g. publickey/agent
/// followed by keyboard-interactive or password) as well as automatic fallback
/// from password to keyboard-interactive when a server (such as a PAM bastion)
/// disables plain password auth.
pub async fn authenticate(session: &mut Handle<Client>, p: &ConnectParams) -> Result<(), String> {
    let user = &p.username;

    // Reveal allowed methods (also required by some servers before any auth).
    let _ = session.authenticate_none(user.clone()).await;

    let mut result = match p.auth_method.as_str() {
        "publickey" => try_pubkey(session, p).await?,
        "agent" => try_agent(session, user).await?,
        "keyboardinteractive" => try_keyboard_interactive(session, p).await?,
        "none" => session
            .authenticate_none(user.clone())
            .await
            .map_err(|e| format!("None auth failed: {}", e))?,
        _ => {
            let pw = p.password.clone().unwrap_or_default();
            let res = session
                .authenticate_password(user.clone(), pw)
                .await
                .map_err(|e| format!("Password auth failed: {}", e))?;
            // PAM-backed servers and bastions often disable the `password`
            // method and require `keyboard-interactive` for the same password.
            if let AuthResult::Failure {
                ref remaining_methods,
                partial_success: false,
            } = res
            {
                if remaining_methods.contains(&MethodKind::KeyboardInteractive)
                    && !remaining_methods.contains(&MethodKind::Password)
                {
                    try_keyboard_interactive(session, p).await?
                } else {
                    res
                }
            } else {
                res
            }
        }
    };

    // Continue multi-factor chains when the server accepts the first factor
    // (`partial_success: true`) and requests an additional method.
    for _ in 0..3 {
        match result {
            AuthResult::Success => return Ok(()),
            AuthResult::Failure {
                ref remaining_methods,
                partial_success: true,
            } => {
                if remaining_methods.contains(&MethodKind::KeyboardInteractive)
                    && (p.totp_code.as_deref().is_some_and(|s| !s.is_empty())
                        || p.password.as_deref().is_some_and(|s| !s.is_empty()))
                {
                    result = try_keyboard_interactive(session, p).await?;
                } else if remaining_methods.contains(&MethodKind::Password)
                    && p.password.as_deref().is_some_and(|s| !s.is_empty())
                {
                    let pw = p.password.clone().unwrap_or_default();
                    result = session
                        .authenticate_password(user.clone(), pw)
                        .await
                        .map_err(|e| format!("Password MFA step failed: {}", e))?;
                } else {
                    return Err(
                        "Additional authentication factor required by server (partial success)"
                            .to_string(),
                    );
                }
            }
            AuthResult::Failure {
                partial_success: false,
                ..
            } => break,
        }
    }

    if result.success() {
        Ok(())
    } else {
        Err("Authentication failed".to_string())
    }
}

async fn try_pubkey(session: &mut Handle<Client>, p: &ConnectParams) -> Result<AuthResult, String> {
    let path = p
        .private_key_path
        .as_deref()
        .ok_or("Private key path is required")?;
    let key_path = expand_tilde(path);
    if !key_path.exists() {
        return Err(format!("SSH key file not found: {}", key_path.display()));
    }
    let key = russh::keys::load_secret_key(&key_path, p.password.as_deref())
        .map_err(|e| format!("Public key load failed ({}): {}", key_path.display(), e))?;
    let hash = session
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();
    session
        .authenticate_publickey(
            p.username.clone(),
            russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash),
        )
        .await
        .map_err(|e| format!("Public key auth failed: {}", e))
}

async fn try_agent(session: &mut Handle<Client>, user: &str) -> Result<AuthResult, String> {
    // Connecting to the agent is OS-specific: `connect_env` (via $SSH_AUTH_SOCK)
    // is `#[cfg(unix)]`-only in russh, while Windows exposes the OpenSSH agent's
    // named pipe and Pageant. Each yields a different transport type, so the
    // shared identity-iteration logic lives in the generic `auth_with_agent`.
    #[cfg(unix)]
    {
        let agent = russh::keys::agent::client::AgentClient::connect_env()
            .await
            .map_err(|e| format!("SSH agent unavailable: {}", e))?;
        auth_with_agent(session, user, agent).await
    }
    #[cfg(windows)]
    {
        use russh::keys::agent::client::AgentClient;
        // Prefer the OpenSSH for Windows agent (named pipe); fall back to Pageant.
        match AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
            Ok(agent) => auth_with_agent(session, user, agent).await,
            Err(_) => {
                let agent = AgentClient::connect_pageant()
                    .await
                    .map_err(|e| format!("SSH agent unavailable: {}", e))?;
                auth_with_agent(session, user, agent).await
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (session, user);
        Err("SSH agent is not supported on this platform".to_string())
    }
}

/// Try each identity offered by a connected agent until one authenticates or
/// achieves partial success (for MFA chains).
async fn auth_with_agent<S>(
    session: &mut Handle<Client>,
    user: &str,
    mut agent: russh::keys::agent::client::AgentClient<S>,
) -> Result<AuthResult, String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("Agent identities failed: {}", e))?;
    let rsa_hash = session
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();
    let mut last_failure = None;
    for id in identities {
        let public_key = id.public_key().into_owned();
        let hash_alg = if public_key.algorithm().is_rsa() {
            rsa_hash
        } else {
            None
        };
        if let Ok(res) = session
            .authenticate_publickey_with(user.to_string(), public_key, hash_alg, &mut agent)
            .await
        {
            match res {
                AuthResult::Success => return Ok(AuthResult::Success),
                AuthResult::Failure {
                    partial_success: true,
                    ..
                } => return Ok(res),
                other => last_failure = Some(other),
            }
        }
    }
    Ok(last_failure.unwrap_or_else(|| AuthResult::Failure {
        remaining_methods: russh::MethodSet::empty(),
        partial_success: false,
    }))
}

async fn try_keyboard_interactive(
    session: &mut Handle<Client>,
    p: &ConnectParams,
) -> Result<AuthResult, String> {
    use russh::client::KeyboardInteractiveAuthResponse as R;
    let mut resp = session
        .authenticate_keyboard_interactive_start(p.username.clone(), None)
        .await
        .map_err(|e| format!("Keyboard-interactive start failed: {}", e))?;
    // Cap the prompt rounds: a misconfigured or hostile server can send
    // InfoRequest indefinitely (russh notes "any number ... including empty"),
    // which would otherwise spin forever resubmitting the same answers.
    let mut rounds = 0u32;
    loop {
        match resp {
            R::Success => return Ok(AuthResult::Success),
            R::Failure {
                remaining_methods,
                partial_success,
            } => {
                return Ok(AuthResult::Failure {
                    remaining_methods,
                    partial_success,
                });
            }
            R::InfoRequest { prompts, .. } => {
                rounds += 1;
                if rounds > 10 {
                    return Err(
                        "Keyboard-interactive auth exceeded the prompt-round limit".to_string()
                    );
                }
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let answers: Vec<String> = prompts
                    .iter()
                    .enumerate()
                    .map(|(i, prompt)| {
                        let first_prompt_overall = rounds == 1 && i == 0;
                        match classify_prompt(&prompt.prompt, first_prompt_overall) {
                            PromptKind::Password => p.password.clone().unwrap_or_default(),
                            PromptKind::Otp => p
                                .totp_code
                                .as_deref()
                                .map(|v| crate::totp::answer_for(v, now))
                                .unwrap_or_default(),
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

#[derive(Debug, PartialEq)]
enum PromptKind {
    Password,
    Otp,
}

/// Decide what a keyboard-interactive prompt is asking for from its text.
/// Servers commonly ask in SEPARATE rounds ("Password:" then "Verification
/// code:"), each a prompt at index 0 — so a purely positional rule sent the
/// password again where the one-time code was expected. Unrecognized prompts
/// fall back to: very first prompt = password, anything later = OTP.
fn classify_prompt(prompt: &str, first_prompt_overall: bool) -> PromptKind {
    let text = prompt.to_lowercase();
    if ["password", "passphrase", "密码", "口令"]
        .iter()
        .any(|k| text.contains(k))
    {
        return PromptKind::Password;
    }
    if [
        "verification",
        "code",
        "otp",
        "token",
        "authenticator",
        "one-time",
        "2fa",
        "mfa",
        "totp",
        "验证码",
        "动态",
    ]
    .iter()
    .any(|k| text.contains(k))
    {
        return PromptKind::Otp;
    }
    if first_prompt_overall {
        PromptKind::Password
    } else {
        PromptKind::Otp
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_are_matched_by_text_across_rounds() {
        assert_eq!(classify_prompt("Password: ", true), PromptKind::Password);
        // Second round, index 0 again: must get the OTP, not the password.
        assert_eq!(
            classify_prompt("Verification code: ", false),
            PromptKind::Otp
        );
        assert_eq!(
            classify_prompt("Verification code: ", true),
            PromptKind::Otp
        );
        assert_eq!(classify_prompt("请输入验证码：", false), PromptKind::Otp);
        assert_eq!(
            classify_prompt("root@host's password:", false),
            PromptKind::Password
        );
        // RSA SecurID-style PASSCODE (PIN + token code) is a dynamic code.
        assert_eq!(
            classify_prompt("Enter PASSCODE for alice", true),
            PromptKind::Otp
        );
        // Unknown prompt text falls back to position.
        assert_eq!(classify_prompt("> ", true), PromptKind::Password);
        assert_eq!(classify_prompt("> ", false), PromptKind::Otp);
    }
}
