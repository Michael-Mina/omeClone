import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type { PublicNsfwDetectionSettings } from './types/publicNsfwSettings';
import { socket } from './sockets/socket';
import { emitStartMatchmaking } from './utils/emitStartMatchmaking';
import { resolveUserIdForIdentify } from './utils/resolveSocketUserId';
import { useAppStore } from './store/useAppStore';
import { useNavigate } from 'react-router-dom';
import { useWebRTC } from './hooks/useWebRTC';
import { useNSFWDetection } from './hooks/useNSFWDetection';
import { useNsfwEnforcement, NSFW_STRIKES_FOR_PERMANENT } from './hooks/useNsfwEnforcement';
import type { NsfwDetectionRuntimeConfig } from './hooks/useNSFWDetection';
import type { NsfwEnforcementRuntime } from './hooks/useNsfwEnforcement';
import { MatchChatPanel, type ChatLine } from './components/MatchChatPanel';
import { MatchSpeedDial, type SpeedDialAction } from './components/MatchSpeedDial';
import { MATCH_ZONE_META, getAdultZoneDisplay, userMeetsAdultZone } from './types/matchZone';
import {
  translateForChatDisplay,
  resolveTranslateTargetLang,
  mergeTranslatedChatLine,
} from './utils/chatTranslate';
import { languageLabel } from './data/profileOptions';
import { apiUrl } from './config/apiBase';
import { useChatTranslateMode } from './hooks/useChatTranslateMode';
import { useMdUp } from './hooks/useMdUp';
import { useMatchFloatingWindow } from './hooks/useMatchFloatingWindow';
import { useAppFullscreen } from './hooks/useAppFullscreen';
import {
  Video,
  SkipForward,
  Play,
  ShieldAlert,
  ShieldCheck,
  User,
  XCircle,
  StopCircle,
  GripVertical,
  EyeOff,
  MessageSquare,
  SwitchCamera,
  Flashlight,
  Mic,
  MicOff,
  PictureInPicture2,
  Maximize2,
  Minimize2,
} from 'lucide-react';

const MOBILE_PIP_W = 128;
const MOBILE_PIP_H = 196;

