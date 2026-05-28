import { useEffect, useRef, useState } from "react";

export function PhoneFrame({ children, voiceLive = false, voicePaused = false }) {
  const [now, setNow] = useState(() => new Date());
  const frameRef = useRef(null);
  const dotRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    const dot = dotRef.current;
    if (!frame || !dot) return;

    let raf = 0;
    let targetX = 0, targetY = 0;
    let curX = 0, curY = 0;
    let visible = false;

    const animate = () => {
      curX += (targetX - curX) * 0.35;
      curY += (targetY - curY) * 0.35;
      dot.style.transform = `translate(${curX}px, ${curY}px) translate(-50%, -50%)`;
      raf = requestAnimationFrame(animate);
    };

    const onMove = (e) => {
      const rect = frame.getBoundingClientRect();
      targetX = e.clientX - rect.left;
      targetY = e.clientY - rect.top;
      if (!visible) {
        visible = true;
        dot.classList.add("visible");
        curX = targetX; curY = targetY;
      }
    };
    const onLeave = () => {
      visible = false;
      dot.classList.remove("visible");
    };
    const onDown = () => dot.classList.add("tap");
    const onUp = () => dot.classList.remove("tap");

    frame.addEventListener("mousemove", onMove);
    frame.addEventListener("mouseleave", onLeave);
    frame.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    raf = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(raf);
      frame.removeEventListener("mousemove", onMove);
      frame.removeEventListener("mouseleave", onLeave);
      frame.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="phone-stage">
      <div className={`phone-aurora${voiceLive ? " live" : ""}`} aria-hidden="true">
        <span className="aurora a1" />
        <span className="aurora a2" />
        <span className="aurora a3" />
      </div>

      <div className="phone-frame" role="presentation" ref={frameRef}>
        <div className="phone-bezel">
          <div className="phone-status" aria-hidden="true">
            <span className="ps-time">{time}</span>
            <span className="ps-island" />
            <span className="ps-glyphs">
              <PsSignal />
              <PsWifi />
              <PsBattery />
            </span>
          </div>
          <VoicePulse live={voiceLive} paused={voicePaused} />
          <div className="phone-content">{children}</div>
          <div className="phone-home" aria-hidden="true" />
          <div className="phone-touch" ref={dotRef} aria-hidden="true" />
        </div>
        <span className="phone-side phone-side--power" aria-hidden="true" />
        <span className="phone-side phone-side--vol-up" aria-hidden="true" />
        <span className="phone-side phone-side--vol-dn" aria-hidden="true" />
        <span className="phone-side phone-side--mute" aria-hidden="true" />
      </div>
    </div>
  );
}

function VoicePulse({ live, paused }) {
  if (!live || paused) return null;
  const bars = 18;
  return (
    <div className="voice-pulse" aria-hidden="true">
      <span className="voice-pulse-label">Listening</span>
      <span className="voice-pulse-bars">
        {Array.from({ length: bars }, (_, i) => (
          <span key={i} className="vp-bar" style={{ animationDelay: `${(i % 6) * 0.12}s` }} />
        ))}
      </span>
    </div>
  );
}

function PsSignal() {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden="true">
      <rect x="0" y="7" width="3" height="4" rx="0.6" />
      <rect x="4.5" y="5" width="3" height="6" rx="0.6" />
      <rect x="9" y="2.5" width="3" height="8.5" rx="0.6" />
      <rect x="13.5" y="0" width="3" height="11" rx="0.6" />
    </svg>
  );
}

function PsWifi() {
  return (
    <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <path d="M1.4 4.2a8.6 8.6 0 0 1 12.2 0" />
      <path d="M3.6 6.4a5.5 5.5 0 0 1 7.8 0" />
      <path d="M5.8 8.6a2.4 2.4 0 0 1 3.4 0" />
      <circle cx="7.5" cy="9.9" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PsBattery() {
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="22" height="11" rx="3" stroke="currentColor" strokeOpacity="0.6" />
      <rect x="23.5" y="3.5" width="2" height="5" rx="1" fill="currentColor" fillOpacity="0.6" />
      <rect x="2.5" y="2.5" width="17" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}
