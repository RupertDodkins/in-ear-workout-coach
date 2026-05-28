import { COACH_EVENT_DOT } from "../lib/constants.js";
import { fmtClock } from "../lib/format.js";
import { AlertIcon, BoltIcon, CheckIcon, Icon } from "./Icon.jsx";

const TOOL_META = {
  log_set: {
    klass: "log",
    label: "log_set",
    icon: (
      <Icon>
        <path d="M3 7h18M3 12h18M3 17h12" />
      </Icon>
    ),
  },
  start_rest_timer: {
    klass: "timer",
    label: "start_rest_timer",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </Icon>
    ),
  },
  update_plan: {
    klass: "update",
    label: "update_plan",
    icon: (
      <Icon>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <polyline points="21 3 21 8 16 8" />
        <polyline points="3 21 3 16 8 16" />
      </Icon>
    ),
  },
};

const fallbackToolMeta = (name) => ({
  klass: "log",
  label: name,
  icon: <Icon><circle cx="12" cy="12" r="9" /></Icon>,
});

function ToolArgs({ obj }) {
  if (!obj || typeof obj !== "object") return null;
  const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined);
  const renderValue = (v) => {
    if (typeof v === "string") return <span className="s">"{v}"</span>;
    if (typeof v === "number" || typeof v === "boolean") return <span className="n">{String(v)}</span>;
    return <span className="s">{JSON.stringify(v)}</span>;
  };
  return (
    <>
      <span className="p">{"{"}</span>{" "}
      {entries.map(([k, v], i) => (
        <span key={k}>
          <span className="k">{k}</span><span className="p">:</span> {renderValue(v)}
          {i < entries.length - 1 && <span className="p">, </span>}
        </span>
      ))}
      {" "}<span className="p">{"}"}</span>
    </>
  );
}

function pickToolArgs(toolName, data) {
  if (toolName === "log_set") {
    return {
      exercise: data.exercise,
      actual_reps: data.actual_reps,
      duration_seconds: data.duration_seconds,
      rpe: data.rpe,
      note: data.note,
    };
  }
  if (toolName === "start_rest_timer") {
    return { seconds: data.seconds, label: data.label };
  }
  if (toolName === "update_plan") {
    return {
      reason: data.reason ?? data.note,
      replacement_exercise: data.exercise,
      duration_seconds: data.duration_seconds,
    };
  }
  return data;
}

function ToolResult({ toolName, phase }) {
  if (toolName === "log_set") {
    return (
      <>
        <span className="arrow">→ phase</span>
        <span className="phase-chip">{phase}</span>
      </>
    );
  }
  if (toolName === "start_rest_timer") {
    return (
      <>
        <span className="arrow">→ phase</span>
        <span className="phase-chip">resting</span>
      </>
    );
  }
  if (toolName === "update_plan") {
    return <span className="arrow">→ plan revised</span>;
  }
  return null;
}

function ToolCall({ entry, phase }) {
  const time = fmtClock(entry.ts);

  if (entry.type === "timer.rest.complete") {
    return (
      <div className="tool-call sys">
        <div className="tool-icon sys">{BoltIcon}</div>
        <div>
          <div className="tool-head">
            <span className="tool-name">system.timer_expired</span>
            <span className="tool-time">{time}</span>
          </div>
          <div className="tool-args"><ToolArgs obj={{ trigger: "redirect_coach" }} /></div>
          <div className="tool-result">
            <span className="ok"><CheckIcon strokeWidth={3.5} />fired</span>
            <span className="arrow">→ coach interrupted banter</span>
          </div>
        </div>
      </div>
    );
  }

  if (entry.type === "guard.start_rest_timer") {
    return (
      <div className="tool-call sys">
        <div className="tool-icon sys">{BoltIcon}</div>
        <div>
          <div className="tool-head">
            <span className="tool-name">server.guard.start_rest_timer</span>
            <span className="tool-time">{time}</span>
          </div>
          <div className="tool-args"><ToolArgs obj={{ note: "model skipped — server filled in" }} /></div>
          <div className="tool-result">
            <span className="ok"><CheckIcon strokeWidth={3.5} />filled</span>
            <span className="arrow">→ rest timer running</span>
          </div>
        </div>
      </div>
    );
  }

  if (entry.type === "realtime.error") {
    return (
      <div className="tool-call err">
        <div className="tool-icon err">{AlertIcon}</div>
        <div>
          <div className="tool-head">
            <span className="tool-name">realtime.error</span>
            <span className="tool-time">{time}</span>
          </div>
          <div className="tool-args">
            <ToolArgs obj={entry.data || { message: entry.message }} />
          </div>
        </div>
      </div>
    );
  }

  const toolName = entry.type.replace(/^tool\./, "");
  const meta = TOOL_META[toolName] || fallbackToolMeta(toolName);
  return (
    <div className="tool-call">
      <div className={`tool-icon ${meta.klass}`}>{meta.icon}</div>
      <div>
        <div className="tool-head">
          <span className="tool-name">{meta.label}</span>
          <span className="tool-time">{time}</span>
        </div>
        <div className="tool-args"><ToolArgs obj={pickToolArgs(toolName, entry.data || {})} /></div>
        <div className="tool-result">
          <span className="ok"><CheckIcon strokeWidth={3.5} />ok</span>
          <ToolResult toolName={toolName} phase={phase} />
        </div>
      </div>
    </div>
  );
}

const RELEVANT_TYPES = new Set([
  "tool.log_set",
  "tool.start_rest_timer",
  "tool.update_plan",
  "timer.rest.complete",
  "guard.start_rest_timer",
  "realtime.error",
]);

export function AgentActivityPanel({ state }) {
  const coachEvents = state.coach_events || [];
  const log = state.event_log || [];
  const relevant = log.filter((e) => RELEVANT_TYPES.has(e.type));
  const toolCount = relevant.filter((e) => e.type.startsWith("tool.")).length;
  const total = relevant.length;
  const ordered = [...relevant].slice(-12).reverse();
  const model = state.connection?.model || "gpt-realtime-2";

  return (
    <section className="col col-right">
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Agent activity</div>
            <div className="panel-sub">
              {total} event{total === 1 ? "" : "s"} · {toolCount} tool call{toolCount === 1 ? "" : "s"}
            </div>
          </div>
          <div className="pill blue">{model}</div>
        </div>

        <div className="tools-body">
          <div className="events-summary">
            {coachEvents.length === 0 ? (
              <div className="empty-coach">no coach events yet — tags appear as the model acts</div>
            ) : (
              coachEvents.map((event, i) => (
                <div key={i} className="es-item">
                  <span className={`es-dot ${COACH_EVENT_DOT[event] || "o"}`}></span>
                  {event}
                </div>
              ))
            )}
          </div>

          <div className="tool-calls">
            {ordered.length === 0 ? (
              <div className="empty-state" style={{ margin: 0, padding: 16, textAlign: "left" }}>
                <b>No agent activity yet</b>
                Tool calls and timer events will stream in as the coach acts.
              </div>
            ) : (
              ordered.map((entry, i) => (
                <ToolCall key={`${entry.ts}-${i}`} entry={entry} phase={state.phase} />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
