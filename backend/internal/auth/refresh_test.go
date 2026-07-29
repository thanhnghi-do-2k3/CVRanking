package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRefreshReplayClassification(t *testing.T) {
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	expires := now.Add(time.Hour)
	if state := classifyRefresh(expires, nil, nil, now); state != refreshActive {
		t.Fatalf("active state = %v", state)
	}
	if state := classifyRefresh(now.Add(-time.Second), nil, nil, now); state != refreshExpired {
		t.Fatalf("expired state = %v", state)
	}
	replacedAt := now.Add(-refreshReuseGrace)
	replacement := uuid.New()
	if state := classifyRefresh(expires, &replacedAt, &replacement, now); state != refreshWithinGrace {
		t.Fatalf("grace state = %v", state)
	}
	replacedAt = now.Add(-refreshReuseGrace - time.Millisecond)
	if state := classifyRefresh(expires, &replacedAt, &replacement, now); state != refreshReused {
		t.Fatalf("reuse state = %v", state)
	}
}
