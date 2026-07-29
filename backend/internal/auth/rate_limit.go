package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

var rateLimitScript = redis.NewScript(`
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {current, ttl}
`)

type RateLimiter struct {
	client *redis.Client
}

func NewRateLimiter(client *redis.Client) *RateLimiter {
	return &RateLimiter{client: client}
}

func (limiter *RateLimiter) Allow(ctx context.Context, event, identity string, limit int, window time.Duration) (bool, time.Duration, error) {
	key := rateLimitKey(event, identity)
	result, err := rateLimitScript.Run(ctx, limiter.client, []string{key}, int(window.Seconds())).Slice()
	if err != nil {
		return false, 0, fmt.Errorf("rate limit: %w", err)
	}
	count, okCount := result[0].(int64)
	ttl, okTTL := result[1].(int64)
	if !okCount || !okTTL {
		return false, 0, errorsUnexpectedRateLimitResult()
	}
	retry := time.Duration(ttl) * time.Second
	if retry < time.Second {
		retry = window
	}
	return count <= int64(limit), retry, nil
}

func rateLimitKey(event, identity string) string {
	sum := sha256.Sum256([]byte(identity))
	return fmt.Sprintf("ratelimit:auth:%s:%s", event, hex.EncodeToString(sum[:12]))
}

func errorsUnexpectedRateLimitResult() error {
	return fmt.Errorf("rate limit returned an unexpected result")
}
