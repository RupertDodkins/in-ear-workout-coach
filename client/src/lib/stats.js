export function computeStats(state, nowMs = Date.now()) {
  const completed = state.completed_sets || [];
  const totalReps = completed.reduce((acc, set) => acc + (set.actual_reps || 0), 0);
  const rpes = completed.map((set) => set.rpe).filter((rpe) => typeof rpe === "number");
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;

  let activeSeconds = 0;
  let restSeconds = 0;
  const sessionStartMs = state.session_started_at
    ? new Date(state.session_started_at).getTime()
    : null;

  for (let i = 0; i < completed.length; i++) {
    const set = completed[i];
    const setEndMs = set.logged_at ? new Date(set.logged_at).getTime() : null;
    const prevSet = completed[i - 1];

    let prevBoundaryMs = sessionStartMs;
    if (prevSet) {
      prevBoundaryMs = prevSet.rest_ended_at
        ? new Date(prevSet.rest_ended_at).getTime()
        : prevSet.logged_at
          ? new Date(prevSet.logged_at).getTime()
          : prevBoundaryMs;
    }
    if (setEndMs != null && prevBoundaryMs != null && setEndMs >= prevBoundaryMs) {
      activeSeconds += (setEndMs - prevBoundaryMs) / 1000;
    }

    if (set.rest_taken_seconds != null) {
      restSeconds += set.rest_taken_seconds;
    } else if (set.rest_started_at && !set.rest_ended_at) {
      const ongoing = (nowMs - new Date(set.rest_started_at).getTime()) / 1000;
      restSeconds += Math.max(0, ongoing);
    }
  }

  const lastSet = completed[completed.length - 1];
  const isLiveActive = state.phase === "active_set"
    || (state.phase === "awaiting_start" && sessionStartMs != null);
  if (isLiveActive) {
    const fromMs = lastSet
      ? lastSet.rest_ended_at
        ? new Date(lastSet.rest_ended_at).getTime()
        : new Date(lastSet.logged_at).getTime()
      : sessionStartMs;
    if (fromMs != null) {
      activeSeconds += Math.max(0, (nowMs - fromMs) / 1000);
    }
  }

  return {
    setsCompleted: completed.length,
    totalReps,
    avgRpe,
    activeSeconds,
    restSeconds,
    sessionSeconds: activeSeconds + restSeconds,
  };
}
