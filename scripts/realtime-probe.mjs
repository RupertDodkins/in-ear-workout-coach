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

async function sendTextTurn(manager, text) {
  await manager.waitForResponseIdle();
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
  await manager.createResponse();
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
try {
  await waitFor(
    () => manager.getState().phase === "resting" && manager.getState().completed_sets.length === 1,
    "the first set log and rest timer"
  );
} catch (error) {
  console.log("probe_first_set_state:", JSON.stringify(manager.getState(), null, 2));
  throw error;
}
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

await sendTextTurn(manager, "Actually, I only have 3 minutes now.");
try {
  await waitFor(
    () =>
      manager.getState().phase === "active_set" &&
      manager.getState().workout_plan[1]?.target_reps === 20 &&
      manager.getState().coach_events.includes("compressed_for_time"),
    "the time-compression replan"
  );
  console.log(
    "probe_after_compression:",
    JSON.stringify(
      {
        phase: manager.getState().phase,
        current_step: manager.getState().workout_plan[manager.getState().current_step_index],
        coach_events: manager.getState().coach_events
      },
      null,
      2
    )
  );
} catch (error) {
  console.log("probe_compression_state:", JSON.stringify(manager.getState(), null, 2));
  throw error;
}

try {
  await waitFor(
    () => /squats|20 reps|shorten|3 minutes/i.test(lastAssistantLine(manager.getState())),
    "the spoken compression redirect",
    10000
  );
  console.log("probe_after_compression_line:", lastAssistantLine(manager.getState()));
} catch {
  await wait(1500);
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

try {
  await waitFor(
    () => /plank/i.test(lastAssistantLine(manager.getState())),
    "the spoken plank instruction",
    10000
  );
} catch {
  await wait(1500);
}

await wait(1000);

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
