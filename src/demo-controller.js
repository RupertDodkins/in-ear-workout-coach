import { writeFileSync } from "node:fs";

const DEMO_NAME = "Verve In-Ear Workout Coach";
const EXPORT_TARGETS = ["Heavy", "Strava", "Apple Health"];

function isoNow() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
      preferred_banter_topic: "SpaceX launches",
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

    if (!this.state.session_started_at) {
      this.state.session_started_at = isoNow();
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
      /spacex|starship|launch/i.test(trimmed)
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
        "Tell Rupert to rest, keep banter brief, and offer a quick SpaceX opener."
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

    const updatedStep = {
      ...step,
      exercise: replacement_exercise,
      target_reps: null,
      duration_seconds,
      modified_from: step.exercise,
      reason: "low-impact fallback",
      note: note ?? reason ?? "adapted due to discomfort"
    };

    this.state.workout_plan[this.state.current_step_index] = updatedStep;
    this.addCoachEvent("adapted_for_discomfort");
    this.appendEvent(
      "tool.update_plan",
      `Updated next move to ${replacement_exercise}.`,
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

  buildSummaryPayload() {
    return {
      session_type: "voice_guided_workout",
      completed_sets: clone(this.state.completed_sets),
      coach_events: clone(this.state.coach_events),
      export_targets: EXPORT_TARGETS
    };
  }

  touch() {
    this.state.updated_at = isoNow();
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
