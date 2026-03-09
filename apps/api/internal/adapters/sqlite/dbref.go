package sqlite

import (
	"database/sql"
	"sync"
)

// DBRef is a thread-safe wrapper around *sql.DB that supports hot-swapping
// the underlying connection. This enables live restore from cloud backups
// without restarting the server.
type DBRef struct {
	mu      sync.RWMutex
	current *sql.DB
}

// NewDBRef wraps an existing *sql.DB.
func NewDBRef(db *sql.DB) *DBRef {
	return &DBRef{current: db}
}

// Get returns the current *sql.DB. Callers must not cache the returned
// pointer across request boundaries.
func (r *DBRef) Get() *sql.DB {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.current
}

// Swap atomically replaces the underlying *sql.DB and closes the old one.
func (r *DBRef) Swap(newDB *sql.DB) error {
	r.mu.Lock()
	old := r.current
	r.current = newDB
	r.mu.Unlock()
	return old.Close()
}
