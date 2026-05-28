import { useEffect, useRef, useState } from "react";

const MAX_DIALOGUES = 2;

export function ConversationFlow({ state }) {
  const transcripts = state.transcripts || [];
  const dialogues = transcripts
    .filter((t) => t.role === "assistant" || t.role === "user")
    .slice(-MAX_DIALOGUES);

  const [tick, setTick] = useState(0);
  const lastKeyRef = useRef("");
  const key = dialogues.map((d) => `${d.role}:${d.ts}`).join("|");
  useEffect(() => {
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key;
      setTick((n) => n + 1);
    }
  }, [key]);

  if (dialogues.length === 0) return null;

  return (
    <div className="convo-flow" aria-live="polite">
      {dialogues.map((entry, i) => {
        const role = entry.role === "assistant" ? "coach" : "user";
        const isLatest = i === dialogues.length - 1;
        return (
          <div
            key={`${tick}-${i}`}
            className={`cf-line cf-line--${role}${isLatest ? " latest" : ""}`}
          >
            <span className="cf-who">{role === "coach" ? "Coach" : "You"}</span>
            <span className="cf-text">{entry.text}</span>
          </div>
        );
      })}
    </div>
  );
}
