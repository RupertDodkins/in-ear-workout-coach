import { useCallback, useEffect, useMemo } from "react";
import { BrowserRouter, Outlet, Route, Routes, useOutletContext } from "react-router-dom";
import { useSession, useTick } from "./hooks/useSession.js";
import { useVoice } from "./hooks/useVoice.js";
import { TopStrip } from "./components/TopStrip.jsx";
import { TabNav } from "./components/TabNav.jsx";
import { WorkoutPanel } from "./components/WorkoutPanel.jsx";
import { ConversationPanel } from "./components/ConversationPanel.jsx";
import { AgentActivityPanel } from "./components/AgentActivityPanel.jsx";

function Layout() {
  const { state, sendFallback, reset, refresh, pauseVoice, resumeVoice } = useSession();
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

  const ctx = useMemo(() => ({
    state, voice, sendFallback, onConnectVoice: handleConnect,
  }), [state, voice, sendFallback, handleConnect]);

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
    <div className="app app--split">
      <TopStrip
        state={state}
        voice={voice}
        onConnect={handleConnect}
        onReset={handleReset}
        onTogglePause={handleTogglePause}
        sessionClockSeconds={sessionClockSeconds}
      />
      <TabNav state={state} />
      <main className="stage stage--single">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}

function WorkoutScreen() {
  const { state } = useOutletContext();
  return <WorkoutPanel state={state} />;
}

function ConversationScreen() {
  const { state, voice, sendFallback, onConnectVoice } = useOutletContext();
  return (
    <ConversationPanel
      state={state}
      voice={voice}
      onSendFallback={sendFallback}
      onConnectVoice={onConnectVoice}
    />
  );
}

function ActivityScreen() {
  const { state } = useOutletContext();
  return <AgentActivityPanel state={state} />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<WorkoutScreen />} />
          <Route path="conversation" element={<ConversationScreen />} />
          <Route path="activity" element={<ActivityScreen />} />
          <Route path="*" element={<WorkoutScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
