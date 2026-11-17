"""
Importing this package registers every target. Add a new target module here.
"""

from app.generation.registry import registry
from app.generation.targets import fungame, quest, quiz  # noqa: F401

__all__ = ["registry"]
