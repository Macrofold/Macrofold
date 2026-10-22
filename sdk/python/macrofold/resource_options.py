"""Shared request controls for generated resources; HTTP behavior stays in the transport."""
from collections.abc import Mapping
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
    inference_retries: int = 0
    timeout: float | None = None

    def identity(self, mutation: bool) -> str | None:
        return (self.idempotency_key or str(uuid4())) if mutation else None


def payload(values: Mapping[str, object]) -> dict[str, Any]:
    return to_jsonable_python({key: value for key, value in values.items() if not isinstance(value, Omit)})


def parameters(values: dict[str, object]) -> dict[str, Any]:
    return payload(values)


Model = TypeVar('Model', bound=BaseModel)


def decode(model: type[Model], value: object, identity: str | None) -> Model:
    try:
        validated = model.model_validate(value)
        # Vendor oneOf models parse wire dictionaries through from_dict;
        # model_validate alone silently leaves their actual_instance empty.
        # Validate the original shape first so required nullable fields cannot
        # become implicitly present through from_dict's obj.get defaults.
        reader = getattr(model, 'from_dict', None)
        if callable(reader):
            decoded = reader(value)
            if not isinstance(decoded, model):
                raise ValueError('The generated response decoder returned no model.')
            return decoded
        return validated
    except (ValidationError, ValueError) as error:
        # Success may already have committed a mutation, even when its response has the wrong shape.
        from .client import TransportError
        raise TransportError('The service response did not match the API contract. Inspect remote state before retrying.', identity, run_id=value.get('run_id') if isinstance(value, dict) else None, urls=(value.get('urls') or value.get('data', {}).get('urls')) if isinstance(value, dict) else None) from error
