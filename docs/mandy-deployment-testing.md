# Mandy Deployment & Testing Notes

## Deployment targets
- **Frontend**: Next.js app deploys as usual (Vercel/Netlify). No special build steps, but `NEXT_PUBLIC_MANDY_SERVICE_URL` (planned) should point to the control API when available.
- **Bot service**: Containerise `mandy-bot` with `dailyco/pipecat-base` as base image. Expose FastAPI on port 8000 and map `/api/start`, `/api/control`, `/api/state`, `/healthz`.
- **State store**: Redis (preferred) or Supabase Postgres. Store Mandy state per room with a TTL that matches Daily room lifetime.

## Configuration checklist
- `OPENAI_API_KEY`, `CARTESIA_API_KEY`, `DEEPGRAM_API_KEY`, `MANDY_SESSION_SECRET`.
- Optional feature flags:
  - `MANDY_AUTO_START=false` (only join when invited).
  - `MANDY_MAX_VOICE_SECONDS=300` (cost cap).
  - `MANDY_DISABLE_WAKE_WORD=false`.
- Next.js: `MANDY_SERVICE_URL` pointing to the FastAPI control plane (`http://localhost:8000` in local dev).
- Daily REST credentials for issuing bot tokens (store in server environment).

## Testing strategy
1. **Harness scenarios**  
   - Implement timeline DSL described in CLAUDE.md.  
   - Add fixtures for standup, governance clash, chaos brainstorm, outage drill, and active voice sales call.  
   - Run with deterministic STT/LLM/TTS mocks before switching to real providers.
   - Use the REST control service in tests to simulate concurrent mode/mute changes and ensure state versions stay monotonic.
2. **Manual smoke tests**  
   - Verify Mandy join/mute/unmute/lock controls across two browsers.  
   - Confirm duplicate “Invite Mandy” clicks are idempotent.  
   - Simulate owner lock/unlock and observe UI updates.
3. **Audio reliability**  
   - Loop Mandy’s TTS audio into her STT path and ensure she does not wake herself.  
   - Measure end-to-end latency across good and poor network conditions.
4. **Degradation drills**  
   - Force STT/TTS failures; ensure UI shows “degraded mode” banner and Mandy falls back to text-only.  
   - Confirm control commands still work while degraded.  
   - Validate circuit breaker resets after cooldown.
5. **Security & compliance**  
   - Attempt unauthorized `mandy/control` messages and verify they are ignored.  
   - Trigger “Purge meeting memory” and confirm persistence layers delete records.  
   - Confirm all Mandy speech appears in transcript for accessibility.

## Outstanding TODOs
- Build the FastAPI wrapper for `MandyBot` with Redis-backed state updates.
- Implement heuristics (wake-word, silence detection, directive monitor) and plug into Pipecat pipeline.
- Emit analytics: intent count, false wake rate, voice latency, directive changes.
- Implement post-call summary card + export, gated behind owner approval.
- Finish chaos harness and integrate into CI so regressions are caught automatically.
