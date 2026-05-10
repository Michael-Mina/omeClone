FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for postgres and building python packages
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8000
EXPOSE 8000

# Render/Fly/Railway inyectan PORT; por defecto 8000.
CMD ["sh", "-c", "uvicorn app.main:application --host 0.0.0.0 --port ${PORT:-8000}"]
