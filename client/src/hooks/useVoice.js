import { useCallback, useEffect, useRef, useState } from "react";

// WebRTC + remote audio element wiring for the realtime voice link.
// Status mirrors the existing connect button states; pause flips the local
// mic track and mutes the remote audio.
export function useVoice({ onAfterConnect } = {}) {
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [paused, setPaused] = useState(false);
  const [lastError, setLastError] = useState(null);

  const connect = useCallback(async () => {
    if (pcRef.current) return;
    setStatus("connecting");
    setLastError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
      const pc = new RTCPeerConnection();

      pc.ontrack = (event) => {
        const audioEl = document.getElementById("remoteAudio");
        if (audioEl) {
          const [remoteStream] = event.streams;
          audioEl.srcObject = remoteStream;
        }
      };

      for (const track of stream.getTracks()) pc.addTrack(track, stream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const res = await fetch("/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!res.ok) throw new Error(await res.text());
      const answerSdp = await res.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      pcRef.current = pc;
      streamRef.current = stream;
      setPaused(false);
      setStatus("live");
      if (onAfterConnect) await onAfterConnect();
    } catch (err) {
      setStatus("error");
      setLastError(err);
      throw err;
    }
  }, [onAfterConnect]);

  const disconnect = useCallback(() => {
    const pc = pcRef.current;
    const stream = streamRef.current;
    if (pc) {
      pc.close();
      pcRef.current = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    const audioEl = document.getElementById("remoteAudio");
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.muted = false;
    }
    setPaused(false);
    setStatus("idle");
  }, []);

  const setPausedLocally = useCallback((next) => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getAudioTracks()) track.enabled = !next;
    }
    const audioEl = document.getElementById("remoteAudio");
    if (audioEl) audioEl.muted = next;
    setPaused(next);
  }, []);

  useEffect(() => () => {
    if (pcRef.current) pcRef.current.close();
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
    }
  }, []);

  return {
    status,
    paused,
    lastError,
    isConnected: status === "live",
    connect,
    disconnect,
    setPausedLocally,
  };
}
