CREATE TABLE IF NOT EXISTS backup_config (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    provider        TEXT    NOT NULL DEFAULT '',
    bucket          TEXT    NOT NULL DEFAULT '',
    object_key      TEXT    NOT NULL DEFAULT 'mock-loom.db',
    s3_region       TEXT    NOT NULL DEFAULT 'us-east-1',
    sync_interval   TEXT    NOT NULL DEFAULT '0',
    restore_on_start INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
