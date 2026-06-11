---
title: Carbon
emoji: 🧬
colorFrom: gray
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
# Render full-screen on the Hub: full-width iframe + small floating
# header instead of the default Hub chrome. Lets the multi-tab demo
# claim the whole viewport.
fullWidth: true
header: mini
---

# Carbon · DNA Continuation

A streaming demo for the `hf-carbon/carbon-3B-hybrid-loss-1T-mix2-v1` model. Enter a DNA sequence prefix and watch the model continue it.

## Local

```bash
pip install -r requirements.txt
uvicorn app:app --reload --port 7860
```

Auth uses the locally cached HF token (`huggingface-cli login`). Override the endpoint with `ENDPOINT_URL` and the model with `MODEL_NAME`.

## Spaces

Deploy as a Docker Space. Set `HF_TOKEN` as a secret (the inference endpoint requires a token authorized for it).
