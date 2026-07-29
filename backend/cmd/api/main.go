package main

import (
	"os"

	"github.com/talentrank/talentrank/backend/internal/platform/app"
)

func main() {
	os.Exit(app.RunAPI())
}
