import { useCallback, useEffect } from "react";
import { PHASE_LABEL } from "./lib/constants.js";
import { useSession, useTick } from "./hooks/useSession.js";
import { useVoice } from "./hooks/useVoice.js";
import { TopStrip } from "./components/TopStrip.jsx";
import { WorkoutPanel } from "./components/WorkoutPanel.jsx";
import { ConversationPanel } from "./components/ConversationPanel.jsx";
import { AgentActivityPanel } from "./components/AgentActivityPanel.jsx";
import { PhoneFrame } from "./components/PhoneFrame.jsx";
import { ConversationFlow } from "./components/ConversationFlow.jsx";

export function App() {
  const { state, sendFallback, reset, refresh, pauseVoice, resumeVoice, endSession } = useSession();
  const voice = useVoice({ onAfterConnect: refresh });
  useTick(1000);

  useEffect(() => {
    const onUnload = () => voice.disconnect();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [voice]);

  const handleConnect = useCallback(async () => {
    try { await voice.connect(); }
    catch (err) { alert(`Voice connection failed: ${err.message}`); }
  }, [voice]);

  // Auto-connect voice on first load so the user-facing phone screen
  // has no manual "connect" step. Operator controls live in the side panel.
  useEffect(() => {
    if (voice.status === "idle") void handleConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleVoice = useCallback(async () => {
    if (voice.status === "live" || voice.status === "connecting") {
      voice.disconnect();
    } else {
      await handleConnect();
    }
  }, [voice, handleConnect]);

  const handleReset = useCallback(async () => {
    voice.disconnect();
    try { await reset(); }
    catch (err) { alert(err.message); }
  }, [voice, reset]);

  const handleTogglePause = useCallback(async () => {
    if (voice.status !== "live") return;
    const next = !voice.paused;
    voice.setPausedLocally(next);
    try {
      if (next) await pauseVoice();
      else await resumeVoice();
    } catch (err) {
      voice.setPausedLocally(!next);
      alert(err.message);
    }
  }, [voice, pauseVoice, resumeVoice]);

  const handleEndWorkout = useCallback(async () => {
    try { await endSession(); }
    catch (err) { alert(err.message); }
  }, [endSession]);

  if (!state) {
    return (
      <div className="app">
        <div style={{ padding: 24, color: "var(--muted-2)" }}>Loading…</div>
      </div>
    );
  }

  const sessionClockSeconds = state.session_started_at
    ? (Date.now() - new Date(state.session_started_at).getTime()) / 1000
    : null;

  return (
    <div className="app app--phone">
      <header className="page-header">
        <h1 className="page-title">In-Ear Workout Coach</h1>
      </header>
      <div className="app-row">
        <aside className="side-panel side-panel--left" aria-label="Conversation">
          <div className="side-panel-tag">Conversation</div>
          <div className="side-panel-body">
            <ConversationPanel
              state={state}
              voice={voice}
              onSendFallback={sendFallback}
              onToggleVoice={handleToggleVoice}
              onTogglePause={handleTogglePause}
              onReset={handleReset}
            />
          </div>
        </aside>

        <PhoneFrame voiceLive={voice.status === "live"} voicePaused={voice.paused}>
          <div className="phone-app">
            <TopStrip
              state={state}
              voice={voice}
              sessionClockSeconds={sessionClockSeconds}
            />
            <main className="stage stage--single">
              <WorkoutPanel state={state} onEndWorkout={handleEndWorkout} />
            </main>
          </div>
        </PhoneFrame>

        <aside className="side-panel side-panel--right" aria-label="Agent activity">
          <div className="side-panel-tag">
            Activity
            <span className="side-panel-phase" data-phase={state.phase}>
              <span className="dot" />
              {PHASE_LABEL[state.phase] ?? state.phase}
            </span>
          </div>
          <div className="side-panel-body">
            <AgentActivityPanel state={state} />
          </div>
        </aside>
      </div>

      <ConversationFlow state={state} />
    </div>
  );
}
