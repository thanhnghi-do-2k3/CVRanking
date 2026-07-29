package migrations

import "embed"

// Files contains the immutable SQL migrations used by the migration binary.
//
//go:embed *.sql
var Files embed.FS
