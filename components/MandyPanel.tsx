import { DailyCall } from "@daily-co/daily-js";
import { useEffect, useMemo, useState } from "react";
import styles from "../styles/MandyPanel.module.css";
import {
  MandyControlPayload,
  MandyMode,
  MandyState,
  MandyStatus,
} from "../types/mandy";
import Transcription from "./Transcription";
import { transcriptMsg } from "../pages/[domain]/[room]";

type Props = {
  callFrame: DailyCall | undefined;
  state: MandyState;
  localUserName: string;
  isOwner: boolean;
  isInMeeting: boolean;
  isStarting: boolean;
  lastError: string | null;
  onRequestStart: () => Promise<void>;
  onRequestStop: () => Promise<void>;
  onSendControl: (payload: MandyControlPayload) => Promise<void>;
  onClearError: () => void;
  isTranscribing: boolean;
  newMsg: transcriptMsg;
};

const modeLabels: Record<MandyMode, string> = {
  silent: "Silent",
  prompted: "Prompted Voice",
  active: "Active Voice",
};

const statusLabels: Record<MandyStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  online: "Online",
  degraded: "Degraded",
  error: "Error",
};

const MandyPanel = ({
  callFrame,
  state,
  localUserName,
  isOwner,
  isInMeeting,
  isStarting,
  lastError,
  onRequestStart,
  onRequestStop,
  onSendControl,
  onClearError,
  isTranscribing,
  newMsg,
}: Props) => {
  const [activeTab, setActiveTab] = useState<"mandy" | "transcript">("mandy");
  const [directiveDraft, setDirectiveDraft] = useState<string>(
    state.directive
  );

  useEffect(() => {
    setDirectiveDraft(state.directive);
  }, [state.directive]);

  const isConnected =
    state.status === "online" || state.status === "degraded";

  const handleDirectiveSave = () => {
    const trimmed = directiveDraft.trim();
    if (!trimmed || trimmed === state.directive) {
      return;
    }
    void onSendControl({
      action: "mandy:update_directive",
      directive: trimmed,
      requestedBy: localUserName,
      version: state.version,
    });
    setDirectiveDraft(trimmed);
  };

  const handleModeChange = (mode: MandyMode) => {
    if (mode === state.mode) {
      return;
    }
    void onSendControl({
      action: "mandy:set_mode",
      mode,
      requestedBy: localUserName,
      version: state.version,
    });
  };

  const handleToggleMute = () => {
    void onSendControl({
      action: state.muted ? "mandy:unmute" : "mandy:mute",
      requestedBy: localUserName,
      version: state.version,
    });
  };

  const handleLockToggle = () => {
    if (!isOwner) {
      return;
    }
    const action = state.lockedBy ? "mandy:unlock_mode" : "mandy:lock_mode";
    void onSendControl({
      action,
      requestedBy: localUserName,
      version: state.version,
      reason: state.lockedBy
        ? "Unlocking Mandy controls"
        : "Owner lock enabled",
    });
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.tabs}>
        <button
          className={activeTab === "mandy" ? styles.activeTab : styles.tab}
          onClick={() => setActiveTab("mandy")}
        >
          Mandy
        </button>
        <button
          className={activeTab === "transcript" ? styles.activeTab : styles.tab}
          onClick={() => setActiveTab("transcript")}
        >
          Transcript
        </button>
      </div>

      {activeTab === "mandy" && (
        <div className={styles.mandyContent}>
          <div className={styles.header}>
        <div>
          <h2>Mandy</h2>
          <p className={styles.status}>
            Status:{" "}
            <span data-status={state.status}>
              {statusLabels[state.status]}
            </span>
            {state.lockedBy && (
              <span className={styles.locked}>
                Locked by {state.lockedBy}
              </span>
            )}
          </p>
        </div>
        <div className={styles.actions}>
          {!isConnected ? (
            <button
              disabled={!isInMeeting || isStarting}
              onClick={onRequestStart}
            >
              {isStarting ? "Bringing Mandy in…" : "Invite Mandy"}
            </button>
          ) : (
            <button disabled={isStarting} onClick={onRequestStop}>
              Dismiss Mandy
            </button>
          )}
        </div>
      </div>

      {lastError && (
        <div className={styles.errorBanner}>
          <span>{lastError}</span>
          <button onClick={onClearError}>Dismiss</button>
        </div>
      )}

      <div className={styles.section}>
        <label htmlFor="mandy-mode">Mode</label>
        <select
          id="mandy-mode"
          value={state.mode}
          disabled={!isConnected || Boolean(state.lockedBy)}
          onChange={(evt) => handleModeChange(evt.target.value as MandyMode)}
        >
          <option value="silent">{modeLabels.silent}</option>
          <option value="prompted">{modeLabels.prompted}</option>
          <option value="active">{modeLabels.active}</option>
        </select>
        <button
          className={styles.muteButton}
          disabled={!isConnected}
          onClick={handleToggleMute}
        >
          {state.muted ? "Unmute Mandy" : "Mute Mandy"}
        </button>
        {isOwner && (
          <button
            className={styles.lockButton}
            disabled={!isConnected}
            onClick={handleLockToggle}
          >
            {state.lockedBy ? "Unlock controls" : "Lock controls"}
          </button>
        )}
      </div>

      <div className={styles.section}>
        <label htmlFor="mandy-directive">Directive</label>
        <textarea
          id="mandy-directive"
          placeholder="Example: Track decisions and keep voice minimal."
          value={directiveDraft}
          onChange={(evt) => setDirectiveDraft(evt.target.value)}
          onBlur={handleDirectiveSave}
          disabled={!isConnected && directiveDraft.length === 0}
        />
        <div className={styles.directiveFooter}>
          <span>
            {state.directive
              ? `Current directive set by ${state.updatedBy ?? "unknown"}`
              : "No directive yet"}
          </span>
          {directiveDraft.trim() &&
            directiveDraft.trim() !== state.directive && (
              <button onClick={handleDirectiveSave}>Update directive</button>
            )}
        </div>
      </div>

      <div className={styles.section}>
        <h3>Tips</h3>
        <ul>
          <li>Say "Hey Mandy…" to ask for help.</li>
          <li>Mandy mirrors voice replies with chat notes.</li>
          <li>Two mutes within a minute keep Mandy silent until unmuted.</li>
        </ul>
      </div>
        </div>
      )}

      {activeTab === "transcript" && (
        <div className={styles.transcriptTab}>
          <Transcription
            callFrame={callFrame}
            isTranscribing={isTranscribing}
            newMsg={newMsg}
            owner={isOwner}
          />
        </div>
      )}
    </aside>
  );
};

export default MandyPanel;
