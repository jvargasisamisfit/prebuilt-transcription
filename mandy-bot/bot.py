"""
Skeleton implementation for the Mandy Pipecat voice agent.

This file wires together the Daily transport with a Pipecat pipeline and
exposes simple control hooks that align with the frontend UI.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional

try:
  # Pipecat imports guarded so the skeleton can exist without the dependency
  from pipecat.pipeline.pipeline import Pipeline
  from pipecat.pipeline.runner import PipelineRunner
  from pipecat.pipeline.task import PipelineParams, PipelineTask
  from pipecat.processors.aggregators.openai_llm_context import (
    OpenAILLMContext,
  )
  from pipecat.services.cartesia.tts import CartesiaTTSService
  from pipecat.services.deepgram.stt import DeepgramSTTService
  from pipecat.services.openai.llm import OpenAILLMService
  from pipecat.transports.daily.transport import (
    DailyParams,
    DailyTransport,
    DailyTransportMessageFrame,
  )
  from pipecat.audio.vad.silero import SileroVADAnalyzer
  from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
  from pipecat.frames.frames import Frame, TranscriptionFrame, TextFrame
except ImportError as exc:  # pragma: no cover - informative failure
  raise ImportError(
    "Pipecat dependencies not found. Install with "
    '`pip install "pipecat-ai[daily,openai,deepgram,cartesia,silero]"`.'
  ) from exc

logger = logging.getLogger("mandy")


class DebugFrameProcessor(FrameProcessor):
  """Debug processor to log all frames passing through the pipeline."""

  async def process_frame(self, frame: Frame, direction: FrameDirection):
    import sys
    await super().process_frame(frame, direction)

    if isinstance(frame, TranscriptionFrame):
      print(f"[MANDY-DEBUG] TranscriptionFrame: '{frame.text}' (user_id={getattr(frame, 'user_id', 'N/A')})", file=sys.stderr, flush=True)
      logger.info(f"Transcription: {frame.text}")
    elif isinstance(frame, TextFrame):
      print(f"[MANDY-DEBUG] TextFrame: '{frame.text}'", file=sys.stderr, flush=True)
      logger.info(f"Text: {frame.text}")

    await self.push_frame(frame, direction)


@dataclass
class MandyRuntimeState:
  version: int = 0
  mode: str = "silent"
  muted: bool = True
  directive: str = ""
  locked_by: Optional[str] = None
  updated_by: Optional[str] = None
  status: str = "connecting"
  pending_reason: Optional[str] = None
  updated_at: datetime = field(
    default_factory=lambda: datetime.now(timezone.utc)
  )

  def to_payload(self) -> Dict[str, Any]:
    return {
      "version": self.version,
      "mode": self.mode,
      "muted": self.muted,
      "directive": self.directive,
      "lockedBy": self.locked_by,
      "updatedBy": self.updated_by,
      "status": self.status,
      "pendingReason": self.pending_reason,
      "updatedAt": self.updated_at.isoformat(),
    }


class MandyBot:
  """
  Thin wrapper around the Pipecat pipeline that understands Mandy's control
  messages and exposes lifecycle helpers. Control flow:

  1. `start` sets up transport + pipeline and begins listening for frames.
  2. `apply_control` mutates runtime state and updates processors accordingly.
  3. `publish_state` sends authoritative state through Daily `app-message`.
  """

  def __init__(
    self,
    room_url: str,
    daily_token: str,
    initial_directive: str = "",
    state_callback: Optional[
      Callable[[MandyRuntimeState], Awaitable[None]]
    ] = None,
  ) -> None:
    self.room_url = room_url
    self.daily_token = daily_token
    self.state = MandyRuntimeState(
      directive=initial_directive,
      status="connecting",
    )
    self.transport: Optional[DailyTransport] = None
    self.runner: Optional[PipelineRunner] = None
    self.task: Optional[PipelineTask] = None
    self._run_task: Optional[asyncio.Task] = None
    self._state_callback = state_callback
    self.context = OpenAILLMContext(
      messages=[
        {
          "role": "system",
          "content": initial_directive or "Be a helpful teammate named Mandy.",
        }
      ]
    )

  async def start(self) -> None:
    """
    Bootstrap the Pipecat transport and pipeline. This method should be
    launched as an asyncio Task by the FastAPI/Starlette server.
    """
    if self._run_task and not self._run_task.done():
      logger.info("Mandy already running for %s", self.room_url)
      return

    async def _run() -> None:
      import sys
      print(f"[MANDY] Starting Mandy for {self.room_url}", file=sys.stderr, flush=True)
      logger.info("Starting Mandy for %s", self.room_url)
      await self.publish_state(status="connecting")
      print("[MANDY] Published connecting state", file=sys.stderr, flush=True)

      # Create transport with VAD passthrough like Dot
      params = DailyParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
        transcription_enabled=False,
        vad_enabled=True,
        vad_analyzer=SileroVADAnalyzer(),
        vad_audio_passthrough=True,  # Key: pass audio through even during VAD
      )

      self.transport = DailyTransport(
        self.room_url,
        self.daily_token or None,
        "Mandy",
        params,
      )

      # Set up event handlers like Dot
      @self.transport.event_handler("on_participant_joined")
      async def on_participant_joined(transport, participant):
        participant_id = participant['id']
        info = participant.get('info', {})
        user_name = info.get('userName', 'Guest')
        logger.info(f"Participant joined: {user_name} (ID: {participant_id})")

      @self.transport.event_handler("on_participant_left")
      async def on_participant_left(transport, participant, reason):
        participant_id = participant['id']
        logger.info(f"Participant left: {participant_id}, reason: {reason}")

      @self.transport.event_handler("on_first_participant_joined")
      async def on_first_participant_joined(transport, participant):
        logger.info("First participant joined - Mandy is now active")
        await self.publish_state(status="online")

      print("[MANDY] Event handlers registered", file=sys.stderr, flush=True)

      # Create services - same config as Dot
      print("[MANDY] Creating STT service...", file=sys.stderr, flush=True)
      stt = DeepgramSTTService(
        api_key=os.environ.get("DEEPGRAM_API_KEY", "")
      )
      print("[MANDY] Creating LLM service...", file=sys.stderr, flush=True)
      llm = OpenAILLMService(
        api_key=os.environ.get("OPENAI_API_KEY", ""),
        model="gpt-4",
        messages=self.context.messages  # Pass initial system message
      )
      print("[MANDY] Creating TTS service...", file=sys.stderr, flush=True)
      tts = CartesiaTTSService(
        api_key=os.environ.get("CARTESIA_API_KEY", ""),
        voice_id="71a7ad14-091c-4e8e-a314-022ece01c121",  # Same voice as Dot
      )
      print("[MANDY] All services created", file=sys.stderr, flush=True)

      # Bridge transcripts to the LLM and persist conversation context
      context_aggregator = llm.create_context_aggregator(self.context)
      print("[MANDY] Context aggregator created", file=sys.stderr, flush=True)

      # Build pipeline
      print("[MANDY] Building pipeline...", file=sys.stderr, flush=True)
      try:
        pipeline = Pipeline(
          [
            self.transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            self.transport.output(),
            context_aggregator.assistant(),
          ]
        )
        print("[MANDY] Pipeline built", file=sys.stderr, flush=True)
      except Exception as e:
        print(f"[MANDY] ERROR building pipeline: {e}", file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc()
        raise

      print("[MANDY] Creating pipeline task...", file=sys.stderr, flush=True)
      self.task = PipelineTask(
        pipeline,
        params=PipelineParams(
          enable_metrics=True,
          enable_usage_metrics=True,
        ),
      )
      print("[MANDY] Pipeline task created", file=sys.stderr, flush=True)

      print("[MANDY] Creating pipeline runner...", file=sys.stderr, flush=True)
      self.runner = PipelineRunner(handle_sigint=False)
      print("[MANDY] Pipeline runner created", file=sys.stderr, flush=True)

      print("[MANDY] Pipeline created, starting runner...", file=sys.stderr, flush=True)
      logger.info("Mandy pipeline created, starting runner...")
      try:
        print("[MANDY] About to run pipeline...", file=sys.stderr, flush=True)
        await self.runner.run(self.task)
        print(f"[MANDY] Pipeline run completed normally for {self.room_url}", file=sys.stderr, flush=True)
        logger.warning(f"Pipeline runner completed unexpectedly for {self.room_url}")
      except asyncio.CancelledError:
        print(f"[MANDY] Pipeline cancelled for {self.room_url}", file=sys.stderr, flush=True)
        logger.info("Mandy runner cancelled for %s", self.room_url)
      except Exception as e:  # pragma: no cover
        print(f"[MANDY] Pipeline error: {e}", file=sys.stderr, flush=True)
        logger.exception(f"Unexpected Mandy pipeline error: {e}")
        await self.publish_state(status="error")
      finally:
        print(f"[MANDY] Pipeline cleanup - current status: {self.state.status}", file=sys.stderr, flush=True)
        if self.state.status != "disconnected":
          print(f"[MANDY] Setting status to disconnected for {self.room_url}", file=sys.stderr, flush=True)
          await self.publish_state(status="disconnected")

    print(f"[MANDY] Creating asyncio task for {self.room_url}")
    self._run_task = asyncio.create_task(_run())
    print("[MANDY] Task created")

  def is_running(self) -> bool:
    return bool(self._run_task and not self._run_task.done())

  async def apply_control(self, payload: Dict[str, Any]) -> None:
    """
    Handle control messages sent from the web app. This skeleton only logs the
    action and updates state metadata; real implementation should wire through
    to processors (e.g. muting TTS, switching heuristics).
    """
    action = payload.get("action")
    requested_by = payload.get("requestedBy", "unknown")
    self.state.version += 1
    self.state.updated_by = requested_by
    self.state.updated_at = datetime.now(timezone.utc)

    if action == "mandy:mute":
      self.state.muted = True
      logger.info("Mandy muted by %s", requested_by)
    elif action == "mandy:unmute":
      self.state.muted = False
      logger.info("Mandy unmuted by %s", requested_by)
    elif action == "mandy:set_mode":
      self.state.mode = payload.get("mode", self.state.mode)
      logger.info("Mandy mode set to %s by %s", self.state.mode, requested_by)
    elif action == "mandy:update_directive":
      self.state.directive = payload.get("directive", self.state.directive)
      logger.info("Directive updated by %s: %s", requested_by, self.state.directive)
    elif action == "mandy:lock_mode":
      self.state.locked_by = requested_by
      logger.info("Controls locked by %s", requested_by)
    elif action == "mandy:unlock_mode":
      self.state.locked_by = None
      logger.info("Controls unlocked by %s", requested_by)
    elif action == "mandy:stop":
      logger.info("Received stop command from %s", requested_by)
      await self.shutdown()
      await self.publish_state(status="disconnected")
      return
    elif action == "mandy:start":
      logger.info("Start acknowledged from %s", requested_by)
      await self.start()

    await self.publish_state()

  async def publish_state(self, status: Optional[str] = None) -> None:
    """Broadcast Mandy's state to the room via Daily app messages."""
    if status:
      self.state.status = status
    payload = {
      "type": "mandy/state",
      "state": self.state.to_payload(),
    }
    logger.debug("Publishing state: %s", payload)
    if self.task:
      try:
        await self.task.queue_frame(
          DailyTransportMessageFrame(message=payload)
        )
      except Exception:  # pragma: no cover - we still surface to backend
        logger.exception("Unable to send app-message update")

    if self._state_callback:
      await self._state_callback(self.state)

  async def shutdown(self) -> None:
    if self._run_task and not self._run_task.done():
      self._run_task.cancel()
    if self.task:
      await self.task.cancel()
    if self.transport:
      await self.transport.close()
    self.state.status = "disconnected"
    logger.info("Mandy shutdown complete")
    if self._state_callback:
      await self._state_callback(self.state)


async def main() -> None:
  """
  Local runner helper for quick smoke tests. Supply DAILY_ROOM_URL and
  DAILY_ROOM_TOKEN environment variables (or similar) before executing.
  """
  room_url = os.environ.get("MANDY_ROOM_URL")
  room_token = os.environ.get("MANDY_ROOM_TOKEN")
  if not room_url or not room_token:
    raise RuntimeError("MANDY_ROOM_URL and MANDY_ROOM_TOKEN must be set.")

  bot = MandyBot(room_url=room_url, daily_token=room_token)
  await bot.start()


if __name__ == "__main__":
  logging.basicConfig(level=logging.INFO)
  asyncio.run(main())
