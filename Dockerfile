FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.11.26
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY data/support-conversations-v1.jsonl ./data/support-conversations-v1.jsonl
RUN uv sync --frozen --no-dev --no-editable
RUN useradd --create-home --uid 10001 demo
USER demo
EXPOSE 8080
CMD ["uvicorn", "datafog_lance_context.api:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
