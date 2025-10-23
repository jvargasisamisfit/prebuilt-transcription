import DailyIframe, {
  DailyCall,
  DailyEventObjectAppMessage,
  DailyEventObjectFatalError,
} from "@daily-co/daily-js";
import type { NextPage } from "next";
import CallFrame from "../../components/CallFrame";
import Head from "next/head";
import MandyPanel from "../../components/MandyPanel";
import styles from "../../styles/Room.module.css";
import {
  DEFAULT_MANDY_STATE,
  MandyControlPayload,
  MandyMode,
  MandyState,
  MandyStatus,
} from "../../types/mandy";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";

export interface transcriptMsg {
  name: string;
  text: string;
  timestamp: string;
}

const VALID_MANDY_MODES: MandyMode[] = ["silent", "prompted", "active"];
const VALID_MANDY_STATUS: MandyStatus[] = [
  "disconnected",
  "connecting",
  "online",
  "degraded",
  "error",
];

const normalizeMandyState = (
  raw: Record<string, any> | null | undefined
): MandyState => {
  if (!raw) {
    return { ...DEFAULT_MANDY_STATE };
  }

  const mode = VALID_MANDY_MODES.includes(raw.mode)
    ? (raw.mode as MandyMode)
    : "silent";
  const status = VALID_MANDY_STATUS.includes(raw.status)
    ? (raw.status as MandyStatus)
    : "disconnected";

  return {
    ...DEFAULT_MANDY_STATE,
    version: typeof raw.version === "number" ? raw.version : 0,
    mode,
    status,
    muted: typeof raw.muted === "boolean" ? raw.muted : DEFAULT_MANDY_STATE.muted,
    directive:
      typeof raw.directive === "string" ? raw.directive : DEFAULT_MANDY_STATE.directive,
    lockedBy:
      typeof raw.lockedBy === "string" ? raw.lockedBy : DEFAULT_MANDY_STATE.lockedBy,
    updatedBy:
      typeof raw.updatedBy === "string" ? raw.updatedBy : DEFAULT_MANDY_STATE.updatedBy,
    updatedAt:
      typeof raw.updatedAt === "string" ? raw.updatedAt : DEFAULT_MANDY_STATE.updatedAt,
    pendingReason: null,
  } as MandyState;
};

