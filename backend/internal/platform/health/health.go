package health

import (
	"context"
	"errors"
	"fmt"
)

type Checker interface {
	Ready(context.Context) error
}

type CheckFunc func(context.Context) error

func (fn CheckFunc) Ready(ctx context.Context) error {
	return fn(ctx)
}

type NamedCheck struct {
	Name    string
	Checker Checker
}

type Composite []NamedCheck

func (checks Composite) Ready(ctx context.Context) error {
	var result error
	for _, check := range checks {
		if err := check.Checker.Ready(ctx); err != nil {
			result = errors.Join(result, fmt.Errorf("%s: %w", check.Name, err))
		}
	}
	return result
}
