"""Errors that map to an HTTP response with a message the user can read."""


class AppError(Exception):
    status_code = 500

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class AuthError(AppError):
    status_code = 401


class UpstreamError(AppError):
    """Another service (Laravel, the LLM) could not be reached or answered badly."""

    status_code = 502


class RateLimitError(AppError):
    status_code = 429


class ValidationError(AppError):
    status_code = 422


class ConfigurationError(AppError):
    status_code = 500


class NoUsableOutputError(UpstreamError):
    """The model answered, but nothing in the answer passed validation."""
