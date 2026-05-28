import { useState } from "react";
import { RING_CIRCUMFERENCE } from "../lib/constants.js";
import { fmtTime } from "../lib/format.js";
import { computeStats } from "../lib/stats.js";
import { CheckIcon, MicIcon } from "./Icon.jsx";

function Step({ step, idx, completedSet, prevCompletedSet, lastCompletedSet, isActive, sessionStartMs, isLastInPlan }) {
  const isDone = step.status === "completed";
  const isAdapted = Boolean(step.modified_from);

  let activeSec = 0;
  let restSec = null;
  let plannedRestSec = null;
  let restIsLive = false;
  let activeIsLive = false;

  if (completedSet) {
    const setEndMs = completedSet.logged_at ? new Date(completedSet.logged_at).getTime() : null;
    let prevBoundaryMs = sessionStartMs;
    if (prevCompletedSet) {
      prevBoundaryMs = prevCompletedSet.rest_ended_at
        ? new Date(prevCompletedSet.rest_ended_at).getTime()
        : new Date(prevCompletedSet.logged_at).getTime();
    }
    if (setEndMs != null && prevBoundaryMs != null && setEndMs >= prevBoundaryMs) {
      activeSec = (setEndMs - prevBoundaryMs) / 1000;
    }
    plannedRestSec = completedSet.planned_rest_seconds ?? null;
    if (completedSet.rest_taken_seconds != null) {
      restSec = completedSet.rest_taken_seconds;
    } else if (completedSet.rest_started_at && !completedSet.rest_ended_at) {
      restSec = Math.max(0, (Date.now() - new Date(completedSet.rest_started_at).getTime()) / 1000);
      restIsLive = true;
    }
  } else if (isActive) {
    let fromMs = sessionStartMs;
    if (lastCompletedSet) {
      fromMs = lastCompletedSet.rest_ended_at
        ? new Date(lastCompletedSet.rest_ended_at).getTime()
        : new Date(lastCompletedSet.logged_at).getTime();
    }
    if (fromMs != null) {
      activeSec = Math.max(0, (Date.now() - fromMs) / 1000);
      activeIsLive = true;
    }
  }

  const activeFlex = Math.max(0, Math.round(activeSec));
  const restFlex = Math.max(0, Math.round(restSec ?? 0));
  const overRest = plannedRestSec != null && restSec != null && restSec > plannedRestSec;
  const underRest = plannedRestSec != null && restSec != null && restSec > 0 && restSec < plannedRestSec;
  const overshootSec = overRest ? Math.round((restSec ?? 0) - plannedRestSec) : 0;
  const undershootSec = underRest ? Math.round(plannedRestSec - (restSec ?? 0)) : 0;
  const restPlannedPct = plannedRestSec != null && restSec != null && restSec > 0
    ? Math.min(99, Math.round((plannedRestSec / restSec) * 100))
    : 100;

  const stepClass = [
    "step",
    isDone && "done",
    isActive && "active",
    isAdapted && "adapted",
  ].filter(Boolean).join(" ");

  const spec = step.target_reps != null
    ? `· ${step.target_reps} reps`
    : step.duration_seconds != null
      ? `· ${step.duration_seconds}s`
      : "";

  let statBig;
  let statSub;
  let statTag = null;
  if (step.target_reps != null) {
    const actual = completedSet?.actual_reps ?? null;
    statBig = isDone && actual != null ? `${actual}/${step.target_reps}` : `–/${step.target_reps}`;
    statSub = "reps";
    const rpe = completedSet?.rpe;
    if (rpe != null) statTag = `RPE ${rpe}`;
  } else {
    const dur = step.duration_seconds ?? 0;
    statBig = `${dur}s`;
    statSub = "hold";
  }

  const TRIVIAL_NOTES = new Set(["completed", "bodyweight", "finisher", "done", "ok", "n/a"]);
  const isTrivial = (s) => !s || TRIVIAL_NOTES.has(String(s).trim().toLowerCase());
  let noteText = "";
  if (isAdapted) {
    const reason = step.note || step.reason || "adapted";
    noteText = `Swapped from ${step.modified_from} · ${reason}`;
  } else if (completedSet?.note && !isTrivial(completedSet.note)) {
    noteText = `"${completedSet.note}"`;
  } else if (step.note && !isTrivial(step.note)) {
    noteText = step.note;
  }

  const showTiming = isDone || isActive;
  let restLabel = null;
  if (showTiming) {
    if (plannedRestSec != null && restSec != null) {
      restLabel = (
        <span>
          <span className="dot-rest"></span>rest <b>{fmtTime(restSec)}</b> / {fmtTime(plannedRestSec)}
          {restIsLive ? " · live" : ""}
          {overRest && <span className="over"> +{overshootSec}s</span>}
          {underRest && <span className="under"> −{undershootSec}s</span>}
        </span>
      );
    } else if (restSec != null && restSec > 0) {
      restLabel = (
        <span>
          <span className="dot-rest"></span>rest <b>{fmtTime(restSec)}</b>
          {plannedRestSec == null ? " (none planned)" : ""}
        </span>
      );
    } else if (step.rest_after && !completedSet) {
      restLabel = (
        <span>
          <span className="dot-rest"></span>rest <b>0:00</b> / {fmtTime(plannedRestSec ?? 30)}
        </span>
      );
    } else if (isLastInPlan && isDone) {
      restLabel = <span>final move · no rest</span>;
    }
  }

  return (
    <div className={stepClass}>
      <div className="step-num">{isDone ? <CheckIcon strokeWidth={3} /> : idx + 1}</div>
      <div className="step-main">
        <div className="step-title-row">
          <div className="step-title">{step.exercise}</div>
          <div className="step-spec">{spec}</div>
          {isAdapted ? <div className="step-tag">Adapted</div>
            : isActive ? <div className="step-tag live">Active</div> : null}
        </div>
        {noteText && <div className="step-note">{noteText}</div>}
        {showTiming && (
          <div className="timing-bar">
            {activeFlex > 0 && (
              <div className={activeIsLive ? "seg live" : "seg active"} style={{ flex: activeFlex }} />
            )}
            {restFlex > 0 && (
              <div
                className={overRest ? "seg rest over" : "seg rest"}
                style={overRest
                  ? { flex: restFlex, "--rest-planned-pct": `${restPlannedPct}%` }
                  : { flex: restFlex }}
              />
            )}
            <div className="seg empty" />
          </div>
        )}
        {showTiming && (
          <div className="timing-labels">
            <span>
              <span className="dot-active"></span>active <b>{fmtTime(activeSec)}</b>
              {activeIsLive ? " · live" : ""}
            </span>
            {restLabel}
          </div>
        )}
      </div>
      <div className="step-stat">
        <b>{statBig}</b>
        <span>{statSub}</span>
        {statTag && <span className="rpe-mini">{statTag}</span>}
      </div>
    </div>
  );
}

