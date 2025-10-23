# Mandy Voice Agent Architecture

## High-Level Goals
- Treat Mandy as a first-class participant whose behavior can be dialed up or down collectively.
- Keep humans in control: everyone sees the current mode, anyone can request changes, owners can lock Mandy when needed.
- Ensure backend and frontend share a single source of truth for Mandy state so concurrent actions never diverge.

## Components
1. **Control API (Next.js)**  
   - `/api/mandy/start` proxies to the FastAPI service (`MANDY_SERVICE_URL`) and returns the authoritative Mandy state.  
   - `/api/mandy/control` forwards mode/mute/lock/directive commands; responses drive optimistic UI updates.  
   - `/api/mandy/state` hydrates reconnecting clients with the latest state snapshot.

2. **State Store**  
   - JSON schema `{ version, mode, muted, directive, lockedBy, updatedBy, updatedAt }`.  
   - Increment `version` on every mutation; clients accept only monotonic updates.

3. **Pipecat Bot Service (`mandy-bot/`)**  
   - FastAPI control plane (`server.py`) wraps `MandyBot` instances.  
   - Endpoints:
     - `POST /api/start`: receives room URL, token, directive, spins up/rehydrates Mandy and returns latest state.
     - `POST /api/control`: forwards mute/mode/lock/directive commands and returns authoritative state.
     - `GET /api/state`: retrieves cached state for reconnecting clients.
   - `MandyBot` publishes state via callback + Daily `app-message` (`mandy/state`). Swap the in-memory registry for Redis in production to share state across workers.

4. **Frontend (Next.js)**  
   - `MandyPanel` component listens for `mandy/state` messages from Pipecat service.  
   - Sends control requests either via Next.js API (owner lock) or directly through `callFrame.sendAppMessage` (`mandy/control`).  
   - Renders directive editor, mode dropdown, global mute toggle, “Dismiss Mandy” button, status indicators, and activity feed.

5. **Intent + Heuristic Layer (Pipecat)**  
   - Separate module containing:
     - Wake phrase detector
     - Silence + open-question heuristic
     - Directive monitor (decision/action trackers)
   - Emits intents into Pipecat pipeline to decide when to speak vs. send chat text.

## Token Flow
1. User creates room via `/api/create-room`.  
2. When Mandy is requested, frontend calls `/api/mandy/start`.  
3. API uses Daily REST to mint an owner-scoped token for Mandy, stores state, and forwards payload to `mandy-bot /start`.  
4. Bot joins room, emits initial `mandy/state`.

## Reliability Hooks
- Health endpoint `/healthz` returns pipeline status.  
- Bot disconnect watcher restarts Pipecat session with exponential backoff.  
- Circuit breaker around STT/TTS/LLM providers triggers text-only mode and notifies clients.

## Outstanding Work
- Implement Redis store and API routes.  
- Flesh out Pipecat pipeline with true heuristics and context summary.  
- Build automated chaos scenarios described in `CLAUDE.md` once harness is ready.
