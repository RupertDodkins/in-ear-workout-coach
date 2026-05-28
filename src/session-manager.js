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
  },
  {
    type: "function",
    name: "compress_remaining_workout",
    description:
      "Shorten the remaining workout when Rupert has less time than expected, including skipping the current rest if needed.",
    parameters: {
      type: "object",
      properties: {
        minutes_left: {
          type: "number",
          description: "Approximate minutes Rupert has left for the workout."
        },
        seconds_left: {
          type: "number",
          description:
            "Approximate seconds Rupert has left when the remaining time is under a minute."
        },
        reason: {
          type: "string",
          description: "Short reason for the compression, such as time constraint."
        }
      },
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
    case "compress_remaining_workout":
      return 3;
    case "update_plan":
      return 4;
    default:
      return 99;
  }
}

function formatStep(step) {
  if (!step) {
    return "the workout";
  }

  if (typeof step.target_reps === "number") {
    return `${step.exercise} for ${step.target_reps} reps`;
  }

  return `${step.exercise} for ${step.duration_seconds} seconds`;
}

function extractAssistantTextFromResponse(response = {}) {
  const messageTexts = [];

  for (const item of response.output ?? []) {
    if (item?.type !== "message" || item?.role !== "assistant") {
      continue;
    }

    const content = Array.isArray(item.content) ? item.content : [];
    const transcriptParts = content
      .map((part) => part?.transcript?.trim())
      .filter(Boolean);

    if (transcriptParts.length > 0) {
      messageTexts.push(transcriptParts.join(" "));
      continue;
    }

    const textParts = content
      .map((part) => part?.text?.trim())
      .filter(Boolean);

    if (textParts.length > 0) {
      messageTexts.push(textParts.join(" "));
    }
  }

  return messageTexts.join(" ").trim();
}

