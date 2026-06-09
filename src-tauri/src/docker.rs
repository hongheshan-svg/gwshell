use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
}

/// Parse the tab-delimited output of
/// `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'`.
/// Tolerates blank lines and trailing whitespace; rows with fewer than 4 fields
/// are skipped. Extra tabs in a field are not expected from this format.
pub fn parse_docker_ps(out: &str) -> Vec<DockerContainer> {
    out.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let id = parts.next()?.trim().to_string();
            let name = parts.next()?.trim().to_string();
            let image = parts.next()?.trim().to_string();
            let status = parts.next().unwrap_or("").trim().to_string();
            if id.is_empty() {
                return None;
            }
            Some(DockerContainer { id, name, image, status })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rows_and_skips_blanks() {
        let out = "abc123\tweb\tnginx:latest\tUp 3 hours\n\n\
                   def456\tdb\tpostgres:16\tUp 2 days (healthy)\n";
        let got = parse_docker_ps(out);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], DockerContainer {
            id: "abc123".into(), name: "web".into(),
            image: "nginx:latest".into(), status: "Up 3 hours".into(),
        });
        assert_eq!(got[1].name, "db");
        assert_eq!(got[1].status, "Up 2 days (healthy)");
    }

    #[test]
    fn skips_malformed_and_empty_id() {
        let out = "onlytwo\tfields\n\t\t\t\nok\tn\ti\ts\n";
        let got = parse_docker_ps(out);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "ok");
    }
}
