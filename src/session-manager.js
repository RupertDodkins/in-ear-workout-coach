import WebSocket from "ws";
import { DemoController } from "./demo-controller.js";
import { buildCoachInstructions } from "./prompt.js";

const TOOL_DEFS = [
  {
    type: "function",
    name: "log_set",
    description:
      "Log completion of the current workout move with reps, weight, duration, RPE, and brief notes.",
    parameters: {
      type: "object",
      properties: {
        exercise: {
          type: "string",
          description: "Exercise name the coach believes Rupert just completed."
        },
        actual_reps: {
          type: "number",
          description: "Reps Rupert actually completed."
        },
        duration_seconds: {
          type: "number",
          description: "Duration Rupert completed for timed moves."
        },
        weight_lbs: {
          type: "number",
          description: "Optional external load in pounds."
        },
        rpe: {
          type: "number",
          description: "Approximate effort on a 1-10 scale."
        },
        note: {
          type: "string",
          description: "Short note like hard, knee discomfort, or modified."
        }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "start_rest_timer",
    description:
      "Start a non-blocking rest timer while the coach can keep talking.",
    parameters: {
      type: "object",
      properties: {
        seconds: {
          type: "number",
          description: "Rest duration in seconds."
        },
        label: {
          type: "string",
          description: "Short label for the timer."
        }
      },
      required: ["seconds"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "update_plan",
    description:
      "Modify the next workout step when Rupert reports discomfort or a safer substitution is needed.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Reason for the change, such as knee discomfort."
        },
        replacement_exercise: {
          type: "string",
          description: "Low-impact replacement exercise."
        },
        duration_seconds: {
          type: "number",
          description: "Replacement duration in seconds for timed moves."
        },
        note: {
          type: "string",
          description: "Short coaching note about the adaptation."
        }
      },
      required: ["reason"],
      additionalProperties: false
    }
  }
];

function parseMaybeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function toolPriority(name) {
  switch (name) {
    case "log_set":
      return 1;
    case "start_rest_timer":
      return 2;
    case "update_plan":
      return 3;
    default:
      return 99;
  }
}

export class RealtimeWorkoutSessionManager {
  constructor({
    apiKey,
    model,
    voice,
    restSeconds,
    jsonPath,
    markdownPath,
    vadType,
    vadThreshold,
    vadSilenceMs,
    vadPrefixMs
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.voice = voice;
    this.vadType = vadType;
    this.vadThreshold = vadThreshold;
    this.vadSilenceMs = vadSilenceMs;
    this.vadPrefixMs = vadPrefixMs;

    this.sidebandSocket = null;
    this.callId = null;
    this.activeResponseId = null;
    this.responseInFlight = false;
    this.paused = false;
    this.controller = new DemoController({
      jsonPath,
      markdownPath,
      restSeconds,
      onTimerExpired: () => {
        void this.handleTimerExpired();
      }
    });
  }

  getState() {
    return this.controller.publicState();
  }

  async reset() {
    await this.closeSideband("reset");
    this.callId = null;
    this.activeResponseId = null;
    this.responseInFlight = false;
    this.paused = false;
    this.controller.reset();
  }

  async pauseVoice() {
    if (!this.sidebandSocket) {
      throw new Error("Live Realtime session is not connected.");
    }
    this.paused = true;
    await this.interruptActiveResponse();
    // Push turn_detection=null so the API stops transcribing and auto-responding,
    // then drop any audio already buffered server-side.
    await this.sendSessionUpdate();
    await this.sendRealtimeEvent({ type: "input_audio_buffer.clear" });
    this.controller.setConnection(this.controller.publicState().connection.status, {
      paused: true
    });
    this.controller.appendEvent("voice.paused", "Voice paused by user.");
    this.controller.persist();
  }

  async resumeVoice() {
    if (!this.sidebandSocket) {
      throw new Error("Live Realtime session is not connected.");
    }
    this.paused = false;
    // Restore turn_detection so the API resumes processing mic input.
    await this.sendSessionUpdate();
    this.controller.setConnection(this.controller.publicState().connection.status, {
      paused: false
    });
    this.controller.appendEvent("voice.resumed", "Voice resumed by user.");
    this.controller.persist();
  }

  async endSession() {
    this.controller.endSession();
  }

  async createWebRtcSession(offerSdp) {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not set.");
    }

    await this.closeSideband("new_session");
    this.controller.reset();
    this.controller.setConnection("connecting", {
      model: this.model,
      voice: this.voice,
      last_error: null
    });

    const form = new FormData();
    form.set("sdp", offerSdp);
    form.set("session", JSON.stringify(this.buildSessionConfig()));

    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "OpenAI-Safety-Identifier": "in-ear-workout-coach-voice-hack-night-demo"
      },
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.controller.setConnection("error", { last_error: errorText });
      throw new Error(`Failed to create realtime call: ${errorText}`);
    }

    const answerSdp = await response.text();
    const location = response.headers.get("Location");
    const callId = location?.split("/").pop();

    if (!callId) {
      throw new Error("OpenAI realtime call response did not include a call ID.");
    }

    this.callId = callId;
    await this.connectSideband(callId);

    this.controller.setConnection("live", {
      call_id: callId,
      model: this.model,
      voice: this.voice
    });
    this.controller.appendEvent(
      "realtime.session.ready",
      "Browser voice session is connected.",
      { call_id: callId }
    );
    this.controller.persist();

    return {
      answerSdp,
      callId
    };
  }

  buildSessionConfig() {
    // While paused, disable server VAD entirely so incoming mic audio is
    // neither transcribed nor used to auto-create responses.
    const turn_detection = this.paused
      ? null
      : this.vadType === "server_vad"
        ? {
            type: "server_vad",
            threshold: this.vadThreshold,
            prefix_padding_ms: this.vadPrefixMs,
            silence_duration_ms: this.vadSilenceMs,
            create_response: true,
            interrupt_response: true
          }
        : {
            type: "semantic_vad",
            eagerness: "high",
            create_response: true,
            interrupt_response: true
          };

    return {
      type: "realtime",
      model: this.model,
      audio: {
        output: {
          voice: this.voice
        },
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe"
          },
          turn_detection
        }
      },
      instructions: buildCoachInstructions(this.controller.publicState()),
      tools: TOOL_DEFS
    };
  }

  async connectSideband(callId) {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `wss://api.openai.com/v1/realtime?call_id=${callId}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        }
      );

      let settled = false;

      socket.on("open", () => {
        this.sidebandSocket = socket;
        this.controller.appendEvent(
          "realtime.sideband.open",
          "Sideband control channel connected."
        );
        void this.sendSessionUpdate();
        settled = true;
        resolve();
      });

      socket.on("message", (message) => {
        void this.handleRealtimeEvent(message.toString());
      });

      socket.on("error", (error) => {
        this.controller.appendEvent(
          "realtime.sideband.error",
          "Sideband error.",
          { message: error.message }
        );
        this.controller.setConnection("error", { last_error: error.message });
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      socket.on("close", (code, reasonBuffer) => {
        const reason = reasonBuffer?.toString() || "closed";
        this.controller.appendEvent(
          "realtime.sideband.close",
          `Sideband closed (${code}).`,
          { code, reason }
        );
        if (this.sidebandSocket === socket) {
          this.sidebandSocket = null;
        }
      });
    });
  }

  async closeSideband(reason = "manual") {
    if (!this.sidebandSocket) {
      return;
    }

    const socket = this.sidebandSocket;
    this.sidebandSocket = null;
    this.activeResponseId = null;
    this.controller.appendEvent("realtime.sideband.close_request", `Closing sideband: ${reason}.`);

    await new Promise((resolve) => {
      socket.once("close", () => resolve());
      socket.close();
      setTimeout(resolve, 250);
    });
  }

  async sendSessionUpdate() {
    await this.sendRealtimeEvent({
      type: "session.update",
      session: this.buildSessionConfig()
    });
  }

  async sendFallbackTextTurn(text) {
    if (!this.sidebandSocket) {
      throw new Error("Live Realtime session is not connected.");
    }

    if (this.controller.publicState().phase === "resting") {
      this.controller.markRestBanter(text);
    }

    this.controller.appendTranscript("user", text, "fallback_text");

    await this.interruptActiveResponse();
    await this.sendRealtimeEvent({
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
    await this.createResponse();
  }

  async interruptActiveResponse() {
    if (this.activeResponseId || this.responseInFlight) {
      await this.sendRealtimeEvent({ type: "response.cancel" });
      await this.sendRealtimeEvent({ type: "output_audio_buffer.clear" });
      await this.waitForResponseIdle();
    }
  }

  async createResponse(payload = null) {
    await this.waitForResponseIdle();
    this.responseInFlight = true;
    const event = payload
      ? { type: "response.create", response: payload }
      : { type: "response.create" };
    try {
      await this.sendRealtimeEvent(event);
    } catch (error) {
      this.responseInFlight = false;
      throw error;
    }
  }

  async handleTimerExpired() {
    if (!this.sidebandSocket) {
      return;
    }
    if (this.paused) {
      this.controller.appendEvent(
        "voice.paused_skip",
        "Rest timer expired while paused; skipping coach prompt."
      );
      return;
    }

    const state = this.controller.publicState();
    const nextStep = state.workout_plan[state.current_step_index] ?? null;
    if (!nextStep) {
      return;
    }

    await this.interruptActiveResponse();
    await this.sendSessionUpdate();
    await this.createResponse({
      instructions: `The rest timer just ended. Briefly cut off the banter and direct Rupert back to the workout immediately. The next move is ${nextStep.exercise}. ${
        nextStep.target_reps != null
          ? `Tell him to do ${nextStep.target_reps} reps.`
          : `Tell him to do ${nextStep.duration_seconds} seconds.`
      } One sentence if possible.`,
      metadata: {
        source: "rest_timer_complete"
      }
    });
  }

  async handleRealtimeEvent(rawMessage) {
    const event = parseMaybeJson(rawMessage);
    if (!event?.type) {
      return;
    }

    switch (event.type) {
      case "response.created":
        this.activeResponseId = event.response?.id ?? "active";
        this.responseInFlight = true;
        break;
      case "response.cancelled":
        this.activeResponseId = null;
        this.responseInFlight = false;
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.controller.appendTranscript("user", event.transcript, "voice");
        break;
      case "response.output_audio_transcript.done":
      case "response.output_text.done":
        this.controller.appendTranscript("assistant", event.transcript ?? event.text, "voice");
        break;
      case "error": {
        const code = event.error?.code;
        const transient =
          code === "conversation_already_has_active_response" ||
          code === "response_cancel_not_active";
        if (transient) {
          if (code === "response_cancel_not_active") {
            this.activeResponseId = null;
            this.responseInFlight = false;
          }
          break;
        }
        this.controller.appendEvent("realtime.error", "Realtime API error.", event.error ?? event);
        if (event.error?.message) {
          this.controller.setConnection("error", {
            last_error: event.error.message
          });
        }
        break;
      }
      case "response.done":
        this.activeResponseId = null;
        this.responseInFlight = false;
        await this.handleResponseDone(event.response);
        break;
      default:
        break;
    }
  }

  async handleResponseDone(response = {}) {
    const functionCalls = (response.output ?? [])
      .filter((item) => item.type === "function_call")
      .sort((left, right) => toolPriority(left.name) - toolPriority(right.name));

    if (functionCalls.length === 0) {
      return;
    }

    const results = [];
    const hadLogSet = functionCalls.some((call) => call.name === "log_set");
    const hadRestTimer = functionCalls.some((call) => call.name === "start_rest_timer");

    for (const call of functionCalls) {
      const args = parseMaybeJson(call.arguments);
      const result = await this.executeToolCall(call.name, args);
      results.push({ call, result });
      await this.sendRealtimeEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
        }
      });
    }

    let guardStartedRest = false;
    let state = this.controller.publicState();
    if (hadLogSet && !hadRestTimer && state.phase === "ready_for_rest") {
      this.controller.appendEvent(
        "guard.start_rest_timer",
        "Model skipped start_rest_timer; server started the planned rest timer."
      );
      this.controller.startRestTimer({
        seconds: this.controller.restSeconds,
        label: "Rest"
      });
      guardStartedRest = true;
      state = this.controller.publicState();
    }

    await this.sendSessionUpdate();

    const followup =
      state.phase === "completed"
        ? {
            instructions:
              "Workout complete. Give a crisp spoken summary using the authoritative summary payload, mention the export targets, and stop.",
            metadata: { source: "summary_followup" }
          }
        : guardStartedRest
          ? {
              instructions:
                "The set is logged and the rest timer is now running. Tell Rupert to take 30 seconds, keep it brief, and offer one short SpaceX banter line.",
              metadata: { source: "guard_rest_followup" }
            }
        : {
            metadata: { source: "tool_followup" }
          };

    await this.createResponse(followup);
  }

  async executeToolCall(name, args) {
    switch (name) {
      case "log_set":
        return this.controller.logSet(args);
      case "start_rest_timer":
        return this.controller.startRestTimer(args);
      case "update_plan":
        return this.controller.updatePlan(args);
      default:
        return {
          ok: false,
          error: `Unknown tool: ${name}`
        };
    }
  }

  async sendRealtimeEvent(event) {
    if (!this.sidebandSocket || this.sidebandSocket.readyState !== WebSocket.OPEN) {
      throw new Error("Sideband socket is not open.");
    }

    this.sidebandSocket.send(JSON.stringify(event));
  }

  async waitForResponseIdle(timeoutMs = 2500) {
    const start = Date.now();

    while ((this.activeResponseId || this.responseInFlight) && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (Date.now() - start >= timeoutMs) {
      this.activeResponseId = null;
      this.responseInFlight = false;
    }
  }
}
