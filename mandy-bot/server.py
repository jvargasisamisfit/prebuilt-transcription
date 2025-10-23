"""
FastAPI control plane for Mandy. This service orchestrates MandyBot instances,
keeps track of their shared state, and exposes a simple REST interface that the
Next.js app can call.

NOTE: This implementation uses an in-memory registry. For production use, swap
the registry with Redis or another shared store so multiple workers stay in sync.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

try:
  from .bot import MandyBot, MandyRuntimeState  # type: ignore
except ImportError:  # pragma: no cover - fallback for direct execution
  from bot import MandyBot, MandyRuntimeState

logger = logging.getLogger("mandy.server")


class StartRequest(BaseModel):
  domain: Optional[str] = Field(
    None,
    description="Daily subdomain used when room_url not provided",
  )
  room: str = Field(..., description="Daily room name")
  room_url: Optional[str] = Field(
    None, description="Full Daily room URL (overrides domain/room)"
  )
  token: Optional[str] = Field(
    None, description="Daily meeting token for Mandy (optional for open rooms)"
  )
  directive: Optional[str] = Field(
    None, description="Initial directive/persona for Mandy"
  )


class ControlRequest(BaseModel):
  domain: str
  room: str
  action: str
  mode: Optional[str] = None
  directive: Optional[str] = None
  reason: Optional[str] = None
  requested_by: Optional[str] = Field(None, alias="requestedBy")
  version: Optional[int] = None


class StateResponse(BaseModel):
  state: Dict[str, object]


app = FastAPI(title="Mandy Control Service")

_bots: Dict[str, MandyBot] = {}
_states: Dict[str, MandyRuntimeState] = {}
_lock = asyncio.Lock()


def _room_key(domain: str, room: str) -> str:
  return f"{domain}/{room}"


def _derive_domain(domain: Optional[str], room_url: str) -> str:
  if domain:
    return domain
  try:
    from urllib.parse import urlparse

    parsed = urlparse(room_url)
    host = parsed.hostname or ""
    if host.endswith(".daily.co"):
      return host.split(".daily.co")[0]
    return host or room_url
  except Exception:  # pragma: no cover - best effort
    return room_url


def _make_state_callback(room_key: str):
  async def _callback(state: MandyRuntimeState) -> None:
    _states[room_key] = state
    logger.info("State update for %s: status=%s", room_key, state.status)
    logger.debug("Full state for %s: %s", room_key, state.to_payload())
    if state.status == "disconnected":
      logger.warning("Removing bot %s from registry due to disconnected status", room_key)
      removed = _bots.pop(room_key, None)
      if removed:
        logger.info("Bot %s successfully removed from registry", room_key)
      else:
        logger.warning("Bot %s was already removed from registry", room_key)

  return _callback


def _room_url(domain: Optional[str], room: str, room_url: Optional[str]) -> str:
  if room_url:
    return room_url
  if not domain:
    raise HTTPException(
      status_code=400,
      detail="domain or room_url must be provided",
    )
  return f"https://{domain}.daily.co/{room}"


@app.post("/api/start", response_model=StateResponse)
async def start_mandy(payload: StartRequest) -> StateResponse:
  room_url = _room_url(payload.domain, payload.room, payload.room_url)
  domain_key = _derive_domain(payload.domain, room_url)
  room_key = _room_key(domain_key, payload.room)

  async with _lock:
    bot = _bots.get(room_key)
    if not bot:
      bot = MandyBot(
        room_url=room_url,
        daily_token=payload.token or "",
        initial_directive=payload.directive or "",
        state_callback=_make_state_callback(room_key),
      )
      _bots[room_key] = bot
      _states[room_key] = bot.state
    else:
      # Update directive if a new one is supplied
      if payload.directive:
        await bot.apply_control(
          {
            "action": "mandy:update_directive",
            "directive": payload.directive,
            "requestedBy": "system",
          }
        )

    # Ensure the bot is running
    await bot.start()

    return StateResponse(state=bot.state.to_payload())


@app.post("/api/control", response_model=StateResponse)
async def control_mandy(payload: ControlRequest) -> StateResponse:
  room_key = _room_key(payload.domain, payload.room)
  bot = _bots.get(room_key)
  if not bot:
    raise HTTPException(status_code=404, detail="Mandy is not active for this room.")

  action_payload = {
    "action": payload.action,
    "mode": payload.mode,
    "directive": payload.directive,
    "reason": payload.reason,
    "requestedBy": payload.requested_by or "unknown",
    "version": payload.version,
  }

  await bot.apply_control(action_payload)
  _states[room_key] = bot.state

  if bot.state.status == "disconnected":
    _bots.pop(room_key, None)

  return StateResponse(state=bot.state.to_payload())


@app.get("/api/state", response_model=StateResponse)
async def fetch_state(domain: str, room: str) -> StateResponse:
  room_key = _room_key(domain, room)
  state = _states.get(room_key)
  if not state:
    raise HTTPException(status_code=404, detail="No Mandy state found for this room.")
  return StateResponse(state=state.to_payload())


@app.get("/healthz")
async def health() -> Dict[str, str]:
  return {"status": "ok"}
