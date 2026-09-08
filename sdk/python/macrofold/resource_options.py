"""Shared request controls for generated resources; HTTP behavior stays in the transport."""
from dataclasses import dataclass, field
from typing import Any, TypeVar
from uuid import uuid4
from pydantic import BaseModel, ValidationError
from pydantic_core import to_jsonable_python


class Omit:
    """An omitted optional field, distinct from an explicit JSON null."""


OMIT = Omit()


@dataclass(frozen=True)
class RequestOptions:
    idempotency_key: str | None = None
    headers: dict[str, str] = field(default_factory=dict)

    def identity(self, mutation: bool) -> str | None:
        return (self.idempotency_key or str(uuid4())) if mutation else None


def payload(values: dict[str, object]) -> dict[str, Any]:
    return to_jsonable_python({key: value for key, value in values.items() if not isinstance(value, Omit)})


def parameters(values: dict[str, object]) -> dict[str, Any]:
    return payload(values)


Model = TypeVar('Model', bound=BaseModel)


def decode(model: type[Model], value: object, identity: str | None) -> Model:
    try:
        return model.model_validate(value)
    except ValidationError as error:
        # Success may already have committed a mutation, even when its response has the wrong shape.
        from .client import TransportError
        raise TransportError('The service response did not match the API contract. Inspect remote state before retrying.', identity) from error
