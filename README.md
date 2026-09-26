# Vera — magicpin AI Merchant Assistant

A full-stack AI bot + dashboard for the magicpin Vera challenge.

## Architecture

```
vera/
├── bot_code/       # FastAPI bot (Python) — the 5-endpoint challenge API
└── dashboard/      # React/Vite dashboard — UI for compose, dataset, batch runner
```

## Quick Start (Local)

```bash
# 1. Bot
cd bot_code
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add your GEMINI_API_KEY
uvicorn bot:app --host 0.0.0.0 --port 8080

# 2. Dashboard (new terminal)
cd dashboard
npm install
npm run dev
# → Open http://localhost:5173
```

## Deploy to Railway

See [deploy guide](./DEPLOY.md) for step-by-step Railway deployment.

## Stack

- **Bot**: FastAPI + Uvicorn + Gemini (`gemini-3.1-flash-lite` via OpenAI-compatible API)
- **Dashboard**: React 19 + Vite 8 + Axios + Lucide
- **LLM**: Google Gemini (OpenAI-compatible endpoint)
