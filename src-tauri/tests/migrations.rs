//! Integration tests for the refinery migration framework.
//!
//! Two scenarios covered:
//! 1. `migrations_from_scratch_*` - a fresh in-memory database gets the full
//!    V001 schema from refinery and supports round-trip inserts.
//! 2. `bootstrap_detects_v0_5_5_database_and_marks_v001_applied` - an existing
//!    v0.5.5 database (created from `tests/fixtures/v0.5.5_baseline.sql`) is
//!    opened via `Database::new_from_path`; the bootstrap helper must detect
//!    it, mark V001 as applied in `refinery_schema_history`, and preserve all
//!    existing data without re-running V001 destructively.

use gwshell_lib::database::Database;
use rusqlite::Connection;

/// A fresh in-memory database must end up with every V001 table plus
/// refinery's `refinery_schema_history` bookkeeping table.
#[test]
fn migrations_from_scratch_create_full_schema() {
    let db = Database::new_in_memory_for_tests().unwrap();
    let conn = db.lock_conn_for_tests().unwrap();
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .unwrap();
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    drop(stmt);
    drop(conn);

    for expected in [
        "sessions",
        "groups",
        "app_settings",
        "agent_audit",
        "command_history",
        "snippets",
        "refinery_schema_history",
    ] {
        assert!(
            tables.contains(&expected.to_string()),
            "missing table: {} (have: {:?})",
            expected,
            tables
        );
    }
}

/// A fresh in-memory database must support round-trip inserts into the tables
/// V001 created, proving the schema is usable (not just present).
#[test]
fn migrations_from_scratch_allow_round_trip_insert() {
    let db = Database::new_in_memory_for_tests().unwrap();
    let conn = db.lock_conn_for_tests().unwrap();
    conn.execute(
        "INSERT INTO sessions (id, data) VALUES ('test-1', '{}')",
        [],
    )
    .unwrap();
    let data: String = conn
        .query_row("SELECT data FROM sessions WHERE id='test-1'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(data, "{}");
}

/// An existing v0.5.5 database (no `refinery_schema_history`, but `sessions`
/// exists with data) must be detected by the bootstrap helper. After opening
/// via `Database::new_from_path`:
/// - `refinery_schema_history` exists with a V001 row (refinery skipped V001)
/// - all pre-existing sample data survives (no destructive re-run of V001)
#[test]
fn bootstrap_detects_v0_5_5_database_and_marks_v001_applied() {
    let baseline = include_str!("fixtures/v0.5.5_baseline.sql");

    // 1. Build a v0.5.5 database in a temp file with sample data.
    let tmp = tempfile::NamedTempFile::new().unwrap();
    {
        let conn = Connection::open(tmp.path()).unwrap();
        conn.execute_batch(baseline).unwrap();
        // Verify sample data is present before migration.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "baseline fixture should seed 1 session");
    }

    // 2. Open via Database - should bootstrap + run migrations.
    let db = Database::new_from_path(tmp.path()).unwrap();
    let conn = db.lock_conn_for_tests().unwrap();

    // 3. refinery_schema_history now exists with V001 as the applied version.
    let v: i64 = conn
        .query_row(
            "SELECT MAX(version) FROM refinery_schema_history",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(v, 1, "V001 should be marked as applied after bootstrap");

    // 4. No data loss - the sample row from the baseline survived the upgrade.
    let data: String = conn
        .query_row("SELECT data FROM sessions WHERE id='test-1'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(data, "{\"name\":\"test\"}");

    // 5. The seeded command_history row also survives (proves V001 was NOT
    //    re-run, which would have failed or wiped the table).
    let cmd_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM command_history", [], |row| row.get(0))
        .unwrap();
    assert_eq!(cmd_count, 1, "command_history sample row should survive");
}
