# MindSpear AI server (FastAPI). Runs uvicorn on port 8001.
FROM python:3.12-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

# Dependencies first so source edits don't reinstall them. uv is mounted for this step only
# (not shipped in the image); keep its version in step with the one that writes uv.lock.
COPY pyproject.toml uv.lock ./
RUN --mount=from=ghcr.io/astral-sh/uv:0.12.23,source=/uv,target=/bin/uv \
    uv sync --frozen --no-dev --no-install-project

COPY app ./app

# Root keeps owning /srv: the app only reads it, so no chown (which would copy the venv into another layer).
RUN useradd --create-home --uid 1000 appuser
USER appuser

ENV PATH="/srv/.venv/bin:$PATH"
EXPOSE 8001

# python:slim has no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