function normalizeTranscript(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFillerTranscript(text) {
  const normalized = normalizeTranscript(text);
  if (!normalized) {
    return true;
  }

  const fillerOnly =
    /^(um+|uh+|erm+|hmm+|mm+|ah+|any um|ok um|okay um|so um|like)$/.test(normalized);
  if (fillerOnly) {
    return true;
  }

  const tokens = normalized.split(" ");
  const fillerWords = new Set(["um", "uh", "erm", "hmm", "mm", "ah", "like"]);
  return tokens.length <= 2 && tokens.every((token) => fillerWords.has(token));
}

function isAcknowledgementTranscript(text) {
  const normalized = normalizeTranscript(text);
  return /^(ok|okay|ok thanks|okay thanks|got it|sounds good|all right|alright|sure|yep|yeah|cool|nice|thanks|thank you|screen on|screen off)$/.test(
    normalized
  );
}

function isProgressTranscript(text) {
  const normalized = normalizeTranscript(text);
  return (
    normalized === "doing them" ||
    normalized === "on it" ||
    normalized === "starting now" ||
    ((/\b(i m|im|i am)\b/.test(normalized) || /^okay i m\b/.test(normalized)) &&
      /\b(doing|starting|working)\b/.test(normalized))
  );
}

function isCompletionTranscript(text) {
  const normalized = normalizeTranscript(text);
  return (
    /\b(done|finished|complete|completed)\b/.test(normalized) ||
    /\b(that|it)\s+(was\s+)?(hard|rough|tough)\b/.test(normalized)
  );
}

function isDiscomfortTranscript(text) {
  const normalized = normalizeTranscript(text);
  return /\b(knee|pain|hurt|hurts|weird|strain|twinge|discomfort|sore)\b/.test(
    normalized
  );
}

function isTimeConstraintTranscript(text) {
  const normalized = normalizeTranscript(text);
  return (
    /\b\d+\s*(second|seconds|sec|secs|minute|minutes|min|mins)\b/.test(normalized) ||
    /\b(less time|time got cut|need to leave|got to go|make .* shorter|shorten|quick wrap|wrap up|only have|end early|stop early|finish early|wrap now)\b/.test(
      normalized
    )
  );
}

function isFormQuestionTranscript(text) {
  const normalized = normalizeTranscript(text);
  return (
    /\bform\b/.test(normalized) ||
    /\b(should my|how s my|how should|am i|butt|hips|knees|heels|toes|core|back|chest)\b/.test(
      normalized
    )
  );
}

function isOpenAiTopicTranscript(text) {
  const normalized = normalizeTranscript(text);
  return /\b(openai|realtime|real time|voice api|webrtc|latency|transcribe|transcription|barge in|interrupt)\b/.test(
    normalized
  );
}

function isCheckInTranscript(text) {
  const normalized = normalizeTranscript(text);
  return (
    /\b(can you hear me|are you there|mic test|check check|audio check)\b/.test(
      normalized
    ) ||
    /^(hello|hello coach|hey coach|yo coach|coach)\b/.test(normalized)
  );
}

function isStartWorkoutTranscript(text) {
  const normalized = normalizeTranscript(text);
  return (
    /\b(i m ready|im ready|i am ready|ready to start|let s start|lets start|start workout|start the workout|begin workout|begin the workout)\b/.test(
      normalized
    ) ||
    /\b(what workout should i do|what should i do today|what should i do|what s first|whats first|what move should i do|what exercise should i do|quick workout)\b/.test(
      normalized
    )
  );
}

function hasWakeWordTranscript(text) {
  const normalized = normalizeTranscript(text);
  return /\b(coach|rupert|verve)\b/.test(normalized);
}

function isJokeTranscript(text) {
  const normalized = normalizeTranscript(text);
  return /\b(joke|funny|banter|laugh)\b/.test(normalized);
}

function hasWorkoutKeywords(text) {
  const normalized = normalizeTranscript(text);
  return /\b(workout|start|ready|push up|pushups|push ups|squat|squats|plank|mountain climber|mountain climbers|rep|reps|rest|timer|done|finished|knee|pain|hurt|minutes|minute|seconds|second|form|elbow|elbows|shoulder|shoulders|core|hips|heels|toes|feet|ground|floor|chest)\b/.test(
    normalized
  );
}

function looksLikeAmbientTranscript(text) {
  const normalized = normalizeTranscript(text);
  if (!normalized) {
    return true;
  }

  const tokens = normalized.split(" ");
  if (tokens.length === 1 && tokens[0].length <= 3) {
    return true;
  }

  const alphaOnly = normalized.replace(/[^a-z]/g, "");
  if (alphaOnly.length > 0 && alphaOnly.length <= 4 && !hasWorkoutKeywords(normalized)) {
    return true;
  }

  return false;
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
    this.orchestrationLock = false;
    this.paused = false;
    this.pendingVoiceTranscript = null;
    this.lastAcceptedVoiceTranscript = null;
    this.lastAcceptedVoiceAt = 0;
    this.lastAssistantResponseAt = 0;
    this.lastAcceptedVoiceIntent = null;
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

  logClientEvent(type, message, data = null) {
    this.controller.appendEvent(type, message, data);
    this.controller.persist();
  }

  async reset() {
    await this.closeSideband("reset");
    this.callId = null;
    this.activeResponseId = null;
    this.responseInFlight = false;
    this.orchestrationLock = false;
    this.paused = false;
    this.pendingVoiceTranscript = null;
    this.lastAcceptedVoiceTranscript = null;
    this.lastAcceptedVoiceAt = 0;
    this.lastAssistantResponseAt = 0;
    this.lastAcceptedVoiceIntent = null;
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
            create_response: false,
            interrupt_response: false
          }
        : {
            type: "semantic_vad",
            eagerness: "high",
            create_response: false,
            interrupt_response: false
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

  async createResponse(payload = null, { skipIdleWait = false } = {}) {
    if (!skipIdleWait) {
      await this.waitForResponseIdle();
    }
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

  buildVoiceTurnRoute(text, normalized = normalizeTranscript(text)) {
    const state = this.controller.publicState();
    const phase = state.phase;
    const currentStep = state.workout_plan[state.current_step_index] ?? null;
    const currentStepText = formatStep(currentStep);
    const restEndsAt = state.rest_timer?.ends_at
      ? new Date(state.rest_timer.ends_at).getTime()
      : null;
    const remainingRestSeconds = restEndsAt
      ? Math.max(1, Math.ceil((restEndsAt - Date.now()) / 1000))
      : state.rest_timer?.seconds ?? null;
    const restCue = remainingRestSeconds
      ? `about ${remainingRestSeconds} more seconds`
      : "the timer ends";

    if (isAcknowledgementTranscript(normalized)) {
      return {
        action: "ignore",
        kind: "acknowledgement",
        message: "Ignored acknowledgement-only voice transcript."
      };
    }

    if (phase === "awaiting_start" && isCheckInTranscript(normalized)) {
      return {
        action: "respond",
        kind: "startup_checkin",
        acceptMessage: "Responding to a startup check-in.",
        responsePayload: {
          instructions:
            "Rupert is checking whether the coach is listening before the workout begins. In one short sentence, confirm you are here and tell him to say he is ready for a quick workout to start. Do not call tools.",
          metadata: {
            source: "startup_checkin"
          }
        }
      };
    }

    if (
      (phase === "active_set" || phase === "ready_for_rest") &&
      isProgressTranscript(normalized)
    ) {
      return {
        action: "ignore",
        kind: "progress",
        message: "Ignored in-progress voice transcript."
      };
    }

    if (phase === "completed") {
      return {
        action: "respond",
        kind: "completed_followup",
        acceptMessage: "Responding after workout completion.",
        responsePayload: {
          instructions:
            "The workout is already complete. Give one short helpful sentence, do not restart the workout, and do not call tools.",
          metadata: {
            source: "completed_followup"
          }
        }
      };
    }

    if (phase === "active_set" || phase === "ready_for_rest") {
      if (isTimeConstraintTranscript(normalized)) {
        return {
          action: "respond",
          kind: "time_constraint_update",
          acceptMessage:
            "Creating assistant response for a time-constraint update.",
          intent: {
            wantsCompression: true
          }
        };
      }

      if (isDiscomfortTranscript(normalized)) {
        return {
          action: "respond",
          kind: "discomfort_update",
          acceptMessage:
            "Creating assistant response for a discomfort update.",
          intent: {
            wantsLogSet: true,
            wantsFallback: true,
            logNote: "knee discomfort"
          }
        };
      }

      if (isCompletionTranscript(normalized)) {
        return {
          action: "respond",
          kind: "completion_update",
          acceptMessage:
            "Creating assistant response for a completion update.",
          intent: {
            wantsLogSet: true
          }
        };
      }

      if (isFormQuestionTranscript(normalized)) {
        return {
          action: "respond",
          kind: "active_set_form_redirect",
          acceptMessage: "Answering a short form question during the active set.",
          responsePayload: {
            instructions: `Rupert is in the middle of ${currentStepText}. Give one short practical form cue for ${currentStep?.exercise ?? "the current move"} and immediately redirect him back to ${currentStepText}. Do not log the set, do not change the plan, and do not call tools.`,
            metadata: {
              source: "active_set_form_redirect"
            }
          }
        };
      }

      return {
        action: "ignore",
        kind: "active_set_off_topic_ignore",
        message:
          "Ignored off-topic or ambient transcript during the active set."
      };
    }

    if (phase === "resting") {
      if (isTimeConstraintTranscript(normalized)) {
        return {
          action: "respond",
          kind: "rest_compression",
          acceptMessage:
            "Creating assistant response for a rest-time constraint update.",
          intent: {
            wantsCompression: true
          }
        };
      }

      if (isOpenAiTopicTranscript(normalized)) {
        return {
          action: "respond",
          kind: "rest_banter",
          markRestBanter: true,
          acceptMessage: "Answering a brief OpenAI voice API rest prompt.",
          responsePayload: {
            instructions: `Rupert is resting before ${currentStepText}. Give one short, concrete sentence about the OpenAI voice or realtime API, then remind him you will cue ${currentStepText} when the timer ends in ${restCue}. Do not call tools.`,
            metadata: {
              source: "rest_banter_redirect"
            }
          }
        };
      }

      if (isJokeTranscript(normalized)) {
        return {
          action: "respond",
          kind: "rest_joke",
          markRestBanter: true,
          acceptMessage: "Answering an explicit joke request during rest.",
          responsePayload: {
            instructions: `Rupert is resting before ${currentStepText}. Give exactly one short joke or light banter line, then remind him you will cue ${currentStepText} when the timer ends in ${restCue}. Do not call tools.`,
            metadata: {
              source: "rest_joke_redirect"
            }
          }
        };
      }

      return {
        action: "ignore",
        kind: "rest_off_topic_ignore",
        message: "Ignored off-topic or ambient transcript during rest."
      };
    }

    return {
      action: "respond",
      kind: "standard",
      acceptMessage: "Creating assistant response for completed voice transcript."
    };
  }

  async maybeRespondToVoiceTranscript(text) {
    const normalized = normalizeTranscript(text);
    const now = Date.now();

    if (!normalized) {
      return;
    }

    if (isFillerTranscript(text)) {
      this.controller.appendEvent(
        "realtime.turn.ignored",
        "Ignored filler-only voice transcript.",
        { transcript: text }
      );
      return;
    }

    if (looksLikeAmbientTranscript(text)) {
      this.controller.appendEvent(
        "realtime.turn.ignored",
        "Ignored short ambient transcript.",
        { transcript: text }
      );
      return;
    }

    const state = this.controller.publicState();
    const phase = state.phase;
    const hasWorkoutSignal =
      isStartWorkoutTranscript(normalized) ||
      isCheckInTranscript(normalized) ||
      hasWorkoutKeywords(normalized) ||
      isCompletionTranscript(normalized) ||
      isDiscomfortTranscript(normalized) ||
      isTimeConstraintTranscript(normalized) ||
      isFormQuestionTranscript(normalized) ||
      isOpenAiTopicTranscript(normalized) ||
      isJokeTranscript(normalized);
    const hasWakeWord = hasWakeWordTranscript(normalized);

    if (phase === "awaiting_start" && !hasWorkoutSignal && !hasWakeWord) {
      this.controller.appendEvent(
        "realtime.turn.ignored",
        "Ignored ambient transcript before workout start.",
        { transcript: text }
      );
      return;
    }

    if ((phase === "active_set" || phase === "ready_for_rest" || phase === "resting") &&
      !hasWorkoutSignal &&
      !hasWakeWord) {
      this.controller.appendEvent(
        "realtime.turn.ignored",
        "Ignored ambient transcript with no workout signal.",
        { transcript: text, phase }
      );
      return;
    }

    const duplicateRecent =
      normalized === this.lastAcceptedVoiceTranscript &&
      now - this.lastAcceptedVoiceAt < 5000;
    if (duplicateRecent) {
      this.controller.appendEvent(
        "realtime.turn.ignored",
        "Ignored duplicate voice transcript.",
        { transcript: text }
      );
      return;
    }

    const route = this.buildVoiceTurnRoute(text, normalized);
    if (route.action === "ignore") {
      this.controller.appendEvent(
        "realtime.turn.ignored",
        route.message,
        { transcript: text, route: route.kind }
      );
      return;
    }

    if (this.activeResponseId || this.responseInFlight || this.orchestrationLock) {
      this.pendingVoiceTranscript = { text, normalized, ts: now, route };
      this.controller.appendEvent(
        "realtime.turn.queued",
        "Queued voice transcript until the active response finishes.",
        { transcript: text, route: route.kind }
      );
      return;
    }

    await this.respondToVoiceTranscript(text, normalized, now, route);
  }

  async respondToVoiceTranscript(
    text,
    normalized = normalizeTranscript(text),
    now = Date.now(),
    route = null
  ) {
    const chosenRoute = route ?? {
      action: "respond",
      kind: "standard",
      acceptMessage: "Creating assistant response for completed voice transcript."
    };
    this.lastAcceptedVoiceTranscript = normalized;
    this.lastAcceptedVoiceAt = now;
    this.lastAcceptedVoiceIntent = chosenRoute.intent ?? null;
    this.pendingVoiceTranscript = null;
    if (chosenRoute.markRestBanter) {
      this.controller.markRestBanter(text);
    }
    this.controller.appendEvent(
      "realtime.turn.accepted",
      chosenRoute.acceptMessage,
      { transcript: text, route: chosenRoute.kind }
    );
    await this.sendSessionUpdate();
    await this.createResponse(chosenRoute.responsePayload ?? null);
  }

  async flushPendingVoiceTranscript() {
    if (!this.pendingVoiceTranscript || this.activeResponseId || this.responseInFlight) {
      return;
    }

    const pending = this.pendingVoiceTranscript;
    this.pendingVoiceTranscript = null;
    await this.respondToVoiceTranscript(
      pending.text,
      pending.normalized,
      pending.ts,
      pending.route
    );
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
        this.controller.appendEvent(
          "realtime.response.created",
          "Assistant response started.",
          {
            response_id: this.activeResponseId,
            output_count: Array.isArray(event.response?.output)
              ? event.response.output.length
              : 0
          }
        );
        break;
      case "response.cancelled":
        this.controller.appendEvent(
          "realtime.response.cancelled",
          "Assistant response cancelled.",
          {
            response_id: this.activeResponseId
          }
        );
        this.activeResponseId = null;
        this.responseInFlight = false;
        this.orchestrationLock = false;
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.controller.appendEvent(
          "realtime.input.transcript",
          "User transcription completed.",
          {
            transcript: event.transcript,
            item_id: event.item_id ?? null
          }
        );
        this.controller.appendTranscript("user", event.transcript, "voice");
        await this.maybeRespondToVoiceTranscript(event.transcript);
        break;
      case "response.output_audio_transcript.done":
        this.controller.appendEvent(
          "realtime.output_audio_transcript.done",
          "Assistant audio transcript segment completed.",
          {
            response_id: event.response_id ?? this.activeResponseId,
            item_id: event.item_id ?? null,
            transcript: event.transcript ?? null
          }
        );
        break;
      case "response.output_text.done":
        this.controller.appendEvent(
          "realtime.output_text.done",
          "Assistant text segment completed.",
          {
            response_id: event.response_id ?? this.activeResponseId,
            item_id: event.item_id ?? null,
            text: event.text ?? null
          }
        );
        break;
      case "error": {
        const code = event.error?.code;
        const transient =
          code === "conversation_already_has_active_response" ||
          code === "response_cancel_not_active";
        if (transient) {
          this.controller.appendEvent(
            "realtime.transient",
            "Transient realtime event.",
            event.error ?? event
          );
          if (code === "response_cancel_not_active") {
            this.activeResponseId = null;
            this.responseInFlight = false;
            this.orchestrationLock = false;
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
        this.lastAssistantResponseAt = Date.now();
        this.controller.appendEvent(
          "realtime.response.done",
          "Assistant response completed.",
          {
            response_id: event.response?.id ?? this.activeResponseId,
            output_count: Array.isArray(event.response?.output)
              ? event.response.output.length
              : 0,
            assistant_text: extractAssistantTextFromResponse(event.response)
          }
        );
        this.controller.appendTranscript(
          "assistant",
          extractAssistantTextFromResponse(event.response),
          "voice"
        );
        this.orchestrationLock = true;
        this.activeResponseId = null;
        this.responseInFlight = false;
        await this.handleResponseDone(event.response);
        this.orchestrationLock = false;
        await this.flushPendingVoiceTranscript();
        break;
      default:
        break;
    }
  }

  async handleResponseDone(response = {}) {
    const acceptedIntent = this.lastAcceptedVoiceIntent;
    this.lastAcceptedVoiceIntent = null;
    const functionCalls = (response.output ?? [])
      .filter((item) => item.type === "function_call")
      .sort((left, right) => toolPriority(left.name) - toolPriority(right.name));

    if (functionCalls.length === 0) {
      return;
    }

    const results = [];
    const hadLogSet = functionCalls.some((call) => call.name === "log_set");
    const hadRestTimer = functionCalls.some((call) => call.name === "start_rest_timer");
    const hadCompression = functionCalls.some(
      (call) => call.name === "compress_remaining_workout"
    );
    const hadPlanUpdate = functionCalls.some((call) => call.name === "update_plan");
    let state = this.controller.publicState();
    let guardLoggedSet = false;
    const shouldGuardLogSet =
      acceptedIntent?.wantsLogSet &&
      !hadLogSet &&
      (state.phase === "active_set" || state.phase === "ready_for_rest");

    if (shouldGuardLogSet) {
      this.controller.appendEvent(
        "guard.log_set",
        "Model skipped log_set; server logged the active step first."
      );
      this.controller.logSet({
        note: acceptedIntent.logNote ?? null
      });
      guardLoggedSet = true;
      state = this.controller.publicState();
    }

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
    state = this.controller.publicState();
    let guardUpdatedPlan = false;
    if ((hadLogSet || guardLoggedSet) && !hadRestTimer && state.phase === "ready_for_rest") {
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

    const latestLoggedSet = state.completed_sets[state.completed_sets.length - 1] ?? null;
    const needsDiscomfortFallback =
      (hadLogSet || guardLoggedSet) &&
      !hadPlanUpdate &&
      state.phase === "active_set" &&
      /\b(knee|pain|hurt|hurts|weird|discomfort|strain|twinge)\b/i.test(
        latestLoggedSet?.note ?? ""
      );
    if (needsDiscomfortFallback) {
      this.controller.appendEvent(
        "guard.update_plan",
        "Model skipped update_plan; server applied the low-impact fallback."
      );
      this.controller.updatePlan({
        reason: latestLoggedSet?.note ?? "knee discomfort",
        replacement_exercise: "plank",
        duration_seconds: 30,
        note: "low-impact fallback"
      });
      guardUpdatedPlan = true;
      state = this.controller.publicState();
    }

    await this.sendSessionUpdate();

    const followup =
      state.phase === "completed"
        ? {
            instructions:
              "Workout complete. Give a crisp spoken summary using the authoritative summary payload, mention the export targets, do not call tools, and stop.",
            metadata: { source: "summary_followup" }
          }
        : hadCompression
          ? {
              instructions: `Rupert just changed the time constraint. Acknowledge it, explain the shortened remaining workout, and direct him back into ${formatStep(
                state.workout_plan[state.current_step_index] ?? null
              )} immediately. Keep it to two sentences and do not call tools.`,
              metadata: { source: "compression_followup" }
            }
        : state.phase === "resting"
          ? {
              instructions: `The rest timer is now running for ${state.rest_timer.seconds ?? this.controller.restSeconds} seconds. Tell Rupert to rest, keep it brief, offer at most one short OpenAI voice API line, and do not call tools.`,
              metadata: {
                source: guardStartedRest ? "guard_rest_followup" : "rest_followup"
              }
            }
        : hadPlanUpdate || guardUpdatedPlan
          ? {
              instructions: `The plan was updated for comfort. In one short sentence, acknowledge the change and direct Rupert into ${formatStep(
                state.workout_plan[state.current_step_index] ?? null
              )}. Do not call tools.`,
              metadata: {
                source: guardUpdatedPlan
                  ? "guard_plan_update_followup"
                  : "plan_update_followup"
              }
            }
        : hadLogSet || guardLoggedSet
          ? {
              instructions: `The set is logged. Direct Rupert immediately into ${formatStep(
                state.workout_plan[state.current_step_index] ?? null
              )}. Keep it short and do not call tools.`,
              metadata: { source: "log_followup" }
            }
        : {
            metadata: { source: "tool_followup" }
          };

    await this.createResponse(followup, { skipIdleWait: true });
  }

  async executeToolCall(name, args) {
    switch (name) {
      case "log_set":
        return this.controller.logSet(args);
      case "start_rest_timer":
        return this.controller.startRestTimer(args);
      case "update_plan":
        return this.controller.updatePlan(args);
      case "compress_remaining_workout":
        return this.controller.compressRemainingWorkout(args);
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

    while (
      (this.activeResponseId || this.responseInFlight || this.orchestrationLock) &&
      Date.now() - start < timeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (Date.now() - start >= timeoutMs) {
      this.activeResponseId = null;
      this.responseInFlight = false;
      this.orchestrationLock = false;
    }
  }
}
