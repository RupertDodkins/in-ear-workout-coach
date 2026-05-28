import { NavLink } from "react-router-dom";

export function TabNav({ state }) {
  const turnCount = (state.transcripts || []).length;
  const eventCount = (state.event_log || []).filter((e) =>
    e.type === "tool.log_set" ||
    e.type === "tool.start_rest_timer" ||
    e.type === "tool.update_plan" ||
    e.type === "timer.rest.complete" ||
    e.type === "guard.start_rest_timer" ||
    e.type === "realtime.error"
  ).length;
  const total = (state.workout_plan || []).length;
  const done = (state.completed_sets || []).length;

  return (
    <nav className="tab-nav" aria-label="screen">
      <NavLink to="/" end className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
        Workout <span className="tab-badge">{done}/{total}</span>
      </NavLink>
      <NavLink to="/conversation" className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
        Conversation <span className="tab-badge">{turnCount}</span>
      </NavLink>
      <NavLink to="/activity" className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
        Activity <span className="tab-badge">{eventCount}</span>
      </NavLink>
    </nav>
  );
}
