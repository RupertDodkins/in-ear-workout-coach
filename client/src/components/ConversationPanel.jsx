import { useEffect, useRef, useState } from "react";
import { QUICK_CHIPS } from "../lib/constants.js";
import { fmtClock } from "../lib/format.js";
import { ClockIcon, MicIcon, SendIcon } from "./Icon.jsx";

function Bubble({ entry }) {
  const ts = fmtClock(entry.ts);
  const role = entry.role === "assistant" ? "coach" : entry.role;
  const meta = entry.source && entry.source !== "voice" ? `${ts} · ${entry.source}` : ts;

  if (role === "system") {
    return (
      <div className="bubble-row system">
        <div className="system-line">{ClockIcon}{entry.text}</div>
      </div>
    );
  }
  if (role === "coach") {
    return (
      <div className="bubble-row coach">
        <div className="avatar coach">C</div>
        <div className="bubble">
          {entry.text}
          <div className="timestamp">{meta}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="bubble-row user">
      <div className="bubble">
        {entry.text}
        <div className="timestamp">{meta}</div>
      </div>
      <div className="avatar user">U</div>
    </div>
  );
}

export function ConversationPanel({ state, voice, onSendFallback, onConnectVoice }) {
  const transcripts = state.transcripts || [];
  const bodyRef = useRef(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [transcripts.length]);

  const status = voice.status !== "idle" ? voice.status : (state.connection?.status || "idle");
  let modeText = "Text fallback";
  let modeClass = "pill orange";
  if (status === "live" && (voice.paused || state.connection?.paused)) {
    modeText = "Voice paused"; modeClass = "pill amber";
  } else if (status === "live") {
    modeText = "Voice live"; modeClass = "pill green";
  } else if (status === "connecting") {
    modeText = "Connecting…"; modeClass = "pill amber";
  } else if (status === "error") {
    modeText = "Voice error"; modeClass = "pill orange";
  }

  const sendText = async (text) => {
    if (!text || sending) return;
    setSending(true);
    try {
      await onSendFallback(text);
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    void sendText(text);
  };

  return (
    <section className="col col-mid">
      <div className="panel convo">
        <div className="panel-head">
          <div>
            <div className="panel-title">Conversation</div>
            <div className="panel-sub">{transcripts.length} turn{transcripts.length === 1 ? "" : "s"}</div>
          </div>
          <div className={modeClass}>{modeText}</div>
        </div>

        <div className="convo-body" ref={bodyRef}>
          {transcripts.length === 0 ? (
            <div className="empty-state">
              <b>No turns yet</b>
              Connect voice or tap a quick reply to start the session.
            </div>
          ) : (
            transcripts.map((entry, i) => <Bubble key={i} entry={entry} />)
          )}
        </div>

        <div className="dock">
          <div className="chips-label">
            <span>Quick replies</span>
            <span className="chips-sub">tap to send</span>
          </div>
          <div className="chips">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip.text}
                type="button"
                className={`chip${chip.warm ? " warm" : ""}`}
                onClick={() => void sendText(chip.turn)}
                disabled={sending}
              >
                {chip.text}
              </button>
            ))}
          </div>
          <form className="input-row" onSubmit={onSubmit}>
            <input
              type="text"
              placeholder="Message the coach…"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="button"
              className="mic-btn"
              title={status === "live" ? "Voice connected" : "Connect voice"}
              data-live={status === "live" ? "true" : "false"}
              onClick={onConnectVoice}
            >
              {MicIcon}
            </button>
            <button type="submit" className="send-btn" title="Send" disabled={sending}>
              {SendIcon}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
