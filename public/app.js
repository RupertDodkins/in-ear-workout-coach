const connectButton = document.querySelector("#connectButton");
const resetButton = document.querySelector("#resetButton");
const fallbackForm = document.querySelector("#fallbackForm");
const fallbackInput = document.querySelector("#fallbackInput");
const quickButtons = document.querySelectorAll("[data-turn]");
const connectionBadge = document.querySelector("#connectionBadge");
const phaseValue = document.querySelector("#phaseValue");
const stepValue = document.querySelector("#stepValue");
const timerValue = document.querySelector("#timerValue");
const modelValue = document.querySelector("#modelValue");
const transcriptList = document.querySelector("#transcriptList");
const eventList = document.querySelector("#eventList");
const stateDump = document.querySelector("#stateDump");
const summaryDump = document.querySelector("#summaryDump");
const remoteAudio = document.querySelector("#remoteAudio");

let peerConnection = null;
let pollHandle = null;
let latestState = null;

function badgeClass(status) {
  return ["idle", "connecting", "live", "error"].includes(status) ? status : "idle";
}

function renderLog(container, items, renderItem) {
  container.innerHTML = "";
  const list = [...items].slice(-10).reverse();

  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing yet.";
    container.appendChild(empty);
    return;
  }

  for (const item of list) {
    const node = document.createElement("div");
    node.className = "log-entry";
    node.innerHTML = renderItem(item);
    container.appendChild(node);
  }
}

function formatStep(step) {
  if (!step) {
    return "none";
  }

  if (step.target_reps != null) {
    return `${step.exercise} · ${step.target_reps} reps`;
  }

  return `${step.exercise} · ${step.duration_seconds}s`;
}

function updateCountdown() {
  if (!latestState?.rest_timer?.active || !latestState.rest_timer.ends_at) {
    timerValue.textContent = "not running";
    return;
  }

  const remainingMs = new Date(latestState.rest_timer.ends_at).getTime() - Date.now();
  const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
  timerValue.textContent = `${remaining}s remaining`;
}

function renderState(state) {
  latestState = state;
  connectionBadge.textContent = state.connection.status;
  connectionBadge.className = `badge ${badgeClass(state.connection.status)}`;
  phaseValue.textContent = state.phase;
  stepValue.textContent = formatStep(state.workout_plan[state.current_step_index] ?? null);
  modelValue.textContent = state.connection.model || "-";
  stateDump.textContent = JSON.stringify(
    {
      phase: state.phase,
      current_step_index: state.current_step_index,
      workout_plan: state.workout_plan,
      completed_sets: state.completed_sets,
      coach_events: state.coach_events,
      rest_timer: state.rest_timer
    },
    null,
    2
  );
  summaryDump.textContent = JSON.stringify(state.summary_payload, null, 2);

  renderLog(
    transcriptList,
    state.transcripts,
    (entry) =>
      `<p class="log-meta">${entry.ts}</p><p><span class="pill">${entry.role}</span> ${entry.text}</p>`
  );

  renderLog(
    eventList,
    state.event_log,
    (entry) =>
      `<p class="log-meta">${entry.ts} · ${entry.type}</p><p>${entry.message}</p>`
  );

  updateCountdown();
}

async function fetchState() {
  const response = await fetch("/api/state");
  const state = await response.json();
  renderState(state);
}

async function connectLiveVoice() {
  connectButton.disabled = true;
  connectButton.textContent = "Connecting…";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const pc = new RTCPeerConnection();

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      remoteAudio.srcObject = stream;
    };

    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch("/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp"
      },
      body: offer.sdp
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const answerSdp = await response.text();
    await pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp
    });

    peerConnection = pc;
    connectButton.textContent = "Live Voice Connected";
    await fetchState();
  } catch (error) {
    connectButton.disabled = false;
    connectButton.textContent = "Connect Live Voice";
    alert(`Voice connection failed: ${error.message}`);
  }
}

async function sendFallbackTurn(text) {
  const response = await fetch("/api/fallback-turn", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Failed to send fallback turn.");
  }

  await fetchState();
}

async function resetDemo() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  const response = await fetch("/api/reset", { method: "POST" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Reset failed.");
  }

  connectButton.disabled = false;
  connectButton.textContent = "Connect Live Voice";
  await fetchState();
}

connectButton.addEventListener("click", () => {
  void connectLiveVoice();
});

resetButton.addEventListener("click", () => {
  void resetDemo();
});

fallbackForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = fallbackInput.value.trim();
  if (!text) {
    return;
  }
  fallbackInput.value = "";
  void sendFallbackTurn(text).catch((error) => {
    alert(error.message);
  });
});

for (const button of quickButtons) {
  button.addEventListener("click", () => {
    void sendFallbackTurn(button.dataset.turn).catch((error) => {
      alert(error.message);
    });
  });
}

pollHandle = window.setInterval(() => {
  void fetchState().catch(() => {});
  updateCountdown();
}, 1000);

window.addEventListener("beforeunload", () => {
  if (pollHandle) {
    clearInterval(pollHandle);
  }
  if (peerConnection) {
    peerConnection.close();
  }
});

void fetchState();