const Room: NextPage = ({}) => {
  const router = useRouter();
  const { domain, room, t } = router.query;
  const domainSlug = typeof domain === "string" ? domain : "";
  const roomSlug = typeof room === "string" ? room : "";
  const tokenSlug = typeof t === "string" ? t : undefined;
  const [callFrame, setCallFrame] = useState<DailyCall>();
  const [newMsg, setNewMsg] = useState<transcriptMsg>({
    name: "",
    text: "",
    timestamp: "",
  });
  const [error, setError] = useState<string>("");
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [localUserName, setLocalUserName] = useState<string>("You");
  const [mandyState, setMandyState] =
    useState<MandyState>({ ...DEFAULT_MANDY_STATE });
  const [mandyStarting, setMandyStarting] = useState<boolean>(false);
  const [mandyError, setMandyError] = useState<string | null>(null);
  const [isInMeeting, setIsInMeeting] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  /*
    Track URL parameters to determine token and room owner status
  */

  const hasToken: boolean = Boolean(tokenSlug);
  const callUrl =
    domainSlug && roomSlug
      ? `https://${domainSlug}.daily.co/${roomSlug}${tokenSlug ? `?t=${tokenSlug}` : ""}`
      : "";

  /*
    Set up the Daily call and event listeners on page load
  */

  const startCall = useCallback(() => {
    if (!callUrl) {
      return;
    }
    const container = document.getElementById("callFrame")?.parentElement;
    if (!container) {
      return;
    }

    // Remove the placeholder iframe
    const oldIframe = document.getElementById("callFrame");
    if (oldIframe) {
      oldIframe.remove();
    }

    const newCallFrame = DailyIframe.createFrame(container, {
      showLeaveButton: true,
      iframeStyle: {
        position: "absolute",
        width: "100%",
        height: "100%",
        border: "0",
      },
    });

    // Get username from localStorage
    const savedName = localStorage.getItem("dailyUserName");
    if (savedName) {
      setLocalUserName(savedName);
    }

    // Set up event listeners BEFORE joining
    newCallFrame.on("error", (ev: DailyEventObjectFatalError | undefined) => {
      setError(ev?.errorMsg ?? "Something went wrong");
    });

    newCallFrame.on("joined-meeting", (ev) => {
      setIsInMeeting(true);
      let ownerCheck = ev?.participants.local.owner as boolean;
      setIsOwner(ownerCheck);
      const localName =
        ev?.participants?.local?.user_name || savedName || "You";
      setLocalUserName(localName);
      newCallFrame.sendAppMessage({ type: "mandy/state_request" }, "*");
    });

    setCallFrame(newCallFrame);

    newCallFrame.join({
      url: callUrl,
      userName: savedName || undefined,
    });

    newCallFrame.on("transcription-started", () => {
      setIsTranscribing(true);
    });

    newCallFrame.on("transcription-stopped", () => {
      setIsTranscribing(false);
    });

    newCallFrame.on(
      "app-message",
      (msg: DailyEventObjectAppMessage | undefined) => {
        const data = msg?.data;
        if (data?.type === "mandy/state") {
          const incomingState = data.state as Record<string, any>;
          if (incomingState) {
            setMandyState((prev) => {
              const normalized = normalizeMandyState(incomingState);
              if (normalized.version >= (prev?.version ?? 0)) {
                return normalized;
              }
              return prev;
            });
          }
          return;
        }

        if (data?.type === "mandy/error") {
          setMandyError(data.message ?? "Mandy encountered an error.");
          return;
        }

        if (msg?.fromId === "transcription" && data?.is_final) {
          const local = newCallFrame.participants().local;
          const name: string =
            local.session_id === data.session_id
              ? local.user_name
              : newCallFrame.participants()[data.session_id].user_name;
          const text: string = data.text;
          const timestamp: string = data.timestamp;

          if (name.length && text.length && timestamp.length) {
            setNewMsg({ name, text, timestamp });
          }
          // Let late-joiners know that transcription is running --
          // Ideally this would be more robust, because transcription
          // could be running but no one has said anything for a while
          // and the state would not update. For the purposes of this
          // demo, we'll just do this.
          setIsTranscribing(true);
        }
      }
    );
  }, [callUrl]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    startCall();
  }, [router.isReady, startCall]);

  const sendMandyControl = useCallback(
    async (payload: MandyControlPayload) => {
      if (!domainSlug || !roomSlug) {
        setMandyError("Missing room information for Mandy control.");
        return;
      }

      setMandyState((prev) => ({
        ...prev,
        pendingReason: payload.action,
      }));

      try {
        const response = await fetch("/api/mandy/control", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            domain: domainSlug,
            room: roomSlug,
            ...payload,
            requestedBy: payload.requestedBy ?? localUserName,
          }),
        });

        const payloadJson = await response.json();

        if (!response.ok) {
          throw new Error(
            payloadJson?.error || "Failed to update Mandy's state."
          );
        }

        if (payloadJson?.state) {
          setMandyState(
            normalizeMandyState(payloadJson.state as Record<string, any>)
          );
          setMandyError(null);
        } else {
          setMandyState((prev) => ({
            ...prev,
            pendingReason: null,
          }));
        }
      } catch (err: any) {
        setMandyError(err?.message || "Failed to update Mandy.");
        setMandyState((prev) => ({
          ...prev,
          pendingReason: null,
        }));
      }
    },
    [domainSlug, roomSlug, localUserName]
  );

  const requestMandyStart = useCallback(async () => {
    if (mandyStarting) {
      return;
    }
    setMandyStarting(true);
    try {
      if (!domainSlug || !roomSlug) {
        setMandyError("Missing room information for Mandy.");
        return;
      }

      const response = await fetch("/api/mandy/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          domain: domainSlug,
          room: roomSlug,
          token: tokenSlug ?? null,
          directive: mandyState.directive,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to invite Mandy.");
      }
      if (payload?.state) {
        setMandyState(
          normalizeMandyState(payload.state as Record<string, any>)
        );
      }
      setMandyError(null);
    } catch (inviteError: any) {
      setMandyError(inviteError.message);
    } finally {
      setMandyStarting(false);
    }
  }, [
    domainSlug,
    mandyStarting,
    roomSlug,
    tokenSlug,
    localUserName,
    mandyState.directive,
  ]);

  const requestMandyStop = useCallback(async () => {
    await sendMandyControl({
      action: "mandy:stop",
      requestedBy: localUserName,
      version: mandyState.version,
    });
  }, [localUserName, mandyState.version, sendMandyControl]);

  const handleClearMandyError = () => setMandyError(null);

  useEffect(() => {
    if (!domainSlug || !roomSlug) {
      return;
    }
    let cancelled = false;
    const fetchInitialState = async () => {
      try {
        const response = await fetch(
          `/api/mandy/state?domain=${encodeURIComponent(
            domainSlug
          )}&room=${encodeURIComponent(roomSlug)}`
        );
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (!cancelled && payload?.state) {
          setMandyState(normalizeMandyState(payload.state as Record<string, any>));
        }
      } catch (err: any) {
        if (!cancelled) {
          setMandyError(err?.message || "Unable to load Mandy's state.");
        }
      }
    };

    fetchInitialState();
    return () => {
      cancelled = true;
    };
  }, [domainSlug, roomSlug]);

  /*
    Return embedded Daily call with transcription section
  */

  return (
    <div className={styles.container}>
      <Head>
        <title>Group Mode</title>
        <meta name="description" content="Group Mode - Collaborative meetings with AI assistance" />
        <link rel="icon" href="/favicon.png" />
      </Head>
      <main className={`${styles.main} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
        <div className={styles.callFrameContainer}>
          <CallFrame />
        </div>
        <button
          className={styles.collapseToggle}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? '◀' : '▶'}
        </button>
        <div className={styles.sidebar}>
          <MandyPanel
            callFrame={callFrame}
            state={mandyState}
            localUserName={localUserName}
            isOwner={isOwner}
            isInMeeting={isInMeeting}
            isStarting={mandyStarting}
            lastError={mandyError}
            onRequestStart={requestMandyStart}
            onRequestStop={requestMandyStop}
            onSendControl={sendMandyControl}
            onClearError={handleClearMandyError}
            isTranscribing={isTranscribing}
            newMsg={newMsg}
          />
        </div>
      </main>
    </div>
  );
};

export default Room;
