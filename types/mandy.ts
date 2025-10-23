export type MandyMode = "silent" | "prompted" | "active";

export type MandyStatus =
  | "disconnected"
  | "connecting"
  | "online"
  | "degraded"
  | "error";

export interface MandyState {
  version: number;
  mode: MandyMode;
  muted: boolean;
  directive: string;
  lockedBy?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  status: MandyStatus;
  pendingReason?: string | null;
}

export const DEFAULT_MANDY_STATE: MandyState = {
  version: 0,
  mode: "silent",
  muted: true,
  directive: "",
  status: "disconnected",
  lockedBy: null,
  updatedBy: null,
  updatedAt: null,
  pendingReason: null,
};

export interface MandyControlPayload {
  action:
    | "mandy:start"
    | "mandy:stop"
    | "mandy:set_mode"
    | "mandy:mute"
    | "mandy:unmute"
    | "mandy:update_directive"
    | "mandy:lock_mode"
    | "mandy:unlock_mode";
  mode?: MandyMode;
  directive?: string;
  reason?: string;
  requestedBy?: string;
  version?: number;
}
