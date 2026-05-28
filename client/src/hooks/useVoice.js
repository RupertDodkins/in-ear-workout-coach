import { useCallback, useEffect, useRef, useState } from "react";

// WebRTC + remote audio element wiring for the realtime voice link.
// Status mirrors the existing connect button states; pause flips the local
// mic track and mutes the remote audio.
export function useVoice({ onAfterConnect } = {}) {
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const statsTimerRef = useRef(null);
  const lastStatsRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [paused, setPaused] = useState(false);
  const [lastError, setLastError] = useState(null);

  const reportEvent = useCallback((type, message, data = null) => {
    const payload = { type, message, data };
    console.debug(`[voice][${type}] ${message}`, data ?? "");
    void fetch("/api/client-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const stopStatsLoop = useCallback(() => {
    if (statsTimerRef.current) {
      window.clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    lastStatsRef.current = null;
  }, []);

  const startStatsLoop = useCallback((pc) => {
    stopStatsLoop();
    statsTimerRef.current = window.setInterval(async () => {
      if (!pcRef.current || pc.connectionState === "closed") {
        stopStatsLoop();
        return;
      }

      try {
        const stats = await pc.getStats();
        for (const report of stats.values()) {
          if (report.type !== "inbound-rtp" || report.kind !== "audio") {
            continue;
          }

          const previous = lastStatsRef.current;
          const snapshot = {
            ts: Date.now(),
            packetsReceived: report.packetsReceived ?? null,
            packetsLost: report.packetsLost ?? null,
            jitter: report.jitter ?? null,
            bytesReceived: report.bytesReceived ?? null,
            totalSamplesReceived: report.totalSamplesReceived ?? null,
            concealedSamples: report.concealedSamples ?? null,
            silentConcealedSamples: report.silentConcealedSamples ?? null,
            concealmentEvents: report.concealmentEvents ?? null,
            insertedSamplesForDeceleration: report.insertedSamplesForDeceleration ?? null,
            removedSamplesForAcceleration: report.removedSamplesForAcceleration ?? null,
            jitterBufferDelay: report.jitterBufferDelay ?? null,
            jitterBufferEmittedCount: report.jitterBufferEmittedCount ?? null
          };

          const deltaMs = previous ? snapshot.ts - previous.ts : null;
          const bytesDelta =
            previous && snapshot.bytesReceived != null && previous.bytesReceived != null
              ? snapshot.bytesReceived - previous.bytesReceived
              : null;
          const kbps =
            deltaMs && bytesDelta != null && deltaMs > 0
              ? Number(((bytesDelta * 8) / deltaMs).toFixed(2))
              : null;
          const concealedDelta =
            previous &&
            snapshot.concealedSamples != null &&
            previous.concealedSamples != null
              ? snapshot.concealedSamples - previous.concealedSamples
              : null;
          const lostDelta =
            previous &&
            snapshot.packetsLost != null &&
            previous.packetsLost != null
              ? snapshot.packetsLost - previous.packetsLost
              : null;

          lastStatsRef.current = snapshot;
          reportEvent("client.stats.inbound_audio", "Inbound audio stats sample.", {
            ...snapshot,
            kbps,
            concealedDelta,
            lostDelta
          });
        }
      } catch (error) {
        reportEvent("client.stats.error", "Failed to read WebRTC stats.", {
          message: error.message
        });
      }
    }, 2000);
  }, [reportEvent, stopStatsLoop]);

  const connect = useCallback(async () => {
    if (pcRef.current) return;
    setStatus("connecting");
    setLastError(null);
    reportEvent("client.webrtc.connect_start", "Starting WebRTC voice connection.");
    try {
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        channelCount: 1
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      reportEvent("client.audio.input_granted", "Microphone stream acquired.", {
        track_count: stream.getTracks().length,
        audio_track_count: stream.getAudioTracks().length,
        requested_constraints: audioConstraints,
        applied_constraints: stream.getAudioTracks()[0]?.getSettings?.() ?? null
      });
      const pc = new RTCPeerConnection();
      reportEvent("client.webrtc.pc_created", "RTCPeerConnection created.");

      pc.addEventListener("connectionstatechange", () => {
        reportEvent("client.webrtc.connection_state", "Peer connection state changed.", {
          connectionState: pc.connectionState
        });
      });
      pc.addEventListener("iceconnectionstatechange", () => {
        reportEvent("client.webrtc.ice_connection_state", "ICE connection state changed.", {
          iceConnectionState: pc.iceConnectionState
        });
      });
      pc.addEventListener("icegatheringstatechange", () => {
        reportEvent("client.webrtc.ice_gathering_state", "ICE gathering state changed.", {
          iceGatheringState: pc.iceGatheringState
        });
      });
      pc.addEventListener("signalingstatechange", () => {
        reportEvent("client.webrtc.signaling_state", "Signaling state changed.", {
          signalingState: pc.signalingState
        });
      });

      pc.ontrack = (event) => {
        const audioEl = document.getElementById("remoteAudio");
        const track = event.track;
        reportEvent("client.audio.remote_track", "Remote audio track received.", {
          stream_count: event.streams.length,
          track_id: track?.id ?? null,
          track_kind: track?.kind ?? null,
          track_muted: track?.muted ?? null,
          ready_state: track?.readyState ?? null
        });
        if (track) {
          track.addEventListener("mute", () => {
            reportEvent("client.audio.track_muted", "Remote audio track muted.", {
              track_id: track.id
            });
          });
          track.addEventListener("unmute", () => {
            reportEvent("client.audio.track_unmuted", "Remote audio track unmuted.", {
              track_id: track.id
            });
          });
          track.addEventListener("ended", () => {
            reportEvent("client.audio.track_ended", "Remote audio track ended.", {
              track_id: track.id
            });
          });
        }
        if (audioEl) {
          const [remoteStream] = event.streams;
          audioEl.srcObject = remoteStream;
          const play = audioEl.play?.();
          if (play && typeof play.catch === "function") {
            play.catch((error) => {
              reportEvent("client.audio.play_error", "Remote audio play() failed.", {
                message: error.message
              });
            });
          }
        }
      };

      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      reportEvent("client.audio.local_tracks_added", "Local audio tracks added to peer connection.", {
        track_ids: stream.getTracks().map((track) => track.id)
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      reportEvent("client.webrtc.local_description_set", "Local SDP offer created.", {
        sdp_length: offer.sdp?.length ?? 0
      });

      const res = await fetch("/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!res.ok) throw new Error(await res.text());
      const answerSdp = await res.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      reportEvent("client.webrtc.remote_description_set", "Remote SDP answer applied.", {
        sdp_length: answerSdp.length
      });

      pcRef.current = pc;
      streamRef.current = stream;
      startStatsLoop(pc);
      setPaused(false);
      setStatus("live");
      reportEvent("client.webrtc.connect_success", "WebRTC voice connection is live.");
      if (onAfterConnect) await onAfterConnect();
    } catch (err) {
      setStatus("error");
      setLastError(err);
      reportEvent("client.webrtc.connect_error", "WebRTC voice connection failed.", {
        message: err.message
      });
      throw err;
    }
  }, [onAfterConnect, reportEvent, startStatsLoop]);

  const disconnect = useCallback(() => {
    const pc = pcRef.current;
    const stream = streamRef.current;
    reportEvent("client.webrtc.disconnect", "Disconnecting WebRTC voice session.", {
      had_pc: Boolean(pc),
      had_stream: Boolean(stream)
    });
    stopStatsLoop();
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
  }, [reportEvent, stopStatsLoop]);

  const setPausedLocally = useCallback((next) => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getAudioTracks()) track.enabled = !next;
    }
    const audioEl = document.getElementById("remoteAudio");
    if (audioEl) audioEl.muted = next;
    setPaused(next);
    reportEvent(next ? "client.audio.local_pause" : "client.audio.local_resume", next
      ? "Locally muted mic and remote audio."
      : "Locally resumed mic and remote audio.", {
      muted: next
    });
  }, [reportEvent]);

  useEffect(() => () => {
    stopStatsLoop();
    if (pcRef.current) pcRef.current.close();
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
    }
  }, [stopStatsLoop]);

  useEffect(() => {
    const audioEl = document.getElementById("remoteAudio");
    if (!audioEl) {
      return undefined;
    }

    const emit = (type, message) => () => {
      reportEvent(type, message, {
        currentTime: Number(audioEl.currentTime.toFixed(3)),
        paused: audioEl.paused,
        readyState: audioEl.readyState,
        networkState: audioEl.networkState
      });
    };

    const handlers = [
      ["playing", emit("client.audio.playing", "Remote audio started playing.")],
      ["pause", emit("client.audio.pause", "Remote audio element paused.")],
      ["waiting", emit("client.audio.waiting", "Remote audio element is waiting for more data.")],
      ["stalled", emit("client.audio.stalled", "Remote audio element stalled.")],
      ["ended", emit("client.audio.ended", "Remote audio playback ended.")],
      ["error", () => {
        const mediaError = audioEl.error;
        reportEvent("client.audio.error", "Remote audio element error.", {
          code: mediaError?.code ?? null,
          message: mediaError?.message ?? null
        });
      }]
    ];

    for (const [name, handler] of handlers) {
      audioEl.addEventListener(name, handler);
    }

    return () => {
      for (const [name, handler] of handlers) {
        audioEl.removeEventListener(name, handler);
      }
    };
  }, [reportEvent]);

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
