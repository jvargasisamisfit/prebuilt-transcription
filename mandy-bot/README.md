# Mandy Bot Skeleton

This directory hosts the starter code for Mandy’s Pipecat service.

## Running locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install "pipecat-ai[daily,openai,deepgram,cartesia,silero]" fastapi uvicorn python-dotenv

# Run the FastAPI control plane
uvicorn mandy-bot.server:app --reload --port 8000

# (Optional) run a standalone bot for quick smoke testing
export MANDY_ROOM_URL="https://<your-domain>.daily.co/<room>"
export MANDY_ROOM_TOKEN="<ephemeral-owner-token>"
python mandy-bot/bot.py
```

**Note:** The control plane currently keeps room state in memory. For production deployments, replace it with Redis or Supabase so multiple workers share the same authoritative view.

## Next steps

1. Replace the in-memory registry in `server.py` with Redis and add proper authentication/authorization for control requests.
2. Wire Mandy’s heuristics (wake phrase gating, silence detection, directive monitor) into `MandyBot.apply_control` so mode changes affect real behavior.
3. Emit metrics and health probes (`/metrics`, structured logs) for deployment observability.
4. Add automated chaos scenarios from `CLAUDE.md` once the harness is in place.
