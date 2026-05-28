import { fmtTime } from "../lib/format.js";
import { computeStats } from "../lib/stats.js";
import { BrandIcon } from "./Icon.jsx";

export function TopStrip({ state, voice, sessionClockSeconds }) {
  const status = voice.status !== "idle" ? voice.status : (state.connection?.status || "idle");
  const stats = computeStats(state);

  let sessionClockLabel;
  if (state.session_started_at && sessionClockSeconds != null) {
    sessionClockLabel = `Session · ${fmtTime(sessionClockSeconds)}`;
  } else {
    sessionClockLabel = status === "live" ? "Session · live" : "Session · idle";
  }

  let statusLabel = "Idle";
  if (status === "connecting") statusLabel = "Connecting…";
  else if (status === "live") statusLabel = voice.paused ? "Paused" : "Live";
  else if (status === "error") statusLabel = "Error";

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">{BrandIcon}</div>
        <div className="brand-meta">
          <b>Coach</b>
          <span>{sessionClockLabel}</span>
        </div>
      </div>

      <div className="top-right">
        <div className="top-kpis">
          <div className="kpi"><b>{stats.setsCompleted} / {state.workout_plan.length}</b><span>sets</span></div>
          <div className="kpi"><b>{fmtTime(stats.activeSeconds)}</b><span>active</span></div>
          <div className="kpi"><b>{fmtTime(stats.restSeconds)}</b><span>rested</span></div>
        </div>
        <div className="top-status" data-voice-state={status} data-paused={voice.paused ? "true" : "false"}>
          <span className="top-status-dot" aria-hidden="true" />
          <span className="top-status-label">{statusLabel}</span>
        </div>
      </div>
    </header>
  );
}
