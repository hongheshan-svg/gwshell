import type { SessionConfig } from '../types';
import { getTempPassword } from './tempSecrets';

/** Build the IPC payload for `ssh_connect` from a `SessionConfig` and terminal dimensions. */
export function buildSshConnectParams(
  sessionId: string,
  sess: SessionConfig | undefined,
  rows: number,
  cols: number,
) {
  return {
    sessionId,
    host: sess?.host ?? '',
    port: sess?.port ?? 22,
    username: sess?.username ?? 'root',
    password: (sess?._temporary ? getTempPassword(sess.id) : undefined) ?? sess?.password ?? null,
    privateKeyPath: sess?.private_key_path ?? null,
    authMethod: sess?.auth_method ?? 'password',
    totpCode: sess?.totp_code ?? null,
    jumpHost: sess?.jump_host ?? null,
    jumpPort: sess?.jump_port ?? 22,
    jumpUsername: sess?.jump_username ?? null,
    jumpPassword: sess?.jump_password ?? null,
    jumpPrivateKeyPath: sess?.jump_private_key_path ?? null,
    proxyType: sess?.proxy_type ?? null,
    proxyHost: sess?.proxy_host ?? null,
    proxyPort: sess?.proxy_port ?? 1080,
    proxyUsername: sess?.proxy_username ?? null,
    proxyPassword: sess?.proxy_password ?? null,
    connectionTimeout: sess?.connection_timeout ?? 30,
    idleDisconnectMinutes: sess?.idle_disconnect_minutes ?? null,
    agentForward: sess?.agent_forward ?? false,
    compression: sess?.compression ?? false,
    envVars: sess?.env_vars ?? null,
    keepaliveInterval:
      sess?.keepalive_interval != null && String(sess.keepalive_interval).trim() !== ''
        ? Number(sess.keepalive_interval)
        : null,
    serverAliveCountMax:
      sess?.server_alive_count_max != null && String(sess.server_alive_count_max).trim() !== ''
        ? Number(sess.server_alive_count_max)
        : null,
    rows,
    cols,
  };
}

/** Build a `docker -H` host URI from a Docker `SessionConfig`, or `null` for default. */
export function buildDockerHost(
  sess: Pick<SessionConfig, 'docker_protocol' | 'docker_unix_path'> | undefined,
): string | null {
  const rawPath = (sess?.docker_unix_path ?? '').trim();
  if (!rawPath) return null;
  if (rawPath.includes('://')) return rawPath;
  const proto = (sess?.docker_protocol ?? 'unix').trim().toLowerCase() || 'unix';
  return `${proto}://${rawPath}`;
}