function FinishCard({ stats, totalSteps, adaptedCount }) {
  const totalSec = Math.max(0, stats.activeSeconds + stats.restSeconds);
  const activePct = totalSec > 0 ? (stats.activeSeconds / totalSec) * 100 : 100;
  const restPct = Math.max(0, 100 - activePct);
  return (
    <div className="finish-card" role="status">
      <div className="finish-head">
        <div className="finish-medal" aria-hidden="true">
          <CheckIcon strokeWidth={3.4} />
        </div>
        <div className="finish-title">
          <b>Workout complete</b>
          <span>
            {stats.setsCompleted}/{totalSteps} sets · {stats.totalReps} reps
            {adaptedCount ? ` · ${adaptedCount} adapted` : ""}
          </span>
        </div>
        <div className="finish-time">
          <b>{fmtTime(stats.sessionSeconds)}</b>
          <span>total</span>
        </div>
      </div>

      <div className="finish-split" aria-label="Active versus rest breakdown">
        <div className="finish-split-bar">
          <div className="finish-split-active" style={{ width: `${activePct}%` }} />
          <div className="finish-split-rest" style={{ width: `${restPct}%` }} />
        </div>
        <div className="finish-split-legend">
          <span><span className="dot-active" /> active <b>{fmtTime(stats.activeSeconds)}</b></span>
          <span><span className="dot-rest" /> rest <b>{fmtTime(stats.restSeconds)}</b></span>
        </div>
      </div>

      <div className="finish-export">
        <div className="finish-export-label">Send packet to</div>
        <div className="finish-targets">
          <button type="button" className="ft-chip" aria-pressed="true">Heavy</button>
          <button type="button" className="ft-chip" aria-pressed="true">Strava</button>
          <button type="button" className="ft-chip" aria-pressed="true">Apple Health</button>
        </div>
        <button type="button" className="finish-export-btn">Export packet</button>
      </div>
    </div>
  );
}

