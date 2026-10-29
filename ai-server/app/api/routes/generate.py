from fastapi import APIRouter

from app.api.deps import CurrentUser, Generation
from app.generation.schemas.request import GenerateRequest
from app.generation.schemas.response import GenerateResponse, TargetsResponse

router = APIRouter(prefix="/v1", tags=["generation"])


@router.get("/targets", response_model=TargetsResponse)
def targets(generation: Generation) -> TargetsResponse:
    """The targets this server can write for, their question types and the size limits."""
    return generation.targets()


@router.post("/generate", response_model=GenerateResponse)
async def generate(body: GenerateRequest, _user: CurrentUser, generation: Generation) -> GenerateResponse:
    """Writes questions / tasks / slides of `target` from `textData`. Needs the user's Laravel bearer token."""
    return await generation.generate(body)
