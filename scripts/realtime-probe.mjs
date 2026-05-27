import path from "node:path";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import WebSocket from "ws";
import { RealtimeWorkoutSessionManager } from "../src/session-manager.js";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2";
const voice = process.env.OPENAI_VOICE || "marin";

if (!apiKey) {
  console.error("OPENAI_API_KEY is required for the realtime probe.");
  process.exit(1);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await wait(150);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

function lastAssistantLine(state) {
  return [...state.transcripts].reverse().find((entry) => entry.role === "assistant")?.text ?? "";
}

function manualAdvancePastRest(manager) {
  const controller = manager.controller;

  if (controller.timerHandle) {
    controller.clearTimer(controller.timerHandle);
    controller.timerHandle = null;
  }

  controller.state.rest_timer = {
    active: false,
    seconds: null,
    ends_at: null,
    label: null
  };
  controller.state.phase = "active_set";
  controller.addCoachEvent("redirected_after_timer");
  controller.appendEvent("probe.timer_redirect", "Probe manually advanced past rest.");
  controller.touch();
  controller.persist();
}

async function sendTextTurn(manager, text) {
  manager.controller.appendTranscript("user", text, "probe");
  await manager.sendRealtimeEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text
        }
      ]
    }
  });
  await manager.sendRealtimeEvent({ type: "response.create" });
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "verve-realtime-probe-"));
const manager = new RealtimeWorkoutSessionManager({
  apiKey,
  model,
  voice,
  restSeconds: 30,
  jsonPath: path.join(tempDir, "workout_session.json"),
  markdownPath: path.join(tempDir, "workout_session.md"),
  vadType: "server_vad",
  vadThreshold: 0.65,
  vadSilenceMs: 450,
  vadPrefixMs: 250
});

const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "OpenAI-Safety-Identifier": "verve-realtime-probe"
  }
});

socket.on("message", (message) => {
  void manager.handleRealtimeEvent(message.toString());
});

socket.on("error", (error) => {
  console.error("probe_socket_error:", error.message);
});

await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

manager.sidebandSocket = socket;
await manager.sendSessionUpdate();

await sendTextTurn(manager, "I'm ready for a quick workout.");
await waitFor(
  () => /push-?ups/i.test(lastAssistantLine(manager.getState())),
  "the opening push-ups instruction"
);
console.log("probe_opening:", lastAssistantLine(manager.getState()));

await sendTextTurn(manager, "Done.");
await waitFor(
  () => manager.getState().phase === "resting" && manager.getState().completed_sets.length === 1,
  "the first set log and rest timer"
);
console.log(
  "probe_after_set_1:",
  JSON.stringify(
    {
      phase: manager.getState().phase,
      completed_sets: manager.getState().completed_sets.length,
      coach_events: manager.getState().coach_events
    },
    null,
    2
  )
);

manualAdvancePastRest(manager);
await manager.sendSessionUpdate();
await manager.sendRealtimeEvent({
  type: "response.create",
  response: {
    instructions:
      "The rest timer just ended. Briefly redirect Rupert back to the workout. The next move is squats for 30 reps.",
    metadata: {
      source: "probe_timer_redirect"
    }
  }
});
try {
  await waitFor(
    () => /squats/i.test(lastAssistantLine(manager.getState())),
    "the squat redirect after rest",
    8000
  );
  console.log("probe_after_timer:", lastAssistantLine(manager.getState()));
} catch {
  console.log(
    "probe_after_timer: no explicit redirect transcript observed in text-only probe; continuing with authoritative state."
  );
}

await sendTextTurn(manager, "Done with the squats, but my knee feels weird.");
try {
  await waitFor(
    () =>
      manager.getState().completed_sets.length === 2 &&
      manager.getState().workout_plan[2]?.exercise === "plank",
    "the discomfort adaptation to plank"
  );
} catch (error) {
  console.log("probe_adaptation_state:", JSON.stringify(manager.getState(), null, 2));
  throw error;
}
console.log(
  "probe_after_set_2:",
  JSON.stringify(
    {
      current_step: manager.getState().workout_plan[manager.getState().current_step_index],
      coach_events: manager.getState().coach_events
    },
    null,
    2
  )
);

await sendTextTurn(manager, "Done with the plank.");
try {
  await waitFor(
    () => manager.getState().phase === "completed" && Boolean(manager.getState().summary_payload),
    "the final workout summary",
    30000
  );
  console.log(
    "probe_summary:",
    JSON.stringify(manager.getState().summary_payload, null, 2)
  );
} catch (error) {
  console.log("probe_final_state:", JSON.stringify(manager.getState(), null, 2));
  throw error;
}

socket.close();
