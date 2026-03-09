package usecase

import (
	"errors"
	"strings"
)

// ValidationError carries semantic validation messages for API mapping.
type ValidationError struct {
	Cause    error
	Messages []string
}

// Error implements error.
func (e *ValidationError) Error() string {
	if e == nil {
		return ErrSemanticValidation.Error()
	}
	if len(e.Messages) == 0 {
		return ErrSemanticValidation.Error()
	}
	return strings.Join(e.Messages, "; ")
}

// Unwrap enables errors.Is checks against sentinel causes.
func (e *ValidationError) Unwrap() error {
	if e == nil || e.Cause == nil {
		return ErrSemanticValidation
	}
	return e.Cause
}

func newValidationError(cause error, messages ...string) error {
	clean := make([]string, 0, len(messages))
	for _, message := range messages {
		message = strings.TrimSpace(message)
		if message != "" {
			clean = append(clean, message)
		}
	}
	if len(clean) == 0 {
		clean = append(clean, ErrSemanticValidation.Error())
	}
	if cause == nil {
		cause = ErrSemanticValidation
	}
	return &ValidationError{Cause: cause, Messages: clean}
}

func asValidationError(err error) (*ValidationError, bool) {
	if err == nil {
		return nil, false
	}
	var validationErr *ValidationError
	if errors.As(err, &validationErr) {
		return validationErr, true
	}
	return nil, false
}

// ValidationMessages extracts semantic validation details from error values.
func ValidationMessages(err error) []string {
	validationErr, ok := asValidationError(err)
	if !ok || validationErr == nil {
		return nil
	}
	out := make([]string, 0, len(validationErr.Messages))
	for _, item := range validationErr.Messages {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}
