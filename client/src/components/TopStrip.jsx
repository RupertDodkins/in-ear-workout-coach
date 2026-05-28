import { Fragment } from "react";
import { PHASE_ORDER, PHASE_LABEL } from "../lib/constants.js";
import { fmtTime } from "../lib/format.js";
import { computeStats } from "../lib/stats.js";
import { BrandIcon } from "./Icon.jsx";

function PhaseRail({ phase }) {
  const currentIdx = PHASE_ORDER.indexOf(phase);
  return (
    <nav className="phase-rail" aria-label="workout phase progression">
      {PHASE_ORDER.map((p, idx) => {
        let cls = "phase";
        if (idx < currentIdx || (phase === "completed" && p === "completed")) cls = "phase done";
        if (p === phase) cls = "phase active";
        return (
          <Fragment key={p}>
            <div className={cls}>
              <span className="dot"></span>
              {PHASE_LABEL[p]}
            </div>
            {idx < PHASE_ORDER.length - 1 && <span className="phase-sep">›</span>}
          </Fragment>
        );
      })}
    </nav>
  );
}

export function TopStrip({ state, voice, onConnect, onReset, onTogglePause, sessionClockSeconds }) {
  const status = voice.status !== "idle" ? voice.status : (state.connection?.status || "idle");
  const model = state.connection?.model || "gpt-realtime-2";
  const stats = computeStats(state);

  const connClass = ["idle", "connecting", "live", "error"].includes(status) ? status : "idle";
  const connText = status === "live"
    ? `${model} · ${state.connection?.voice || "voice"} · live`
    : status;

  let sessionClockLabel;
  if (state.session_started_at && sessionClockSeconds != null) {
    sessionClockLabel = `Session · ${fmtTime(sessionClockSeconds)}`;
  } else {
    sessionClockLabel = status === "live" ? "Session · live" : "Session · idle";
  }

  let connectLabel = "Connect Voice";
  let connectDisabled = false;
  let connectPrimary = true;
  if (status === "live") {
    connectLabel = voice.paused ? "Voice Paused" : "Voice Live";
    connectDisabled = true;
    connectPrimary = false;
  } else if (status === "connecting") {
    connectLabel = "Connecting…";
    connectDisabled = true;
  }

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">{BrandIcon}</div>
        <div className="brand-meta">
          <b>Coach</b>
          <span>{sessionClockLabel}</span>
        </div>
      </div>

      <PhaseRail phase={state.phase} />

      <div className="top-right">
        <div className="top-kpis">
          <div className="kpi"><b>{stats.setsCompleted} / {state.workout_plan.length}</b><span>sets</span></div>
          <div className="kpi"><b>{fmtTime(stats.activeSeconds)}</b><span>active</span></div>
          <div className="kpi"><b>{fmtTime(stats.restSeconds)}</b><span>rested</span></div>
        </div>
        <div className="conn" data-status={connClass}>
          <span className="pulse"></span>
          <span className="conn-text">{connText}</span>
        </div>
        <div className="top-actions">
          <button
            className={`action ${connectPrimary ? "primary" : "secondary"}`}
            onClick={onConnect}
            disabled={connectDisabled}
          >
            {connectLabel}
          </button>
          {status === "live" && (
            <button
              className={`action ${voice.paused ? "primary" : "secondary"}`}
              onClick={onTogglePause}
            >
              {voice.paused ? "Resume" : "Pause"}
            </button>
          )}
          <button className="action secondary" onClick={onReset}>Reset</button>
        </div>
      </div>
    </header>
  );
}