function RestCard({ rt }) {
  if (!rt?.active || !rt.ends_at) return null;
  const endsAtMs = new Date(rt.ends_at).getTime();
  const totalSec = rt.seconds || 0;
  const remainingSec = Math.max(0, (endsAtMs - Date.now()) / 1000);
  const elapsedSec = Math.max(0, totalSec - remainingSec);
  const pct = totalSec > 0 ? Math.min(100, (elapsedSec / totalSec) * 100) : 0;
  const overrun = remainingSec === 0 && Date.now() > endsAtMs;
  return (
    <div className={`workout-rest${overrun ? " overrun" : ""}`} role="status">
      <div className="wr-head">
        <span className="wr-label">
          <span className="wr-dot" />
          Resting
        </span>
        <span className="wr-time">
          <b>{fmtTime(remainingSec)}</b>
          <em>/ {fmtTime(totalSec)}</em>
        </span>
      </div>
      <div className="wr-track">
        <div className="wr-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function WorkoutPanel({ state, onEndWorkout }) {
  const [planExpanded, setPlanExpanded] = useState(false);
  const stats = computeStats(state);
  const plan = state.workout_plan || [];
  const completed = state.completed_sets || [];
  const total = plan.length;
  const pct = total ? Math.round((stats.setsCompleted / total) * 100) : 0;
  const ringOffset = (RING_CIRCUMFERENCE * (1 - pct / 100)).toFixed(2);

  const adaptedCount = plan.filter((s) => s.modified_from).length;
  const completedAll = state.summary_payload != null;
  const sessionStartMs = state.session_started_at ? new Date(state.session_started_at).getTime() : null;
  const lastCompleted = completed[completed.length - 1];
  const isCompleted = state.phase === "completed";
  const hasStarted = state.session_started_at != null;
  const isAwaiting = state.phase === "awaiting_start" && !hasStarted;
  const isMidSession = !isAwaiting && !isCompleted;

  let heroTitle;
  if (isCompleted) heroTitle = <>All sets logged,<br/><em>nice work.</em></>;
  else if (state.phase === "resting") heroTitle = <>Catch breath,<br/><em>banter on.</em></>;
  else if (isMidSession) heroTitle = <>Push, squat,<br/><em>hold strong.</em></>;
  else heroTitle = <>Say <em>I'm ready</em><br/>when you are.</>;

  const pillText = isCompleted ? "complete"
    : state.phase === "resting" ? "resting"
    : state.phase === "ready_for_rest" ? "ready for rest"
    : isMidSession ? "in progress"
    : "pending";
  const pillClass = isCompleted ? "pill green"
    : state.phase === "resting" ? "pill blue"
    : isAwaiting ? "pill"
    : "pill orange";

  const ringSub = isCompleted ? "complete" : "progress";
  const previewExercises = plan.slice(0, 4).map((s) => s.exercise).filter(Boolean);
  const estMinutes = Math.max(1, Math.round(plan.length * 1.5));
  const planMetaLine = `${plan.length} ${plan.length === 1 ? "move" : "moves"} · ~${estMinutes} min`;
  const currentIdx = state.current_step_index ?? 0;
  const currentStep = plan[currentIdx] ?? null;
  const showAllSteps = !isMidSession || planExpanded || isCompleted;
  const visibleSteps = showAllSteps
    ? plan.map((step, idx) => ({ step, idx }))
    : (currentStep ? [{ step: currentStep, idx: currentIdx }] : []);

  return (
    <section className="col col-left">
      <div className={`panel workout${isAwaiting ? " workout--awaiting" : ""}`}>
        <div className="panel-head">
          <div>
            <div className="panel-title">Workout</div>
            <div className="panel-sub">
              {total} steps
              {adaptedCount ? ` · adapted ${adaptedCount === 1 ? "once" : `${adaptedCount}x`}` : ""}
              {" · "}{fmtTime(stats.sessionSeconds)} total
            </div>
          </div>
          <div className={pillClass}>
            <span className="dot"></span>
            <span className="pill-text">{pillText}</span>
          </div>
        </div>

        <div className="workout-body">
          {isAwaiting ? (
            <div className="cta-hero">
              <div className="plan-card" aria-label="Today's plan">
                <div className="plan-card-row">
                  <span className="plan-card-label">Today's plan</span>
                  <span className="plan-card-tag">{planMetaLine}</span>
                </div>
              </div>

              <div className="cta-orb" aria-hidden="true">
                <span className="cta-orb-ring" />
                <span className="cta-orb-ring delay" />
                <span className="cta-orb-core">{MicIcon}</span>
              </div>
              <div className="cta-title">
                Say <em>"I'm ready"</em><br/>when you are.
              </div>
              <div className="cta-sub">Voice or text — your call.</div>
              {previewExercises.length > 0 && (
                <div className="cta-preview">
                  {previewExercises.map((name, i) => (
                    <span key={i} className="cta-preview-item">{name}</span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className={`hero${isCompleted ? " hero--complete" : ""}${state.phase === "resting" ? " hero--resting" : ""}`}>
                <div className="hero-main">
                <div className="ring-wrap">
                  <svg width="168" height="168" viewBox="0 0 168 168" aria-hidden="true">
                    <defs>
                      <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#ff7a45" />
                        <stop offset="100%" stopColor="#f2c14e" />
                      </linearGradient>
                      <linearGradient id="ringGradDone" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#f2c14e" />
                        <stop offset="100%" stopColor="#7ae582" />
                      </linearGradient>
                    </defs>
                    <circle className="ring-bg" cx="84" cy="84" r="72" fill="none" strokeWidth="14" />
                    <circle
                      className="ring-fg"
                      cx="84" cy="84" r="72" fill="none" strokeWidth="14"
                      strokeDasharray={RING_CIRCUMFERENCE.toFixed(2)}
                      strokeDashoffset={ringOffset}
                      style={isCompleted ? { stroke: "url(#ringGradDone)" } : undefined}
                    />
                  </svg>
                  <div className="ring-label">
                    <b>{fmtTime(stats.sessionSeconds)}</b>
                    <span>{state.phase === "completed" ? "complete" : "elapsed"}</span>
                  </div>
                  {isCompleted && (
                    <div className="ring-check" aria-hidden="true">
                      <CheckIcon strokeWidth={3.5} />
                    </div>
                  )}
                </div>
                <div className="hero-stats">
                  <div className="hero-headline">Today's session</div>
                  <div className="hero-title">{heroTitle}</div>
                  {!isCompleted && (
                    <div className="hero-meta">
                      <div className="hero-stat"><b>{stats.totalReps}</b><span>total reps</span></div>
                      {stats.avgRpe != null && (
                        <div className="hero-stat">
                          <b className="accent">{stats.avgRpe.toFixed(1)}</b>
                          <span>avg RPE</span>
                        </div>
                      )}
                      <div className="hero-stat"><b>{stats.setsCompleted}/{total}</b><span>sets</span></div>
                    </div>
                  )}
                </div>
                </div>
                <RestCard rt={state.rest_timer} />
              </div>

              <div className="steps">
                {visibleSteps.map(({ step, idx }) => (
                  <Step
                    key={idx}
                    step={step}
                    idx={idx}
                    completedSet={completed[idx] ?? null}
                    prevCompletedSet={completed[idx - 1] ?? null}
                    lastCompletedSet={lastCompleted}
                    isActive={!isCompleted && state.phase === "active_set" && idx === state.current_step_index && step.status !== "completed"}
                    sessionStartMs={sessionStartMs}
                    isLastInPlan={idx === plan.length - 1}
                  />
                ))}
              </div>

              {isMidSession && (
                <div className="plan-toggle-row">
                  <button
                    type="button"
                    className="plan-toggle"
                    onClick={() => setPlanExpanded((v) => !v)}
                    aria-expanded={planExpanded}
                  >
                    {planExpanded
                      ? <>Collapse · show current</>
                      : <>View plan · <b>{Math.min(currentIdx + 1, total)} of {total}</b></>}
                  </button>
                </div>
              )}

              {isCompleted && completed.length > 0 ? (
                <FinishCard
                  stats={stats}
                  totalSteps={total}
                  adaptedCount={adaptedCount}
                />
              ) : completedAll && completed.length > 0 ? (
                <div className="export-row" data-ready="true">
                  <div className="left">
                    <div className="check-icon" aria-hidden="true">
                      <CheckIcon strokeWidth={3.5} />
                    </div>
                    <div className="export-text">
                      <b>Packet ready to export</b>
                      <span>
                        {stats.setsCompleted} sets · {stats.totalReps} reps
                        {adaptedCount ? " · adapted" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="export-targets">
                    <div className="et">Heavy</div>
                    <div className="et">Strava</div>
                    <div className="et">Apple Health</div>
                  </div>
                </div>
              ) : null}

              {isMidSession && onEndWorkout && (
                <button type="button" className="end-workout" onClick={onEndWorkout}>
                  End workout
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
