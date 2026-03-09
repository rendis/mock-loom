package usecase

import "errors"

var (
	// ErrUnauthorized is returned for invalid auth context.
	ErrUnauthorized = errors.New("unauthorized")
	// ErrForbidden is returned for access denied.
	ErrForbidden = errors.New("forbidden")
	// ErrNotInvited is returned when authenticated user is unknown to platform.
	ErrNotInvited = errors.New("user_not_invited")
	// ErrInvalidInput is returned when payload is invalid.
	ErrInvalidInput = errors.New("invalid_input")
	// ErrAlreadyExists is returned for duplicate records.
	ErrAlreadyExists = errors.New("already_exists")
	// ErrPayloadTooLarge is returned when request payload exceeds configured limits.
	ErrPayloadTooLarge = errors.New("payload_too_large")
	// ErrSemanticValidation is returned when payload fails strict semantic validation.
	ErrSemanticValidation = errors.New("semantic_validation_failed")
	// ErrMalformedRequest is returned for malformed import/editor request shapes.
	ErrMalformedRequest = errors.New("malformed_request")
)
