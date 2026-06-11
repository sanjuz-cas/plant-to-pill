FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py index.html demo.html social-banner.html ./
# Discoverability surface (SEO + AI agents + social previews). These are
# read once at startup by app.py, with {{SITE_URL}} substituted in at
# request time. Without this COPY the production image 404s on every
# crawler / answer-engine probe.
COPY robots.txt llms.txt sitemap.xml ./
COPY data/ ./data/
COPY img/ ./img/
COPY annotations/ ./annotations/
# Modular CSS/JS for demo.html. demo.html links these by relative URL
# (/assets/styles/*.css, /assets/js/**/*.js) and app.py mounts the
# directory as static; without this COPY the prod image serves the
# HTML but every stylesheet and module 404s.
COPY assets/ ./assets/

ENV PORT=7860
EXPOSE 7860

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
