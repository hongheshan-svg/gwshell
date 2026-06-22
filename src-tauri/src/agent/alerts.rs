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
    for line in body.lines() {
        for token in line.split_whitespace() {
            let Some(percent) = token.strip_suffix('%') else {
                continue;
            };
            let Ok(value) = percent.parse::<u8>() else {
                continue;
            };
            if value >= threshold {
                alerts.push(format!("disk usage threshold crossed: {}", line.trim()));
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
}
