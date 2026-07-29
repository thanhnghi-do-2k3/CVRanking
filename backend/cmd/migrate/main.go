package main

import (
	"database/sql"
	"log/slog"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/talentrank/talentrank/backend/migrations"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	command := os.Getenv("MIGRATION_COMMAND")
	if command == "" {
		command = "up"
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		slog.Error("open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		slog.Error("set migration dialect", "error", err)
		os.Exit(1)
	}
	if err := goose.Run(command, db, "."); err != nil {
		slog.Error("run migrations", "command", command, "error", err)
		os.Exit(1)
	}
}
