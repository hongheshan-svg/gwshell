use super::types::{AgentEvidence, AgentPolicySettings};

pub fn detect_alerts(evidence: &[AgentEvidence], policy: &AgentPolicySettings) -> Vec<String> {
    let mut alerts = Vec::new();
    for item in evidence {
        alerts.extend(detect_disk_alerts(&item.body, policy.disk_alert_percent));
        alerts.extend(detect_memory_alerts(
            &item.body,
            policy.memory_alert_percent,
        ));
    }
    alerts.sort();
    alerts.dedup();
    alerts
}

fn detect_disk_alerts(body: &str, threshold: u8) -> Vec<String> {
    let mut alerts = Vec::new();
    let mut in_df_block = false;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            in_df_block = false;
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("filesystem") {
            // Only match block-space `df` tables (`Use%` or macOS `Capacity`),
            // never inode tables (`df -ihP`, which contain `iuse%`).
            in_df_block =
                !lower.contains("iuse%") && (lower.contains("use%") || lower.contains("capacity"));
            continue;
        }
        if !in_df_block {
            continue;
        }
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        // A valid `df -P` / `df -hP` row has at least 6 columns and ends with a mount path.
        if tokens.len() < 6 || !tokens.last().is_some_and(|mount| mount.starts_with('/')) {
            in_df_block = false;
            continue;
        }
        for token in &tokens[1..tokens.len() - 1] {
            let Some(percent) = token.strip_suffix('%') else {
                continue;
            };
            let Ok(value) = percent.parse::<u8>() else {
                continue;
            };
            if value >= threshold {
                alerts.push(format!("disk usage threshold crossed: {}", trimmed));
                break;
            }
        }
    }
    alerts
}

fn detect_memory_alerts(body: &str, threshold: u8) -> Vec<String> {
    let mut alerts = Vec::new();
    for line in body.lines() {
        let lower = line.to_ascii_lowercase();
        if !(lower.starts_with("mem:") || lower.contains("memory")) {
            continue;
        }
        let nums: Vec<u64> = line
            .split_whitespace()
            .filter_map(|part| part.parse::<u64>().ok())
            .collect();
        if nums.len() < 2 || nums[0] == 0 {
            continue;
        }
        let used_percent = nums[1].saturating_mul(100) / nums[0];
        if used_percent >= threshold as u64 {
            alerts.push(format!("memory usage threshold crossed: {}", line.trim()));
        }
    }
    alerts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_disk_and_memory_alerts_from_evidence() {
        let evidence = vec![AgentEvidence {
            id: "ev-1".into(),
            source: "ssh_exec".into(),
            label: "probe".into(),
            body: "Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/sda1 100 95 5 95% /\nMem: 1000 930 70\n".into(),
            created_at: 1,
        }];

        let alerts = detect_alerts(&evidence, &AgentPolicySettings::default());

        assert!(alerts.iter().any(|alert| alert.contains("disk usage")));
        assert!(alerts.iter().any(|alert| alert.contains("memory usage")));
    }

    #[test]
    fn ignores_percentages_outside_df_block_and_inode_tables() {
        let evidence = vec![AgentEvidence {
            id: "ev-2".into(),
            source: "ssh_exec".into(),
            label: "ps_and_inodes".into(),
            body: concat!(
                "USER PID %CPU %MEM COMMAND\n",
                "root 123 99% 40% /usr/bin/worker\n",
                "\n",
                "Filesystem Inodes IUsed IFree IUse% Mounted on\n",
                "/dev/sda1 1000 990 10 99% /\n",
                "\n",
                "Build progress: 100% done\n"
            )
            .into(),
            created_at: 2,
        }];

        let alerts = detect_alerts(&evidence, &AgentPolicySettings::default());
        assert!(alerts.is_empty(), "unexpected false alerts: {:?}", alerts);
    }
}
