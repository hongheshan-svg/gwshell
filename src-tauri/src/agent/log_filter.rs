use super::types::AgentPolicySettings;

pub fn filter_log_chunk(chunk: &str, policy: &AgentPolicySettings) -> Option<String> {
    if !policy.log_filter_enabled {
        let trimmed = chunk.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }

    let keywords: Vec<String> = policy
        .log_interest_keywords
        .iter()
        .map(|keyword| keyword.trim().to_ascii_lowercase())
        .filter(|keyword| !keyword.is_empty())
        .collect();
    if keywords.is_empty() {
        return None;
    }

    let mut kept = Vec::new();
    let mut last_line = String::new();
    let mut repeated = 0usize;

    for raw_line in chunk.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if !keywords.iter().any(|keyword| lower.contains(keyword)) {
            continue;
        }

        if line == last_line {
            repeated += 1;
            continue;
        }
        if repeated > 0 {
            kept.push(format!("previous line repeated {} times", repeated));
            repeated = 0;
        }
        kept.push(line.to_string());
        last_line = line.to_string();
    }

    if repeated > 0 {
        kept.push(format!("previous line repeated {} times", repeated));
    }

    (!kept.is_empty()).then(|| kept.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_log_chunk_to_interesting_keywords_and_dedupes_repeats() {
        let policy = AgentPolicySettings::default();
        let filtered = filter_log_chunk(
            "info boot\nERROR failed upstream\nERROR failed upstream\nwarn slow request\n",
            &policy,
        )
        .unwrap();

        assert!(filtered.contains("ERROR failed upstream"));
        assert!(filtered.contains("previous line repeated 1 times"));
        assert!(filtered.contains("warn slow request"));
        assert!(!filtered.contains("info boot"));
    }

    #[test]
    fn disabled_filter_returns_trimmed_chunk() {
        let policy = AgentPolicySettings {
            log_filter_enabled: false,
            ..AgentPolicySettings::default()
        };

        assert_eq!(
            filter_log_chunk(" info boot \n", &policy).as_deref(),
            Some("info boot")
        );
    }
}
