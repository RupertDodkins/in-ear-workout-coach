import { writeFileSync } from "node:fs";

const DEMO_NAME = "In-Ear Workout Coach";
const EXPORT_TARGETS = ["Heavy", "Strava", "Apple Health"];

export const SUPPORTED_EXERCISES = [
  { name: "push-ups", default_target_reps: 20, default_duration_seconds: null },
  { name: "squats", default_target_reps: 30, default_duration_seconds: null },
  { name: "mountain climbers", default_target_reps: null, default_duration_seconds: 30 },
  { name: "plank", default_target_reps: null, default_duration_seconds: 30 }
];

function isoNow() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatLogData(data) {
  if (data == null) {
    return "";
  }

  try {
    const serialized = JSON.stringify(data);
    return serialized.length > 480
      ? `${serialized.slice(0, 477)}...`
      : serialized;
  } catch {
    return String(data);
  }
}

function shouldLogEvent(type) {
  return (
    type === "demo.reset" ||
    type === "voice.paused" ||
    type === "voice.resumed" ||
    type === "workout.started" ||
    type === "timer.rest.complete" ||
    type === "workout.complete" ||
    type === "guard.start_rest_timer" ||
    type === "guard.log_set" ||
    type === "guard.update_plan" ||
    type === "realtime.error" ||
    type === "realtime.session.ready" ||
    type.startsWith("realtime.response.") ||
    type.startsWith("realtime.sideband.") ||
    type.startsWith("realtime.turn.") ||
    type.startsWith("realtime.transient") ||
    type.startsWith("client.webrtc.") ||
    type.startsWith("client.audio.") ||
    type.startsWith("tool.")
  );
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function extractTimeBudgetSeconds({ minutes_left, seconds_left, reason } = {}) {
  if (typeof seconds_left === "number" && Number.isFinite(seconds_left)) {
    return Math.round(seconds_left);
  }

  const reasonText = String(reason || "").toLowerCase();
  const secondsMatch = reasonText.match(/(\d+)\s*(second|seconds|sec|secs)\b/);
  if (secondsMatch) {
    return Number(secondsMatch[1]);
  }

  const minutesMatch = reasonText.match(/(\d+)\s*(minute|minutes|min|mins)\b/);
  if (minutesMatch) {
    return Number(minutesMatch[1]) * 60;
  }

  if (typeof minutes_left === "number" && Number.isFinite(minutes_left)) {
    return Math.round(minutes_left * 60);
  }

  return 180;
}

function buildTimeBoxedWrapStep(step, durationSeconds) {
  const duration = clampNumber(Math.round(durationSeconds), 5, 20);

  if (typeof step.duration_seconds === "number") {
    return {
      ...clone(step),
      target_reps: null,
      duration_seconds: Math.min(step.duration_seconds, duration),
      rest_after: false,
      note: appendNote(step.note, "compressed for time")
    };
  }

  return {
    ...clone(step),
    exercise: "plank",
    target_reps: null,
    duration_seconds: duration,
    rest_after: false,
    modified_from: step.exercise,
    reason: "time-boxed wrap",
    note: `time-boxed wrap from ${step.exercise}`
  };
}

function compressSingleStep(step, budgetSeconds) {
  if (budgetSeconds <= 20) {
    return buildTimeBoxedWrapStep(step, budgetSeconds);
  }

  const updatedStep = clone(step);

  if (typeof updatedStep.target_reps === "number") {
    if (/push-?ups/i.test(updatedStep.exercise)) {
      updatedStep.target_reps = Math.min(
        updatedStep.target_reps,
        budgetSeconds <= 30 ? 10 : 15
      );
    } else if (/squats/i.test(updatedStep.exercise)) {
      updatedStep.target_reps = Math.min(
        updatedStep.target_reps,
        budgetSeconds <= 30 ? 10 : 15
      );
    } else {
      updatedStep.target_reps = Math.max(
        8,
        Math.min(updatedStep.target_reps, Math.round(updatedStep.target_reps * 0.5))
      );
    }
  }

  if (typeof updatedStep.duration_seconds === "number") {
    updatedStep.duration_seconds = Math.min(
      updatedStep.duration_seconds,
      clampNumber(Math.round(budgetSeconds), 10, 45)
    );
  }

  updatedStep.rest_after = false;
  updatedStep.note = appendNote(updatedStep.note, "compressed for time");
  return updatedStep;
}

function appendNote(note, addition) {
  if (!addition) {
    return note ?? null;
  }

  if (!note) {
    return addition;
  }

  if (note.includes(addition)) {
    return note;
  }

  return `${note}; ${addition}`;
}

function isKickoffCueForStep(text, step) {
  if (!step) {
    return false;
  }

  const normalized = String(text || "").toLowerCase();
  const exerciseMatch = normalized.includes(String(step.exercise || "").toLowerCase());
  const repsMatch =
    typeof step.target_reps === "number" &&
    normalized.includes(String(step.target_reps));
  const durationMatch =
    typeof step.duration_seconds === "number" &&
    normalized.includes(String(step.duration_seconds)) &&
    /\bsecond|seconds\b/.test(normalized);
  const cueVerbMatch = /\b(first move|start|go|hit|do|begin)\b/.test(normalized);

  return exerciseMatch && (durationMatch || repsMatch || cueVerbMatch);
}

function initialPlan() {
  return [
    {
      id: "step_1",
      exercise: "push-ups",
      target_reps: 20,
      duration_seconds: null,
      rest_after: true,
      note: "bodyweight",
      status: "pending"
    },
    {
      id: "step_2",
      exercise: "squats",
      target_reps: 30,
      duration_seconds: null,
      rest_after: false,
      note: "bodyweight",
      status: "pending"
    },
    {
      id: "step_3",
      exercise: "mountain climbers",
      target_reps: null,
      duration_seconds: 30,
      rest_after: false,
      note: "finisher",
      status: "pending"
    }
  ];
}

export class DemoController {
  constructor({
    jsonPath,
    markdownPath,
    restSeconds = 30,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onTimerExpired = null
  }) {
    this.jsonPath = jsonPath;
    this.markdownPath = markdownPath;
    this.restSeconds = restSeconds;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onTimerExpired = onTimerExpired;
    this.timerHandle = null;
    this.reset();
  }

  reset() {
    if (this.timerHandle) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = null;
    }

    const now = isoNow();
    this.state = {
      demo_name: DEMO_NAME,
      session_type: "voice_guided_workout",
      created_at: now,
      updated_at: now,
      status: "idle",
      phase: "awaiting_start",
      preferred_banter_topic: "OpenAI voice API",
      session_started_at: null,
      connection: {
        status: "idle",
        mode: "webrtc_sideband",
        model: null,
        voice: null,
        call_id: null,
        last_error: null,
        paused: false
      },
      workout_plan: initialPlan(),
      current_step_index: 0,
      rest_timer: {
        active: false,
        seconds: null,
        ends_at: null,
        label: null
      },
      completed_sets: [],
      plan_adjustments: [],
      coach_events: [],
      transcripts: [],
      event_log: [],
      summary_payload: null
    };

    this.appendEvent("demo.reset", "Demo state reset.");
    this.persist();
  }

  currentStep() {
    return this.state.workout_plan[this.state.current_step_index] ?? null;
  }

  publicState() {
    return clone(this.state);
  }

  setConnection(status, updates = {}) {
    this.state.connection = {
      ...this.state.connection,
      ...updates,
      status
    };

    if (status === "live") {
      this.state.status = "live";
    }

    if (status === "error") {
      this.state.status = "error";
    }

    this.touch();
    this.persist();
  }

  appendEvent(type, message, data = null) {
    if (shouldLogEvent(type)) {
      const renderedData = formatLogData(data);
      console.log(
        renderedData
          ? `[event][${type}] ${message} ${renderedData}`
          : `[event][${type}] ${message}`
      );
    }

    this.state.event_log.push({
      ts: isoNow(),
      type,
      message,
      data
    });

    if (this.state.event_log.length > 200) {
      this.state.event_log = this.state.event_log.slice(-200);
    }

    this.touch();
  }

  appendTranscript(role, text, source = "server") {
    const trimmed = text?.trim();
    if (!trimmed) {
      return;
    }

    const lastEntry = this.state.transcripts[this.state.transcripts.length - 1];
    if (lastEntry && lastEntry.role === role && lastEntry.text === trimmed) {
      return;
    }

    console.log(`[transcript][${source}][${role}] ${trimmed}`);

    if (!this.state.session_started_at) {
      this.state.session_started_at = isoNow();
    }

    if (
      role === "assistant" &&
      this.state.phase === "awaiting_start" &&
      isKickoffCueForStep(trimmed, this.currentStep())
    ) {
      this.state.phase = "active_set";
      this.state.status = "live";
      this.appendEvent(
        "workout.started",
        "Workout moved into the first active set."
      );
    }

    this.state.transcripts.push({
      ts: isoNow(),
      role,
      text: trimmed,
      source
    });

    if (this.state.transcripts.length > 120) {
      this.state.transcripts = this.state.transcripts.slice(-120);
    }

    if (
      this.state.phase === "resting" &&
      role === "assistant" &&
      /openai|realtime|voice api|webrtc|transcribe/i.test(trimmed)
    ) {
      this.addCoachEvent("continued_contextual_banter");
    }

    this.touch();
    this.persist();
  }

  addCoachEvent(eventName) {
    if (!this.state.coach_events.includes(eventName)) {
      this.state.coach_events.push(eventName);
      this.touch();
    }
  }

  markRestBanter(text = "") {
    if (this.state.phase !== "resting") {
      return;
    }

    this.addCoachEvent("continued_contextual_banter");
    this.appendEvent("rest.banter", "User engaged during rest.", { text });
    this.persist();
  }

  logSet({
    exercise,
    actual_reps,
    duration_seconds,
    weight_lbs,
    rpe,
    note
  } = {}) {
    const step = this.currentStep();
    if (!step) {
      return {
        ok: false,
        error: "No active workout step to log."
      };
    }

    const resolvedNote =
      note ??
      (typeof exercise === "string" && exercise !== step.exercise
        ? `model_requested_${exercise}`
        : null);

    const loggedAt = isoNow();

    if (!this.state.session_started_at) {
      this.state.session_started_at = loggedAt;
    }

    const prevSet =
      this.state.completed_sets[this.state.completed_sets.length - 1] ?? null;
    if (prevSet && prevSet.rest_started_at && !prevSet.rest_ended_at) {
      prevSet.rest_ended_at = loggedAt;
      prevSet.rest_taken_seconds = Math.max(
        0,
        Math.round(
          (Date.now() - new Date(prevSet.rest_started_at).getTime()) / 1000
        )
      );
    }

    const completedSet = {
      exercise: step.exercise,
      target_reps: step.target_reps ?? null,
      actual_reps:
        step.target_reps != null ? actual_reps ?? step.target_reps : null,
      duration_seconds:
        step.duration_seconds != null
          ? duration_seconds ?? step.duration_seconds
          : null,
      weight_lbs: weight_lbs ?? null,
      rpe:
        rpe ??
        (resolvedNote && /hard|rough|tough/i.test(resolvedNote) ? 8 : null),
      note: resolvedNote ?? null,
      reason: step.reason ?? null,
      logged_at: loggedAt,
      planned_rest_seconds: step.rest_after ? this.restSeconds : null,
      rest_started_at: null,
      rest_ended_at: null,
      rest_taken_seconds: null
    };

    step.status = "completed";
    this.state.completed_sets.push(completedSet);
    this.appendEvent("tool.log_set", `Logged ${step.exercise}.`, completedSet);

    this.state.current_step_index += 1;
    const nextStep = this.currentStep();

    if (!nextStep) {
      this.state.phase = "completed";
      this.state.status = "completed";
      this.state.rest_timer = {
        active: false,
        seconds: null,
        ends_at: null,
        label: null
      };
      this.state.summary_payload = this.buildSummaryPayload();
      this.appendEvent(
        "workout.complete",
        "Workout summary payload is ready.",
        this.state.summary_payload
      );
    } else if (step.rest_after) {
      this.state.phase = "ready_for_rest";
    } else {
      this.state.phase = "active_set";
    }

    this.touch();
    this.persist();

    return {
      ok: true,
      logged_set: completedSet,
      current_phase: this.state.phase,
      next_step: nextStep,
      session_complete: this.state.phase === "completed",
      summary_payload: this.state.summary_payload,
      reply_guidance:
        this.state.phase === "completed"
          ? "Keep the spoken summary tight and mention export targets."
          : "Acknowledge the log briefly and keep the workout moving."
    };
  }

  startRestTimer({ seconds, label = "rest" } = {}) {
    const duration = Math.max(1, Math.round(seconds ?? this.restSeconds));

    if (this.state.rest_timer.active && this.state.phase === "resting") {
      return {
        ok: true,
        already_active: true,
        rest_timer: clone(this.state.rest_timer),
        current_phase: this.state.phase,
        next_step: this.currentStep(),
        reply_guidance:
          "The rest timer is already running. Briefly remind Rupert to keep resting and stop."
      };
    }

    if (this.timerHandle) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = null;
    }

    const restStartedAt = isoNow();
    const endsAt = new Date(Date.now() + duration * 1000).toISOString();
    this.state.phase = "resting";
    this.state.rest_timer = {
      active: true,
      seconds: duration,
      ends_at: endsAt,
      label
    };

    const lastSet =
      this.state.completed_sets[this.state.completed_sets.length - 1];
    if (lastSet) {
      lastSet.planned_rest_seconds = duration;
      lastSet.rest_started_at = restStartedAt;
      lastSet.rest_ended_at = null;
      lastSet.rest_taken_seconds = null;
    }

    this.addCoachEvent("started_rest_timer");
    this.appendEvent(
      "tool.start_rest_timer",
      `Started ${duration}-second rest timer.`,
      this.state.rest_timer
    );

    this.timerHandle = this.setTimer(() => {
      this.timerHandle = null;
      this.state.rest_timer = {
        active: false,
        seconds: null,
        ends_at: null,
        label: null
      };

      const restingSet =
        this.state.completed_sets[this.state.completed_sets.length - 1];
      if (restingSet && restingSet.rest_started_at && !restingSet.rest_ended_at) {
        const endedAt = isoNow();
        restingSet.rest_ended_at = endedAt;
        restingSet.rest_taken_seconds = Math.max(
          0,
          Math.round(
            (Date.now() - new Date(restingSet.rest_started_at).getTime()) / 1000
          )
        );
      }

      if (this.currentStep()) {
        this.state.phase = "active_set";
      } else {
        this.state.phase = "completed";
      }
      this.addCoachEvent("redirected_after_timer");
      this.appendEvent("timer.rest.complete", "Rest timer finished.");
      this.touch();
      this.persist();
      if (this.onTimerExpired) {
        this.onTimerExpired(this.publicState());
      }
    }, duration * 1000);

    this.touch();
    this.persist();

    return {
      ok: true,
      rest_timer: clone(this.state.rest_timer),
      current_phase: this.state.phase,
      next_step: this.currentStep(),
      reply_guidance:
        "Tell Rupert to rest, keep banter brief, and offer a quick OpenAI voice API opener."
    };
  }

  updatePlan({
    reason,
    replacement_exercise = "plank",
    duration_seconds = 30,
    note
  } = {}) {
    const step = this.currentStep();
    if (!step) {
      return {
        ok: false,
        error: "No future step is available to update."
      };
    }

    const reasonText = `${reason ?? ""} ${note ?? ""}`.toLowerCase();
    const forcePlankFallback =
      /\b(knee|pain|hurt|hurts|weird|discomfort|strain|twinge)\b/.test(reasonText);
    const resolvedExercise = forcePlankFallback ? "plank" : replacement_exercise;
    const resolvedDuration = forcePlankFallback ? 30 : duration_seconds;
    const resolvedNote = forcePlankFallback
      ? "low-impact fallback"
      : note ?? reason ?? "adapted due to discomfort";

    const updatedStep = {
      ...step,
      exercise: resolvedExercise,
      target_reps: null,
      duration_seconds: resolvedDuration,
      modified_from: step.exercise,
      reason: "low-impact fallback",
      note: resolvedNote
    };

    this.state.workout_plan[this.state.current_step_index] = updatedStep;
    this.addCoachEvent("adapted_for_discomfort");
    this.appendEvent(
      "tool.update_plan",
      `Updated next move to ${resolvedExercise}.`,
      updatedStep
    );
    this.touch();
    this.persist();

    return {
      ok: true,
      updated_step: updatedStep,
      current_phase: this.state.phase,
      reply_guidance:
        "Acknowledge the discomfort, avoid diagnosis, and redirect to the new low-impact move."
    };
  }

  compressRemainingWorkout({ minutes_left, seconds_left, reason } = {}) {
    const remainingSteps = this.state.workout_plan.slice(this.state.current_step_index);
    if (remainingSteps.length === 0) {
      return {
        ok: false,
        error: "No remaining workout steps are available to compress."
      };
    }

    const remainingBudgetSeconds = clampNumber(
      extractTimeBudgetSeconds({ minutes_left, seconds_left, reason }),
      5,
      180
    );
    const normalizedMinutes = Math.max(
      1,
      Math.ceil(remainingBudgetSeconds / 60)
    );
    const previousRemainingSteps = clone(remainingSteps);
    const shouldSkipRest =
      this.state.rest_timer.active || this.state.phase === "ready_for_rest";

    if (this.timerHandle) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = null;
    }

    if (shouldSkipRest) {
      this.state.rest_timer = {
        active: false,
        seconds: null,
        ends_at: null,
        label: null
      };
      this.state.phase = "active_set";
      this.addCoachEvent("shortened_rest_for_time");
    }

    let compressedSteps;
    if (remainingBudgetSeconds < 60) {
      compressedSteps = [compressSingleStep(remainingSteps[0], remainingBudgetSeconds)];
    } else {
      compressedSteps = remainingSteps.map((step) => {
        const updatedStep = clone(step);

        if (typeof updatedStep.target_reps === "number") {
          if (/push-?ups/i.test(updatedStep.exercise)) {
            updatedStep.target_reps = Math.min(updatedStep.target_reps, 15);
          } else if (/squats/i.test(updatedStep.exercise)) {
            updatedStep.target_reps = Math.min(updatedStep.target_reps, 20);
          } else {
            updatedStep.target_reps = Math.max(
              8,
              Math.min(updatedStep.target_reps, Math.round(updatedStep.target_reps * 0.67))
            );
          }
        }

        if (typeof updatedStep.duration_seconds === "number") {
          updatedStep.duration_seconds = Math.min(updatedStep.duration_seconds, 20);
        }

        updatedStep.rest_after = false;
        updatedStep.note = appendNote(updatedStep.note, "compressed for time");
        return updatedStep;
      });
    }

    this.state.workout_plan.splice(
      this.state.current_step_index,
      remainingSteps.length,
      ...compressedSteps
    );

    const adjustment = {
      ts: isoNow(),
      type: "compressed_remaining_workout",
      reason: reason ?? "time constraint",
      minutes_left: normalizedMinutes,
      seconds_left: remainingBudgetSeconds,
      skipped_rest: shouldSkipRest,
      previous_remaining_steps: previousRemainingSteps,
      new_remaining_steps: clone(compressedSteps)
    };

    this.state.plan_adjustments.push(adjustment);
    this.addCoachEvent("compressed_for_time");
    const compressionLabel =
      remainingBudgetSeconds < 60
        ? `${remainingBudgetSeconds} seconds left`
        : `${normalizedMinutes} minutes left`;
    this.appendEvent(
      "tool.compress_remaining_workout",
      `Compressed the remaining workout for ${compressionLabel}.`,
      adjustment
    );
    this.touch();
    this.persist();

    return {
      ok: true,
      current_phase: this.state.phase,
      current_step: this.currentStep(),
      remaining_steps: clone(this.state.workout_plan.slice(this.state.current_step_index)),
      rest_skipped: shouldSkipRest,
      minutes_left: normalizedMinutes,
      seconds_left: remainingBudgetSeconds,
      reply_guidance:
        "Acknowledge the time constraint, explain the shortened remaining workout, and direct Rupert to the current step immediately."
    };
  }

  buildSummaryPayload() {
    return {
      session_type: "voice_guided_workout",
      completed_sets: clone(this.state.completed_sets),
      plan_adjustments: clone(this.state.plan_adjustments),
      coach_events: clone(this.state.coach_events),
      export_targets: EXPORT_TARGETS
    };
  }

  touch() {
    this.state.updated_at = isoNow();
  }

  endSession() {
    if (this.timerHandle) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = null;
    }
    this.state.phase = "completed";
    this.state.status = "completed";
    this.state.rest_timer = {
      active: false,
      seconds: null,
      ends_at: null,
      label: null
    };
    this.state.summary_payload = this.buildSummaryPayload();
    this.appendEvent("workout.complete", "Workout ended by user.", this.state.summary_payload);
    this.touch();
    this.persist();
    return this.publicState();
  }

  persist() {
    const snapshot = this.publicState();
    writeFileSync(this.jsonPath, JSON.stringify(snapshot, null, 2));
    writeFileSync(this.markdownPath, this.renderMarkdown(snapshot));
  }

  renderMarkdown(state) {
    const currentStep = state.workout_plan[state.current_step_index] ?? null;
    const eventLines = state.event_log
      .slice(-12)
      .map((entry) => `- ${entry.ts} \`${entry.type}\` ${entry.message}`)
      .join("\n");
    const transcriptLines = state.transcripts
      .slice(-8)
      .map((entry) => `- **${entry.role}**: ${entry.text}`)
      .join("\n");

    return `# ${state.demo_name}

## Status

- Phase: ${state.phase}
- Connection: ${state.connection.status}
- Current step: ${currentStep ? currentStep.exercise : "none"}

## Rest Timer

\`\`\`json
${JSON.stringify(state.rest_timer, null, 2)}
\`\`\`

## Completed Sets

\`\`\`json
${JSON.stringify(state.completed_sets, null, 2)}
\`\`\`

## Plan Adjustments

\`\`\`json
${JSON.stringify(state.plan_adjustments, null, 2)}
\`\`\`

## Coach Events

\`\`\`json
${JSON.stringify(state.coach_events, null, 2)}
\`\`\`

## Summary Payload

\`\`\`json
${JSON.stringify(state.summary_payload, null, 2)}
\`\`\`

## Transcript

${transcriptLines || "- No transcript yet."}

## Recent Events

${eventLines || "- No events yet."}
`;
  }
}
