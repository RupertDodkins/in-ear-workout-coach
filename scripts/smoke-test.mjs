import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DemoController } from "../src/demo-controller.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScenario(iteration) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "verve-in-ear-"));
  let timerTriggered = false;

  const controller = new DemoController({
    jsonPath: path.join(tmpDir, "workout_session.json"),
    markdownPath: path.join(tmpDir, "workout_session.md"),
    setTimer: (fn) => setTimeout(fn, 10),
    clearTimer: clearTimeout,
    onTimerExpired: () => {
      timerTriggered = true;
    }
  });

  const first = controller.logSet({
    exercise: "push-ups",
    actual_reps: 20,
    rpe: 7
  });
  assert.equal(first.ok, true);
  assert.equal(controller.publicState().phase, "ready_for_rest");

  const rest = controller.startRestTimer({ seconds: 30, label: "demo rest" });
  assert.equal(rest.ok, true);
  assert.equal(controller.publicState().phase, "resting");

  controller.markRestBanter("Yeah, give me the SpaceX update.");
  await wait(30);

  assert.equal(timerTriggered, true);
  assert.equal(controller.publicState().phase, "active_set");

  const second = controller.logSet({
    exercise: "squats",
    actual_reps: 30,
    note: "knee discomfort"
  });
  assert.equal(second.ok, true);

  const updated = controller.updatePlan({
    reason: "knee discomfort",
    replacement_exercise: "plank",
    duration_seconds: 30,
    note: "low-impact fallback"
  });
  assert.equal(updated.ok, true);
  assert.equal(controller.publicState().workout_plan[2].exercise, "plank");

  const third = controller.logSet({
    exercise: "plank",
    duration_seconds: 30
  });
  assert.equal(third.ok, true);

  const state = controller.publicState();
  assert.equal(state.phase, "completed");
  assert.equal(state.summary_payload.completed_sets.length, 3);
  assert.deepEqual(state.summary_payload.export_targets, [
    "Heavy",
    "Strava",
    "Apple Health"
  ]);
  assert.equal(state.summary_payload.coach_events.includes("started_rest_timer"), true);
  assert.equal(state.summary_payload.coach_events.includes("continued_contextual_banter"), true);
  assert.equal(state.summary_payload.coach_events.includes("redirected_after_timer"), true);
  assert.equal(state.summary_payload.coach_events.includes("adapted_for_discomfort"), true);

  console.log(`scenario_${iteration}: ok`);
}

for (let i = 1; i <= 3; i += 1) {
  await runScenario(i);
}

console.log("smoke_test: 3/3 scenarios passed");