function App() {
  const navigate = useNavigate();
  const mdUp = useMdUp();
  const {
    matchStatus,
    roomId,
    setMatchStatus,
    setMatchData,
    role,
    displayName,
    isAnonymous,
    userId,
    token,
    exemptFromAiCensorship,
    stopMatch,
    resetMatch,
    language,
    gender,
    country,
    birthYear,
    matchZone,
    setSalaSessionActive,
  } = useAppStore();

  const adultZoneDisplay = useMemo(() => getAdultZoneDisplay(country), [country]);
  const zoneDisplay =
    matchZone === 'adult' ? adultZoneDisplay : MATCH_ZONE_META[matchZone];

  const {
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
  } = useWebRTC();

  const [nsfwPublic, setNsfwPublic] = useState<PublicNsfwDetectionSettings | null>(null);

  const nsfwDetectionRuntime = useMemo((): NsfwDetectionRuntimeConfig | null => {
    if (!nsfwPublic) return null;
    return {
      probabilityThreshold: nsfwPublic.probability_threshold,
      frameIntervalMs: nsfwPublic.frame_interval_ms,
      lowFramesToClear: nsfwPublic.low_frames_to_clear,
    };
  }, [nsfwPublic]);

  const nsfwEnforcementRuntime = useMemo((): NsfwEnforcementRuntime | null => {
    if (!nsfwPublic) return null;
    return { streakMs: nsfwPublic.streak_ms, graceFalseMs: nsfwPublic.grace_false_ms };
  }, [nsfwPublic]);

  const exemptFromNsfwPolicy =
    role === 'superadmin' || exemptFromAiCensorship || matchZone === 'adult';

  const { isNSFW, isModelLoading } = useNSFWDetection(
    localVideoRef,
    role,
    exemptFromNsfwPolicy,
    nsfwDetectionRuntime
  );
  const {
    visualBlur,
    overlayKind,
    cooldownCountdownLabel,
    strikeCount,
    blocksMatchmaking,
  } = useNsfwEnforcement(isNSFW, exemptFromNsfwPolicy, userId, token, nsfwEnforcementRuntime);

  const blocksMatchmakingRef = useRef(false);
  blocksMatchmakingRef.current = blocksMatchmaking;

  const [onlineUsers, setOnlineUsers] = useState(0);
  const [mobilePipHidden, setMobilePipHidden] = useState(false);
  const [mobilePipPos, setMobilePipPos] = useState({ x: 0, y: 96 });
  const pipDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatLine[]>([]);
  /** Móvil: panel de chat colapsado para ganar espacio al vídeo */
  const [mobileChatHidden, setMobileChatHidden] = useState(false);

  const { mode: translateMode, setMode: setTranslateMode } = useChatTranslateMode();
  const translateModeRef = useRef(translateMode);
  translateModeRef.current = translateMode;

  const chatMessagesRef = useRef<ChatLine[]>([]);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const translateTargetLabel = useMemo(
    () => languageLabel(resolveTranslateTargetLang(translateMode, language)),
    [translateMode, language]
  );

  /** Al cambiar idioma destino, re-traducir mensajes visibles (usa texto original guardado). */
  useEffect(() => {
    if (matchStatus !== 'matched') return;
    let cancelled = false;
    const snapshot = chatMessagesRef.current;
    if (snapshot.length === 0) return;
    const ids = snapshot.map((m) => m.id);
    void (async () => {
      const tok = useAppStore.getState().token;
      if (!tok) return;
      const target = resolveTranslateTargetLang(translateMode, language);
      const next = await Promise.all(
        snapshot.map(async (m) => {
          const source = m.originalText ?? m.text;
          const seg = await translateForChatDisplay(source, target, tok);
          return { ...m, ...mergeTranslatedChatLine(source, seg, m) };
        })
      );
      if (cancelled) return;
      setChatMessages((curr) => {
        if (curr.length !== ids.length) return curr;
        const same = curr.every((m, i) => m.id === ids[i]);
        return same ? next : curr;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [translateMode, language, matchStatus]);

  useEffect(() => {
    if (mdUp || typeof window === 'undefined') return;
    queueMicrotask(() => {
      setMobilePipPos({
        x: Math.max(8, window.innerWidth - MOBILE_PIP_W - 12),
        y: 100,
      });
    });
  }, [mdUp]);

  useEffect(() => {
    syncLocalPreview();
  }, [mdUp, mobilePipHidden, syncLocalPreview]);

  useEffect(() => {
    const clamp = () => {
      if (typeof window === 'undefined') return;
      setMobilePipPos((p) => ({
        x: Math.min(Math.max(8, p.x), window.innerWidth - MOBILE_PIP_W - 8),
        y: Math.min(Math.max(72, p.y), window.innerHeight - MOBILE_PIP_H - 120),
      }));
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  // Swipe state for mobile
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const remoteContainerRef = useRef<HTMLDivElement>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const SWIPE_THRESHOLD = 100;

  const { isFullscreen, toggleFullscreen } = useAppFullscreen(appShellRef, remoteVideoRef);

  /** Nueva búsqueda / pasar siguiente: permite idle→cola automática o matched→pasar persona. */
  const requestNewMatch = useCallback(() => {
    if (blocksMatchmakingRef.current) return;
    const s = useAppStore.getState();
    if (s.matchStatus === 'waiting' || s.matchStatus === 'stopped') return;
    if (!socket.connected) return;
    if (s.matchZone === 'adult' && !userMeetsAdultZone(s.birthYear, s.country)) {
      s.setMatchZone('moderated');
    }
    s.setMatchStatus('waiting');
    emitStartMatchmaking();
  }, []);

  /** Tras reconectar el socket: si seguíamos en búsqueda, volver a registrar en cola (Strict Mode / tabs). */
  const resumeMatchmakingAfterConnect = useCallback(() => {
    if (blocksMatchmakingRef.current) return;
    const s = useAppStore.getState();
    if (s.matchStatus !== 'idle' && s.matchStatus !== 'waiting') return;
    if (!socket.connected) return;
    if (s.matchZone === 'adult' && !userMeetsAdultZone(s.birthYear, s.country)) {
      s.setMatchZone('moderated');
    }
    if (s.matchStatus === 'idle') s.setMatchStatus('waiting');
    emitStartMatchmaking();
  }, []);

  /* Cámara: efecto aparte; si va dentro del efecto del socket y startLocalStream cambiara cada render,
   * se re-ejecutaba el efecto, socket.off/on y `onConnect()` otra vez → spam de start_matchmaking en bucle. */
  useEffect(() => {
    void startLocalStream();
  }, [startLocalStream]);

  const emitSocketIdentify = useCallback(() => {
    if (!socket.connected) return;
    const {
      role: currentRole,
      displayName: currentName,
      gender: g,
      country: c,
      language: lang,
      birthYear: by,
      isAnonymous: anon,
    } = useAppStore.getState();
    const identifiedAs = resolveUserIdForIdentify(socket.id);
    socket.emit('identify', {
      user_id: identifiedAs,
      role: currentRole,
      display_name: currentName,
      gender: g,
      country: c,
      language: lang,
      birth_year: by,
      is_anonymous: anon,
      match_zone: useAppStore.getState().matchZone,
    });
  }, []);

  /** Tras login o rehidratación: el socket ya puede estar conectado sin volver a disparar `connect`. */
  useEffect(() => {
    emitSocketIdentify();
  }, [userId, token, displayName, isAnonymous, role, language, gender, country, birthYear, matchZone, emitSocketIdentify]);

  useEffect(() => {
    let cancelled = false;
    const loadNsfw = async () => {
      try {
        const r = await fetch(apiUrl('/api/settings/nsfw-detection'));
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as PublicNsfwDetectionSettings;
        if (
          cancelled ||
          typeof j.probability_threshold !== 'number' ||
          typeof j.frame_interval_ms !== 'number' ||
          typeof j.low_frames_to_clear !== 'number' ||
          typeof j.streak_ms !== 'number' ||
          typeof j.grace_false_ms !== 'number'
        ) {
          return;
        }
        setNsfwPublic(j);
      } catch {
        /* noop */
      }
    };
    void loadNsfw();
    const id = window.setInterval(loadNsfw, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  /** Respaldo: poller ligero si el socket no entregó `exemptions_updated`. */
  useEffect(() => {
    const tok = token?.trim();
    if (!tok) return;
    const syncExemptionsFromMe = async () => {
      try {
        const r = await fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${tok}` } });
        if (!r.ok) return;
        const j = (await r.json()) as { exempt_from_ai_censorship?: unknown };
        if (typeof j.exempt_from_ai_censorship === 'boolean') {
          useAppStore.getState().applyServerExemptionSync({ exemptFromAiCensorship: j.exempt_from_ai_censorship });
        }
      } catch {
        /* ignore */
      }
    };
    void syncExemptionsFromMe();
    const id = window.setInterval(syncExemptionsFromMe, 60_000);
    return () => clearInterval(id);
  }, [token]);

  /** Evita dos resume seguidos sin desconexión (React Strict Mode / mismo socket.id). */
  const lastResumeSocketIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    const onConnect = () => {
      const { role: currentRole, isAnonymous: anon } = useAppStore.getState();
      const identifiedAs = resolveUserIdForIdentify(socket.id);
      console.log(
        'Conectado al servidor, identificando como:',
        identifiedAs,
        currentRole,
        anon ? '(anónimo)' : ''
      );
      emitSocketIdentify();
      const sid = socket.id ?? null;
      if (lastResumeSocketIdRef.current === sid) {
        return;
      }
      lastResumeSocketIdRef.current = sid;
      resumeMatchmakingAfterConnect();
    };

    const onDisconnect = () => {
      lastResumeSocketIdRef.current = null;
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();

    socket.on('waiting_for_match', () => setMatchStatus('waiting'));
    socket.on('match_found', (data) => {
      setMatchData(data.room_id, data.initiator);
    });
    socket.on('online_users_count', (data) => {
      setOnlineUsers(data.count);
    });

    const onChatMessage = (payload: {
      text: string;
      sender_sid: string;
      sender_label?: string;
      sender_language?: string | null;
      ts: number;
    }) => {
      const mySid = socket.id ?? '';
      const raw = payload.text;
      const lineId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? `${payload.ts}-${payload.sender_sid}-${crypto.randomUUID()}`
          : `${payload.ts}-${payload.sender_sid}-${Math.random().toString(36).slice(2)}`;

      setChatMessages((prev) => [
        ...prev,
        {
          id: lineId,
          text: raw,
          mine: payload.sender_sid === mySid,
          senderLabel: payload.sender_label,
          ts: payload.ts,
        },
      ]);

      void (async () => {
        const st = useAppStore.getState();
        const target = resolveTranslateTargetLang(translateModeRef.current, st.language);
        const seg = await translateForChatDisplay(raw, target, st.token);
        setChatMessages((prev) =>
          prev.map((m) => (m.id === lineId ? { ...m, ...mergeTranslatedChatLine(raw, seg, m) } : m))
        );
      })();
    };
    socket.on('chat_message', onChatMessage);

    const onExemptionsUpdated = (p: {
      user_id?: number;
      exempt_from_ai_censorship?: boolean;
      exempt_from_ban?: boolean;
    }) => {
      const st = useAppStore.getState();
      const uid = st.userId?.trim();
      if (!uid || p.user_id == null || String(p.user_id) !== uid) return;
      if (typeof p.exempt_from_ai_censorship === 'boolean') {
        st.applyServerExemptionSync({ exemptFromAiCensorship: p.exempt_from_ai_censorship });
      }
    };
    socket.on('exemptions_updated', onExemptionsUpdated);

    const onNsfwGlobalSettingsUpdated = (p: PublicNsfwDetectionSettings) => {
      if (
        typeof p?.probability_threshold !== 'number' ||
        typeof p?.frame_interval_ms !== 'number' ||
        typeof p?.low_frames_to_clear !== 'number' ||
        typeof p?.streak_ms !== 'number' ||
        typeof p?.grace_false_ms !== 'number'
      ) {
        return;
      }
      setNsfwPublic(p);
    };
    socket.on('nsfw_global_settings_updated', onNsfwGlobalSettingsUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('waiting_for_match');
      socket.off('match_found');
      socket.off('online_users_count');
      socket.off('chat_message', onChatMessage);
      socket.off('exemptions_updated', onExemptionsUpdated);
      socket.off('nsfw_global_settings_updated', onNsfwGlobalSettingsUpdated);
    };
  }, [resumeMatchmakingAfterConnect, setMatchStatus, setMatchData]);

  /** Chat de la sala: vaciar al salir del match o al cambiar de sala (otro usuario). */
  useEffect(() => {
    if (matchStatus !== 'matched') {
      setChatMessages([]);
      setMobileChatHidden(false);
    }
  }, [matchStatus]);

  useEffect(() => {
    setChatMessages([]);
  }, [roomId]);

  const handleChatSend = useCallback(
    (text: string) => {
      const { matchStatus: ms } = useAppStore.getState();
      if (ms !== 'matched' || !socket.connected) return;
      socket.emit('chat_message', { text });
    },
    []
  );

  // Al estar en idle con socket listo (p. ej. tras cortar otro usuario), entrar solo en la cola.
  useEffect(() => {
    if (matchStatus !== 'idle') return;
    if (!socket.connected) return;
    requestNewMatch();
  }, [matchStatus, requestNewMatch]);

  const handleStartNext = useCallback(() => {
    requestNewMatch();
  }, [requestNewMatch]);

  const {
    showPipButton,
    isFloatingOpen,
    toggleFloating,
  } = useMatchFloatingWindow({
    matchStatus,
    remoteVideoRef,
    micMuted,
    onToggleMic: toggleMicMuted,
    onNext: handleStartNext,
  });

  const handleStop = useCallback(() => {
    // Disconnect from current peer and stop matchmaking
    socket.emit('cancel_matchmaking', {});
    stopMatch();
  }, [stopMatch]);

  const speedDialActions = useMemo((): SpeedDialAction[] => {
    const actions: SpeedDialAction[] = [
      {
        id: 'mic',
        label: micMuted ? 'Activar micrófono' : 'Silenciar micrófono',
        icon: micMuted ? <MicOff size={20} strokeWidth={2} /> : <Mic size={20} strokeWidth={2} />,
        onClick: toggleMicMuted,
        hidden: matchStatus !== 'matched',
        active: micMuted,
        tone: 'danger',
      },
      {
        id: 'pip',
        label: isFloatingOpen ? 'Cerrar flotante' : 'Ventana flotante',
        icon: <PictureInPicture2 size={20} strokeWidth={2} />,
        onClick: () => void toggleFloating(),
        hidden: matchStatus !== 'matched' || !showPipButton,
        active: isFloatingOpen,
        tone: 'violet',
      },
      {
        id: 'fullscreen',
        label: isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa',
        icon: isFullscreen ? (
          <Minimize2 size={20} strokeWidth={2} />
        ) : (
          <Maximize2 size={20} strokeWidth={2} />
        ),
        onClick: () => void toggleFullscreen(),
        hidden: matchStatus !== 'matched',
        active: isFullscreen,
        tone: 'emerald',
      },
    ];

    if (!mdUp && mobilePipHidden) {
      actions.push({
        id: 'camera',
        label: 'Mostrar mi cámara',
        icon: <Video size={20} strokeWidth={2} />,
        onClick: () => setMobilePipHidden(false),
      });
    }

    if (!mdUp && matchStatus === 'matched' && mobileChatHidden) {
      actions.push({
        id: 'chat',
        label: 'Mostrar chat',
        icon: <MessageSquare size={20} strokeWidth={2} />,
        onClick: () => setMobileChatHidden(false),
      });
    }

    return actions;
  }, [
    matchStatus,
    micMuted,
    isFloatingOpen,
    showPipButton,
    isFullscreen,
    mdUp,
    mobilePipHidden,
    mobileChatHidden,
    toggleMicMuted,
    toggleFloating,
    toggleFullscreen,
  ]);

  const handleResume = useCallback(() => {
    resetMatch();
  }, [resetMatch]);

  const goToSalas = useCallback(() => {
    socket.emit('cancel_matchmaking', {});
    stopMatch();
    setSalaSessionActive(false);
    navigate('/salas', { replace: true });
  }, [stopMatch, setSalaSessionActive, navigate]);

  /** Durante bloqueo IA no debe seguir en cola ni en llamada. */
  useEffect(() => {
    if (!blocksMatchmaking) return;
    const s = useAppStore.getState();
    if (s.matchZone === 'adult') return;
    if (s.matchStatus === 'waiting' || s.matchStatus === 'matched') {
      socket.emit('cancel_matchmaking', {});
      stopMatch();
    }
  }, [blocksMatchmaking, stopMatch]);

  // --- Mobile Swipe Handlers ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
    setSwipeDelta(0);
    setSwipeDirection(null);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const deltaX = e.touches[0].clientX - touchStartXRef.current;
    const deltaY = e.touches[0].clientY - touchStartYRef.current;

    // Only track horizontal swipes
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      setSwipeDelta(deltaX);
      if (deltaX > 30) setSwipeDirection('right');
      else if (deltaX < -30) setSwipeDirection('left');
      else setSwipeDirection(null);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (Math.abs(swipeDelta) >= SWIPE_THRESHOLD) {
      if (swipeDirection === 'left') {
        // Swipe izquierda → siguiente persona
        handleStartNext();
      } else if (swipeDirection === 'right') {
        // Swipe derecha → detener
        if (matchStatus === 'matched' || matchStatus === 'waiting') {
          handleStop();
        }
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    setSwipeDelta(0);
    setSwipeDirection(null);
  }, [swipeDelta, swipeDirection, handleStartNext, handleStop, matchStatus]);

  // Clamp the delta for visual feedback
  const clampedDelta = Math.max(-150, Math.min(150, swipeDelta));
  const swipeOpacity = Math.min(Math.abs(clampedDelta) / SWIPE_THRESHOLD, 1);

  const onPipHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pipDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: mobilePipPos.x,
      origY: mobilePipPos.y,
    };
  }, [mobilePipPos]);

  const onPipHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!pipDragRef.current || typeof window === 'undefined') return;
    const dx = e.clientX - pipDragRef.current.startX;
    const dy = e.clientY - pipDragRef.current.startY;
    const nx = pipDragRef.current.origX + dx;
    const ny = pipDragRef.current.origY + dy;
    const maxX = window.innerWidth - MOBILE_PIP_W - 8;
    const maxY = window.innerHeight - MOBILE_PIP_H - 8;
    setMobilePipPos({
      x: Math.min(Math.max(8, nx), maxX),
      y: Math.min(Math.max(72, ny), maxY),
    });
  }, []);

  const onPipHandlePointerUp = useCallback((e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    pipDragRef.current = null;
  }, []);

  const localCameraMarkup = (
    <>
      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className={`absolute inset-0 w-full h-full object-cover transform transition-all duration-500 ${facingMode === 'user' ? 'scale-x-[-1]' : ''} ${visualBlur ? 'blur-xl grayscale brightness-50' : ''}`}
      />
      {overlayKind === 'permanent' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white p-3 text-center z-[11]">
          <ShieldAlert size={28} className="mb-2 text-red-500 shrink-0" />
          <span className="font-bold text-xs leading-snug px-1">Infringiste las normas de la app</span>
          <span className="text-[10px] text-gray-400 mt-2 leading-snug max-w-[220px]">
            Tu cuenta quedó suspendida de forma permanente en este dispositivo por reiteradas infracciones.
          </span>
        </div>
      )}
      {overlayKind === 'cooldown' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/80 text-white p-3 text-center z-[11]">
          <ShieldAlert size={22} className="mb-1.5 text-amber-400 shrink-0 animate-pulse" />
          <span className="font-bold text-[11px] leading-tight">Cuenta bloqueada temporalmente</span>
          <span className="mt-2 font-mono text-2xl font-black tabular-nums tracking-tight">{cooldownCountdownLabel}</span>
          <span className="text-[9px] text-red-200/90 mt-1">Tiempo restante</span>
          <span className="text-[9px] text-gray-400 mt-2">
            Avisos acumulados: {strikeCount}/{NSFW_STRIKES_FOR_PERMANENT}
          </span>
        </div>
      )}
      {overlayKind === 'live' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/70 text-white p-2 text-center z-10">
          <ShieldAlert size={20} className="mb-1 text-red-500 animate-pulse" />
          <span className="font-bold text-[10px] leading-tight">Bloqueado IA</span>
          <span className="text-[8px] text-red-200/80 mt-1 max-w-[140px]">
            &gt;10 s seguidos activará un bloqueo de 2 min
          </span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 text-white p-2 text-center z-10 text-[10px]">
          {error}
        </div>
      )}
      {isModelLoading && !exemptFromNsfwPolicy && (
        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[9px] text-blue-300 flex items-center gap-1">
          <span className="w-1 h-1 bg-blue-500 rounded-full animate-ping"></span>
          IA
        </div>
      )}
      <div className="absolute top-1 right-1 z-20 flex gap-0.5">
        <button
          type="button"
          onClick={() => toggleMicMuted()}
          className={`p-1 rounded-md bg-black/60 transition-colors hover:bg-black/80 ${
            micMuted ? 'text-red-400 ring-1 ring-red-500/60' : 'text-white'
          }`}
          title={micMuted ? 'Micrófono silenciado — pulsa para hablar' : 'Silenciar micrófono'}
          aria-label={micMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
          aria-pressed={micMuted}
        >
          {micMuted ? <MicOff size={15} strokeWidth={2} /> : <Mic size={15} strokeWidth={2} />}
        </button>
        <button
          type="button"
          onClick={() => void switchCamera()}
          className="p-1 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors"
          title="Cambiar cámara"
          aria-label="Cambiar cámara"
        >
          <SwitchCamera size={15} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => void toggleTorch()}
          disabled={facingMode !== 'environment'}
          className={`p-1 rounded-md bg-black/60 transition-colors disabled:opacity-35 disabled:pointer-events-none ${
            torchOn ? 'text-amber-300 hover:bg-black/80' : 'text-white hover:bg-black/80'
          }`}
          title={facingMode === 'environment' ? 'Flash / linterna' : 'Flash solo en cámara trasera'}
          aria-label="Flash"
        >
          <Flashlight size={15} strokeWidth={2} />
        </button>
      </div>
      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/60 rounded text-[9px] font-semibold">
        {role === 'superadmin' ? 'Tú (SA)' : 'Tú'}
      </div>
    </>
  );

  return (
    <div
      ref={appShellRef}
      className="app-call-shell flex flex-col h-[100dvh] bg-gray-950 text-white overflow-hidden font-sans fullscreen:h-[100dvh] fullscreen:w-screen fullscreen:max-h-none fullscreen:bg-black"
    >
      {/* Header */}
      <header className="p-3 md:p-4 bg-gray-900/90 backdrop-blur-lg border-b border-gray-800/50 flex justify-between items-center shadow-lg z-30 shrink-0 fullscreen:hidden">
        <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Albedrío</h1>
        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={() => navigate('/profile')}
            className="px-2 md:px-3 py-1 text-xs font-bold rounded-full flex items-center gap-1 md:gap-2 transition-colors bg-gray-800 text-gray-200 hover:bg-gray-700 border border-gray-700"
            title="Ver perfil"
          >
            <User size={14} className="text-gray-300" />
            <span className="max-w-[100px] md:max-w-[140px] truncate">
              {displayName || (isAnonymous ? 'Anónimo' : 'Usuario')}
            </span>
            {role === 'superadmin' && (
              <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-black text-[10px]">
                <ShieldCheck size={10} /> SA
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={goToSalas}
            className={`hidden sm:inline text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-gradient-to-r ${zoneDisplay.accent} hover:opacity-90 transition-opacity`}
            title="Cambiar de sala"
          >
            {zoneDisplay.badge} · Cambiar
          </button>

          <span className="text-xs md:text-sm text-gray-400 font-medium">
            En línea: <span className="text-blue-400">{onlineUsers}</span>
          </span>
        </div>
      </header>

      {/* Main: 70% remoto + 30% panel (cámara / chat reservado) en desktop; móvil solo remoto */}
      <main className="flex flex-1 flex-col md:flex-row overflow-hidden bg-black min-h-0 relative fullscreen:flex-1 fullscreen:min-h-0">
        {/* Remoto: pantalla completa en móvil, 70% en desktop */}
        <div
          ref={remoteContainerRef}
          className="group flex-1 md:flex-none md:w-[70%] md:min-w-0 relative flex items-center justify-center overflow-hidden min-h-0 fullscreen:flex-1 fullscreen:w-full fullscreen:max-w-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            controls={false}
            controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
            disablePictureInPicture={false}
            disableRemotePlayback
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              transform: `translateX(${clampedDelta * 0.3}px)`,
              transition: swipeDelta === 0 ? 'transform 0.3s ease-out' : 'none',
            }}
          />

          {/* Swipe visual feedback overlays (mobile only): izquierda = siguiente, derecha = detener */}
          {swipeDirection === 'left' && swipeOpacity > 0.1 && (
            <div
              className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none md:hidden"
              style={{ opacity: swipeOpacity }}
            >
              <div className="bg-blue-500/20 absolute inset-0" />
              <div className="bg-blue-600/90 px-6 py-3 rounded-2xl flex items-center gap-3 shadow-2xl backdrop-blur-sm">
                <SkipForward size={28} className="text-white" />
                <span className="text-white font-bold text-lg">Siguiente</span>
              </div>
            </div>
          )}
          {swipeDirection === 'right' && swipeOpacity > 0.1 && (
            <div
              className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none md:hidden"
              style={{ opacity: swipeOpacity }}
            >
              <div className="bg-red-500/20 absolute inset-0" />
              <div className="bg-red-600/90 px-6 py-3 rounded-2xl flex items-center gap-3 shadow-2xl backdrop-blur-sm">
                <XCircle size={28} className="text-white" />
                <span className="text-white font-bold text-lg">Detener</span>
              </div>
            </div>
          )}

          {/* Esperando match (incluye idle antes de entrar en cola: todo automático) */}
          {(matchStatus === 'idle' || matchStatus === 'waiting') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/80 backdrop-blur-sm z-10 p-4">
              <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4 shrink-0" />
              <p className="text-xl font-medium animate-pulse text-center">
                {matchStatus === 'idle' ? 'Preparando búsqueda...' : 'Buscando en la sala…'}
              </p>
              <p className="text-sm text-gray-400 mt-2 text-center">
                {zoneDisplay.label} — solo personas en esta sala
              </p>
            </div>
          )}

          {/* Stopped overlay */}
          {matchStatus === 'stopped' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/95 z-10 p-4 overflow-y-auto">
              <StopCircle size={40} className="text-red-400 mb-3 shrink-0" />
              <p className="text-lg text-gray-300 font-medium mb-1">Conexión detenida</p>
              <p className="text-sm text-gray-500 mb-6 text-center">
                Sala {zoneDisplay.label}
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={handleResume}
                  className="px-8 py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 shadow-lg bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white"
                >
                  <Play size={20} fill="currentColor" /> Reanudar búsqueda
                </button>
                <button
                  type="button"
                  onClick={goToSalas}
                  className="px-8 py-3 rounded-xl font-bold text-base border border-gray-600 text-gray-200 hover:bg-gray-800 transition-colors"
                >
                  Cambiar sala
                </button>
              </div>
            </div>
          )}
          
          <MatchSpeedDial
            actions={speedDialActions}
            className="absolute top-3 right-3 md:top-4 md:right-4"
          />

          {/* Status badge */}
          <div className="absolute top-3 left-3 md:top-4 md:left-4 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full text-xs font-semibold flex items-center gap-2 z-20">
            <span className={`w-2.5 h-2.5 rounded-full ${
              isReconnecting ? 'bg-orange-500 animate-pulse' 
              : matchStatus === 'matched' ? 'bg-green-500' 
              : matchStatus === 'waiting' || matchStatus === 'idle'
              ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.8)]'
              : matchStatus === 'stopped' ? 'bg-red-500'
              : 'bg-gray-500'
            }`}></span>
            {isReconnecting ? 'Recuperando conexión...' 
              : matchStatus === 'matched' ? 'Conectado' 
              : matchStatus === 'waiting' ? 'Buscando' 
              : matchStatus === 'idle' ? 'Buscando'
              : matchStatus === 'stopped' ? 'Detenido'
              : 'Desconectado'}
          </div>

          {/* Reconnection overlay */}
          {isReconnecting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] z-10 transition-all duration-300">
               <div className="flex items-center gap-2 px-4 py-2 bg-orange-600/90 text-white rounded-lg font-bold shadow-xl animate-bounce">
                  <ShieldCheck size={20} />
                  <span>RECUPERANDO SEÑAL...</span>
               </div>
            </div>
          )}

          {/* ===== BOTTOM CONTROLS BAR =====
              Móvil: solo texto de ayuda al deslizar (sin botones). Desktop: barra completa + hover sobre el remoto. */}
          <div
            className="absolute bottom-0 left-0 right-0 z-20 transition-all duration-300 ease-out
              opacity-100 translate-y-0 pointer-events-auto
              md:opacity-0 md:pointer-events-none md:translate-y-2
              md:group-hover:opacity-100 md:group-hover:pointer-events-auto md:group-hover:translate-y-0"
          >
            {/* Gradient: más ligero en móvil porque no hay controles grandes */}
            <div className="h-12 md:h-16 bg-gradient-to-t from-black/70 via-black/25 to-transparent pointer-events-none" />
            
            <div className="bg-black/55 backdrop-blur-md px-3 py-2 md:py-2.5 pb-3 md:border-t border-white/5">
              {/* Móvil: solo instrucciones */}
              <p className="text-[9px] text-center text-gray-500 uppercase tracking-widest font-medium flex items-center justify-center gap-2 md:hidden">
                <span>← Sig.</span>
                <span className="w-1 h-1 rounded-full bg-gray-600 shrink-0"></span>
                <span>Desliza</span>
                <span className="w-1 h-1 rounded-full bg-gray-600 shrink-0"></span>
                <span>Det. →</span>
              </p>
              
              <div className="hidden md:flex items-center justify-center gap-4 md:gap-6">
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={matchStatus === 'idle' || matchStatus === 'stopped'}
                  className="h-11 w-11 md:h-10 md:w-10 shrink-0 rounded-full flex items-center justify-center text-white shadow-md bg-gradient-to-br from-red-600 to-rose-700 ring-1 ring-white/10 transition-all duration-200 hover:shadow-lg hover:shadow-red-900/40 hover:scale-110 hover:ring-2 hover:ring-white/30 hover:brightness-110 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 disabled:hover:shadow-md disabled:pointer-events-none"
                  id="btn-stop"
                  title="Detener"
                  aria-label="Detener conexión"
                >
                  <XCircle size={22} strokeWidth={2} />
                </button>
                {/* IA — compacto */}
                <div className="flex items-center gap-1 px-2 py-1 md:px-2.5 md:py-1 rounded-full bg-white/5 border border-white/10 text-[9px] text-gray-400 uppercase tracking-wide font-semibold shrink-0">
                  <ShieldCheck size={11} className="text-green-400 shrink-0" />
                  <span>IA</span>
                  <span className="text-gray-500">24/7</span>
                </div>

                <button
                  type="button"
                  onClick={handleStartNext}
                  disabled={matchStatus === 'waiting' || matchStatus === 'stopped'}
                  className="h-11 w-11 md:h-10 md:w-10 shrink-0 rounded-full flex items-center justify-center text-white shadow-md bg-gradient-to-br from-blue-600 to-indigo-700 ring-1 ring-white/10 transition-all duration-200 hover:shadow-lg hover:shadow-blue-900/40 hover:scale-110 hover:ring-2 hover:ring-white/30 hover:brightness-110 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 disabled:hover:shadow-md disabled:pointer-events-none"
                  id="btn-next"
                  title={matchStatus === 'idle' ? 'Iniciar' : 'Siguiente'}
                  aria-label={matchStatus === 'idle' ? 'Iniciar búsqueda' : 'Siguiente persona'}
                >
                  {matchStatus === 'idle' ? (
                    <Play size={22} fill="currentColor" className="ml-0.5" />
                  ) : (
                    <SkipForward size={22} fill="currentColor" />
                  )}
                </button>

              </div>
            </div>
          </div>
        </div>

        {/* Móvil: chat bajo el vídeo (se puede ocultar para ver más vídeo) */}
        {!mdUp && matchStatus === 'matched' && !mobileChatHidden && (
          <div className="flex-none h-[min(30vh,240px)] min-h-[128px] border-t border-gray-800 bg-gray-950 flex flex-col overflow-hidden shrink-0 fullscreen:hidden">
            <MatchChatPanel
              messages={chatMessages}
              onSend={handleChatSend}
              disabled={matchStatus !== 'matched'}
              variant="mobile"
              onHideChat={() => setMobileChatHidden(true)}
              translateMode={translateMode}
              onTranslateModeChange={setTranslateMode}
              profileLanguageCode={language}
              translateTargetLabel={translateTargetLabel}
            />
          </div>
        )}

        {/* Desktop: 30% — mitad cámara local / mitad chat */}
        {mdUp && (
          <aside className="flex flex-none w-[30%] min-w-0 flex-col bg-gray-950 border-l border-gray-800 z-10 fullscreen:hidden">
            <div className="h-1/2 min-h-0 flex flex-col bg-black shrink-0 border-b border-gray-800 relative overflow-hidden">
              <div className="absolute inset-0 bg-gray-900">{localCameraMarkup}</div>
            </div>
            <div className="h-1/2 min-h-0 flex flex-col border-t border-gray-900/80 bg-gray-950 overflow-hidden">
              <MatchChatPanel
                messages={chatMessages}
                onSend={handleChatSend}
                disabled={matchStatus !== 'matched'}
                variant="desktop"
                translateMode={translateMode}
                onTranslateModeChange={setTranslateMode}
                profileLanguageCode={language}
                translateTargetLabel={translateTargetLabel}
              />
            </div>
          </aside>
        )}

        {/* Móvil: PIP arrastrable (solo cuando la cámara local no está en el panel desktop) */}
        {!mdUp && !mobilePipHidden && (
          <div
            className="md:hidden fixed z-[45] flex flex-col rounded-xl overflow-hidden shadow-2xl border-2 border-gray-700/60 bg-gray-900 touch-none fullscreen:hidden"
            style={{
              width: MOBILE_PIP_W,
              height: MOBILE_PIP_H,
              left: mobilePipPos.x,
              top: mobilePipPos.y,
            }}
          >
            <div
              role="presentation"
              onPointerDown={onPipHandlePointerDown}
              onPointerMove={onPipHandlePointerMove}
              onPointerUp={onPipHandlePointerUp}
              onPointerCancel={onPipHandlePointerUp}
              className="h-9 flex items-center justify-between px-2 bg-gray-900/95 border-b border-gray-800 cursor-grab active:cursor-grabbing select-none"
            >
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 min-w-0 shrink">
                <GripVertical size={14} className="shrink-0" />
                <span className="truncate">Tu cámara</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMobilePipHidden(true);
                }}
                className="p-1 rounded-lg shrink-0 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                title="Ocultar mi pantalla"
                aria-label="Ocultar mi pantalla"
              >
                <EyeOff size={16} />
              </button>
            </div>
            <div className="relative flex-1 min-h-0 bg-black">
              {localCameraMarkup}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
