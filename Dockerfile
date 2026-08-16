FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    TERRACORE_DB=/data/terracore.db

WORKDIR /app

RUN groupadd --gid 10001 terracore \
    && useradd --uid 10001 --gid terracore --no-create-home --shell /usr/sbin/nologin terracore

COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt

COPY app.py ./
COPY static ./static

RUN mkdir -p /data \
    && chown -R terracore:terracore /app /data

USER 10001:10001

EXPOSE 8000

CMD ["sh", "-c", "python -c 'from app import init_db; init_db()' && exec gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 4 --timeout 60 --access-logfile - --error-logfile - app:app"]
