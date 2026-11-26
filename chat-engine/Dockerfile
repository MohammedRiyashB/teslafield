FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_OPENMP=ON"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake ninja-build libgomp1 curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
EXPOSE 7860
CMD ["uvicorn", "app:api", "--host", "0.0.0.0", "--port", "7860"]
