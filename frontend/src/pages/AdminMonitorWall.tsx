import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Circle,
  Grid3X3,
  Maximize2,
  MessageSquare,
  Minimize2,
  RefreshCw,
  Search,
  Square,
  User,
  Volume2,
  VolumeX,
  X,
  XCircle,
  Video,
  VideoOff,
  MoreHorizontal,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { apiUrl } from '../config/apiBase';
import { socket } from '../sockets/socket';
import { resolveUserIdForIdentify } from '../utils/resolveSocketUserId';
import type { DashboardUser } from '../types/adminDashboard';
import {
  MONITOR_WALL_SLOT_COUNT,
  bindingFromUser,
  bindingLabel,
  resolveUserByBinding,
} from '../utils/adminMonitorSlots';
import { useAdminMonitorWall } from '../hooks/useAdminMonitorWall';
import { startMonitorRecording, startMonitorWallGridRecording } from '../utils/adminMonitorRecorder';
import { MatchChatPanel, type ChatLine } from '../components/MatchChatPanel';
import { useChatTranslateMode } from '../hooks/useChatTranslateMode';
import { MD_UP_MQ, useMdUp } from '../hooks/useMdUp';
import { tryLockScreenLandscape } from '../utils/screenOrientation';
import {
  mergeTranslatedChatLine,
  resolveTranslateTargetLang,
  translateForChatDisplay,
} from '../utils/chatTranslate';

function statusLabel(u: DashboardUser | null): string {
  if (!u || !u.sid) return 'Desconectado';
  if (u.presence === 'in_call') return 'En llamada';
  if (u.presence === 'waiting') return 'Esperando';
  return 'Desconectado';
}

type AssignUserPickerProps = {
  slotIndex: number;
  userSearch: string;
  onUserSearchChange: (q: string) => void;
  candidates: DashboardUser[];
  onSelect: (user: DashboardUser) => void;
  listClassName?: string;
};

function AssignUserPickerList({
  slotIndex: _slotIndex,
  userSearch,
  onUserSearchChange,
  candidates,
  onSelect,
  listClassName = '',
}: AssignUserPickerProps) {
  return (
    <>
      <div className="shrink-0 px-4 pb-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={userSearch}
            onChange={(e) => onUserSearchChange(e.target.value)}
            placeholder="Buscar usuario…"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white outline-none focus:border-cyan-500"
            autoFocus
          />
        </div>
      </div>
      <div
        className={`flex-1 overflow-y-auto overscroll-contain px-4 pb-2 space-y-2 min-h-0 ${listClassName}`}
      >
        {candidates.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-10">No hay usuarios en línea.</p>
        ) : (
          candidates.map((u) => (
            <button
              key={u.row_key}
              type="button"
              onClick={() => onSelect(u)}
              className="w-full text-left rounded-xl px-4 py-3 bg-gray-900 border border-gray-800 hover:bg-gray-800 active:bg-gray-700"
            >
              <p className="text-sm font-semibold text-white truncate">{u.display_name || 'Usuario'}</p>
              <p className="text-xs text-gray-500 mt-0.5">{statusLabel(u)}</p>
            </button>
          ))
        )}
      </div>
    </>
  );
}

export default function AdminMonitorWall() {
  const { token, displayName, role, userId, language } = useAppStore();
  const mdUp = useMdUp();
  const { mode: translateMode, setMode: setTranslateMode } = useChatTranslateMode();
  const translateModeRef = useRef(translateMode);
  translateModeRef.current = translateMode;

  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [slotMenuSlot, setSlotMenuSlot] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);
  const [focusAudioOn, setFocusAudioOn] = useState(true);
  const [monitorChatHidden, setMonitorChatHidden] = useState(false);
  const [monitorChatMessages, setMonitorChatMessages] = useState<ChatLine[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordMode, setRecordMode] = useState<'focus' | 'wall'>('focus');
  const [recordElapsedSec, setRecordElapsedSec] = useState(0);
  const [monitorFullscreen, setMonitorFullscreen] = useState(false);

  const monitorPanelRef = useRef<HTMLDivElement>(null);
  const focusVideoPrimaryRef = useRef<HTMLVideoElement>(null);
  const focusVideoPeerRef = useRef<HTMLVideoElement>(null);
  const focusAudioPrimaryRef = useRef<HTMLAudioElement>(null);
  const focusAudioPeerRef = useRef<HTMLAudioElement>(null);
  const recorderStopRef = useRef<(() => Promise<void>) | null>(null);
  const recordTimerRef = useRef<number | null>(null);

  const {
    bindings,
    audioEnabled,
    streamTick,
    setSlotBinding,
    clearAllSlots,
    toggleSlotAudio,
    setVideoRef,
    setAudioRef,
    getStreamForSid,
    getSlotMeta,
    getVideoAtSlot,
  } = useAdminMonitorWall(users);

  const focusMeta = focusedSlot != null ? getSlotMeta(focusedSlot) : null;
  const focusPeerSid = focusMeta?.peerSid ?? null;

  const translateTargetLabel = useMemo(
    () => resolveTranslateTargetLang(translateMode, language),
    [translateMode, language]
  );

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(apiUrl('/api/admin/dashboard-users'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const data = (await r.json()) as { users?: DashboardUser[] };
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchUsers();
    const id = window.setInterval(() => void fetchUsers(), 5000);
    return () => clearInterval(id);
  }, [fetchUsers]);

  useEffect(() => {
    if (!socket.connected) socket.connect();
    const onConnect = () => {
      socket.emit('identify', {
        user_id: resolveUserIdForIdentify(socket.id),
        role,
        display_name: displayName,
        gender: null,
        country: null,
        language: null,
        birth_year: null,
        is_anonymous: false,
      });
    };
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
    };
  }, [role, displayName, userId]);

  useEffect(() => {
    const onRelay = (payload: {
      text: string;
      sender_sid: string;
      sender_label?: string;
      ts: number;
    }) => {
      const raw = payload.text;
      const lineId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? `${payload.ts}-${payload.sender_sid}-${crypto.randomUUID()}`
          : `${payload.ts}-${payload.sender_sid}-${Math.random().toString(36).slice(2)}`;
      setMonitorChatMessages((prev) => [
        ...prev,
        {
          id: lineId,
          text: raw,
          mine: false,
          senderLabel: payload.sender_label,
          ts: payload.ts,
        },
      ]);
      void (async () => {
        const st = useAppStore.getState();
        const target = resolveTranslateTargetLang(translateModeRef.current, st.language);
        const seg = await translateForChatDisplay(raw, target, st.token);
        setMonitorChatMessages((prev) =>
          prev.map((m) => (m.id === lineId ? { ...m, ...mergeTranslatedChatLine(raw, seg, m) } : m))
        );
      })();
    };
    socket.on('admin_chat_relay', onRelay);
    return () => {
      socket.off('admin_chat_relay', onRelay);
    };
  }, []);

  useEffect(() => {
    if (focusedSlot == null) {
      setMonitorChatMessages([]);
      setMonitorChatHidden(false);
    }
  }, [focusedSlot]);

  useEffect(() => {
    const onFs = () => setMonitorFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    if (!isRecording) {
      if (recordTimerRef.current != null) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      setRecordElapsedSec(0);
      return;
    }
    recordTimerRef.current = window.setInterval(() => {
      setRecordElapsedSec((s) => s + 1);
    }, 1000);
    return () => {
      if (recordTimerRef.current != null) window.clearInterval(recordTimerRef.current);
    };
  }, [isRecording]);

  useEffect(() => {
    if (focusedSlot == null) return;
    const primarySid = focusMeta?.primarySid ?? null;
    const peerSid = focusMeta?.peerSid ?? null;
    const pStream = getStreamForSid(primarySid);
    const peerStream = getStreamForSid(peerSid);

    if (focusVideoPrimaryRef.current) {
      focusVideoPrimaryRef.current.srcObject = pStream;
      focusVideoPrimaryRef.current.muted = true;
    }
    if (focusVideoPeerRef.current) {
      focusVideoPeerRef.current.srcObject = peerStream;
      focusVideoPeerRef.current.muted = true;
    }

    const ap = focusAudioPrimaryRef.current;
    if (ap) {
      if (focusAudioOn && pStream) {
        ap.srcObject = pStream;
        void ap.play().catch(() => {});
      } else {
        ap.pause();
        ap.srcObject = null;
      }
    }
    const ape = focusAudioPeerRef.current;
    if (ape) {
      if (focusAudioOn && peerStream) {
        ape.srcObject = peerStream;
        void ape.play().catch(() => {});
      } else {
        ape.pause();
        ape.srcObject = null;
      }
    }
  }, [focusedSlot, focusMeta, focusAudioOn, streamTick, getStreamForSid]);

  const stopRecording = useCallback(async () => {
    const fn = recorderStopRef.current;
    recorderStopRef.current = null;
    if (fn) await fn();
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(
    (mode: 'focus' | 'wall') => {
      if (isRecording) return;
      if (mode === 'focus' && focusedSlot == null) return;
      try {
        const { stop } =
          mode === 'wall'
            ? startMonitorWallGridRecording({
                slotCount: MONITOR_WALL_SLOT_COUNT,
                cols: 4,
                getVideoAtSlot,
                isAudioAtSlot: (i) => audioEnabled[i],
              })
            : startMonitorRecording({
                getVideoPrimary: () => focusVideoPrimaryRef.current,
                getVideoPeer: () => focusVideoPeerRef.current,
                getHasPeer: () => !!focusPeerSid,
              });
        recorderStopRef.current = stop;
        setRecordMode(mode);
        setIsRecording(true);
      } catch (e) {
        console.error('Grabación:', e);
        alert('No se pudo iniciar la grabación en este navegador.');
      }
    },
    [isRecording, focusedSlot, focusPeerSid, getVideoAtSlot, audioEnabled]
  );

  const toggleMonitorFullscreen = async () => {
    const el = monitorPanelRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        const mobile = typeof window !== 'undefined' && !window.matchMedia(MD_UP_MQ).matches;
        if (mobile) await tryLockScreenLandscape();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
  };

  const onlineUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.sid &&
          u.role !== 'superadmin' &&
          (u.presence === 'in_call' || u.presence === 'waiting')
      ),
    [users]
  );

  const usedBindings = useMemo(() => new Set(bindings.filter(Boolean)), [bindings]);

  const pickerCandidates = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const currentBinding = pickerSlot != null ? bindings[pickerSlot] : null;
    return onlineUsers
      .filter((u) => {
        const b = bindingFromUser(u);
        if (!b) return false;
        if (usedBindings.has(b) && b !== currentBinding) return false;
        if (!q) return true;
        const hay = `${u.display_name} ${u.user_id ?? ''} ${u.country ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
  }, [onlineUsers, userSearch, usedBindings, pickerSlot, bindings]);

  const assignUser = (slotIndex: number, user: DashboardUser) => {
    setSlotBinding(slotIndex, bindingFromUser(user));
    closePicker();
  };

  const clearSlot = (slotIndex: number) => {
    setSlotBinding(slotIndex, null);
    if (focusedSlot === slotIndex) setFocusedSlot(null);
    setPickerSlot(null);
  };

  const openFocus = (slotIndex: number) => {
    if (!bindings[slotIndex]) return;
    setFocusedSlot(slotIndex);
    setPickerSlot(null);
  };

  const openPicker = (slotIndex: number) => {
    setSlotMenuSlot(null);
    setPickerSlot(slotIndex);
    setUserSearch('');
    if (!mdUp) setFocusedSlot(null);
  };

  const closePicker = () => {
    setPickerSlot(null);
    setUserSearch('');
  };

  const compact = !mdUp;
  const showFocusPanel = focusedSlot != null && focusMeta != null && (!compact || pickerSlot == null);

  return (
    <div className="h-dvh min-h-0 flex flex-col bg-black text-gray-200 font-sans overflow-hidden">
      <header className="shrink-0 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center justify-between gap-2 px-2 py-2 sm:px-3">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {compact && focusedSlot != null ? (
              <button
                type="button"
                onClick={() => setFocusedSlot(null)}
                className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 shrink-0"
                title="Volver al muro"
              >
                <ArrowLeft size={20} />
              </button>
            ) : (
              <Link
                to="/admin"
                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 shrink-0"
                title="Volver al panel"
              >
                <ArrowLeft size={20} />
              </Link>
            )}
            <Grid3X3 size={20} className="text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white truncate leading-tight">
                {compact && focusedSlot != null
                  ? `Monitor ${focusedSlot + 1}`
                  : 'Muro de monitores'}
              </h1>
              <p className="text-[10px] text-gray-500 truncate">
                {compact && focusedSlot != null && focusMeta?.user?.display_name
                  ? focusMeta.user.display_name
                  : compact
                    ? 'Toca ventana · usuario = asignar'
                    : 'Clic en ventana = monitor activo · altavoz = escuchar'}
              </p>
            </div>
          </div>
          {(!compact || focusedSlot == null) && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => void fetchUsers()}
                className="p-2 rounded-lg bg-gray-800 border border-gray-700 hover:bg-gray-700"
                title="Actualizar"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
              {!isRecording ? (
                <button
                  type="button"
                  onClick={() => startRecording('wall')}
                  className="hidden sm:inline text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 hover:bg-gray-700"
                  title="Grabar muro"
                >
                  Grabar
                </button>
              ) : recordMode === 'wall' ? (
                <button
                  type="button"
                  onClick={() => void stopRecording()}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-white bg-red-700 text-[10px] font-mono"
                >
                  <Square size={12} className="fill-current" />
                  {String(Math.floor(recordElapsedSec / 60)).padStart(2, '0')}:
                  {String(recordElapsedSec % 60).padStart(2, '0')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={clearAllSlots}
                className="text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 hover:bg-gray-700"
              >
                Limpiar
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col xl:flex-row overflow-hidden">
        <div
          className={`min-h-0 min-w-0 p-2 md:p-3 ${
            compact && focusedSlot != null ? 'hidden' : 'flex-1 overflow-y-auto overscroll-contain'
          }`}
        >
          <div className="w-full grid grid-cols-2 xl:grid-cols-4 gap-2 md:gap-1.5">
            {Array.from({ length: MONITOR_WALL_SLOT_COUNT }, (_, i) => {
              const binding = bindings[i];
              const user = resolveUserByBinding(users, binding);
              const live = Boolean(user?.sid && user.presence !== 'offline');
              const isPicking = pickerSlot === i;
              const isFocused = focusedSlot === i;
              const audioOn = audioEnabled[i];

              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (compact) {
                      if (binding) openFocus(i);
                      else openPicker(i);
                    } else if (binding) openFocus(i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    if (compact && !binding) openPicker(i);
                    else if (binding) openFocus(i);
                  }}
                  className={`relative aspect-video rounded-lg overflow-hidden border bg-gray-950 text-left cursor-pointer ${
                    isFocused
                      ? 'border-cyan-500 ring-2 ring-cyan-500/50'
                      : isPicking
                        ? 'border-cyan-500/60'
                        : 'border-gray-800'
                  }`}
                >
                  <video
                    ref={(el) => setVideoRef(i, el)}
                    autoPlay
                    playsInline
                    muted
                    className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${
                      live ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <audio ref={(el) => setAudioRef(i, el)} className="hidden" />
                  <div
                    className={`absolute inset-0 flex flex-col pointer-events-none ${
                      live ? 'bg-transparent' : 'bg-gradient-to-br from-gray-900 to-gray-950'
                    }`}
                  >
                    {!live && (
                      <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-1 p-2">
                        <VideoOff size={compact ? 28 : 24} strokeWidth={1.5} />
                        <span className={`text-center ${compact ? 'text-xs' : 'text-[10px]'}`}>
                          {binding ? 'Sin señal' : compact ? 'Toca para asignar' : 'Vacío'}
                        </span>
                      </div>
                    )}
                    <div className="mt-auto bg-black/85 px-2 py-1.5 flex items-center justify-between gap-1 pointer-events-auto">
                      <div className="min-w-0">
                        <p
                          className={`font-bold text-white truncate leading-tight ${
                            compact ? 'text-xs' : 'text-[10px]'
                          }`}
                        >
                          {binding ? bindingLabel(users, binding) : `Monitor ${i + 1}`}
                        </p>
                        <p className={`text-gray-400 truncate ${compact ? 'text-[10px]' : 'text-[9px]'}`}>
                          {statusLabel(user)}
                        </p>
                      </div>
                      {compact ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSlotMenuSlot(i);
                          }}
                          className="p-1.5 rounded-lg bg-gray-800 text-gray-200 hover:bg-gray-700 shrink-0"
                          title="Opciones"
                          aria-label="Opciones del monitor"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      ) : (
                      <div className="flex shrink-0 gap-0.5">
                        {live && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSlotAudio(i);
                            }}
                            className={`p-1 rounded ${
                              audioOn
                                ? 'bg-emerald-900/60 text-emerald-300'
                                : 'bg-gray-800 text-gray-500 hover:text-white'
                            }`}
                            title={audioOn ? 'Silenciar esta ventana' : 'Escuchar esta ventana'}
                          >
                            {audioOn ? <Volume2 size={12} /> : <VolumeX size={12} />}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPicker(i);
                          }}
                          className="p-1 rounded bg-gray-800 text-cyan-300 hover:bg-gray-700"
                          title="Asignar usuario"
                        >
                          <User size={12} />
                        </button>
                        {binding && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearSlot(i);
                            }}
                            className="p-1 rounded bg-gray-800 text-red-300 hover:bg-gray-700"
                            title="Quitar"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      )}
                    </div>
                  </div>
                  <span className="absolute top-1 left-1 text-[9px] font-mono bg-black/60 text-gray-400 px-1 rounded pointer-events-none">
                    {i + 1}
                  </span>
                  {live && (
                    <span className="absolute top-1 right-1 flex items-center gap-0.5 text-[8px] font-bold uppercase text-red-400 bg-black/60 px-1 rounded pointer-events-none">
                      <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
                      Live
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div
          ref={monitorPanelRef}
          className={`flex flex-col bg-gray-900 border-gray-800 min-h-0 fullscreen:fixed fullscreen:inset-0 fullscreen:z-[200] fullscreen:w-screen fullscreen:h-[100dvh] fullscreen:rounded-none fullscreen:border-0 ${
            showFocusPanel
              ? compact
                ? 'flex-1 w-full border-0'
                : 'shrink-0 w-full xl:w-[min(92vw,520px)] border-t xl:border-t-0 xl:border-l xl:max-h-none'
              : 'hidden xl:flex xl:shrink-0 xl:w-[min(92vw,520px)] xl:max-w-0 xl:overflow-hidden xl:border-0'
          }`}
        >
          {showFocusPanel ? (
            <>
              <div className="p-2 sm:p-3 border-b border-gray-800 bg-gray-800/50 flex items-center justify-between gap-2 shrink-0">
                <h2 className="font-bold text-purple-400 text-sm flex items-center gap-2 min-w-0 xl:flex">
                  <Video size={16} className="shrink-0 hidden xl:block" />
                  <span className="truncate hidden xl:inline">
                    Monitor {focusedSlot! + 1}: {focusMeta!.user?.display_name || '—'}
                  </span>
                  <span className="text-xs text-gray-400 xl:hidden">Controles</span>
                </h2>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setFocusAudioOn((v) => !v)}
                    className={`p-2 rounded-lg transition-colors ${
                      focusAudioOn
                        ? 'text-emerald-400 bg-emerald-950/50'
                        : 'text-gray-500 hover:text-white hover:bg-gray-700'
                    }`}
                    title={focusAudioOn ? 'Silenciar audio del monitor' : 'Activar audio'}
                  >
                    {focusAudioOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
                  </button>
                  {!isRecording || recordMode !== 'focus' ? (
                    <button
                      type="button"
                      onClick={() => startRecording('focus')}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700"
                      title="Grabar este monitor"
                    >
                      <Circle size={18} className="text-red-500 fill-red-500/90" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void stopRecording()}
                      className="flex items-center gap-1 p-2 rounded-lg text-white bg-red-700 text-xs font-mono"
                    >
                      <Square size={14} className="fill-current" />
                      {String(Math.floor(recordElapsedSec / 60)).padStart(2, '0')}:
                      {String(recordElapsedSec % 60).padStart(2, '0')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMonitorChatHidden((v) => !v)}
                    className={`p-2 rounded-lg ${
                      monitorChatHidden
                        ? 'text-gray-400 hover:text-blue-400'
                        : 'text-blue-400'
                    } hover:bg-gray-700`}
                    title="Chat"
                  >
                    <MessageSquare size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleMonitorFullscreen()}
                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700"
                    title="Pantalla completa"
                  >
                    {monitorFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusedSlot(null)}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700"
                    title="Cerrar monitor activo"
                  >
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
              <audio ref={focusAudioPrimaryRef} className="hidden" />
              <audio ref={focusAudioPeerRef} className="hidden" />
              <div className="flex flex-col flex-1 min-h-0 min-w-0">
                <div
                  className={`flex-1 bg-black grid min-h-0 ${
                    focusPeerSid
                      ? compact
                        ? 'grid-cols-1 grid-rows-2 divide-y divide-gray-800'
                        : 'grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-800'
                      : 'grid-cols-1'
                  }`}
                >
                  <div className={`relative bg-gray-950 ${compact && focusPeerSid ? 'min-h-[22dvh]' : 'min-h-[120px]'}`}>
                    <video
                      ref={focusVideoPrimaryRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute bottom-2 left-2 bg-black/75 text-[10px] px-2 py-1 rounded">
                      Monitoreado
                    </div>
                  </div>
                  {focusPeerSid ? (
                    <div className={`relative bg-gray-950 ${compact ? 'min-h-[22dvh]' : 'min-h-[120px]'}`}>
                      <video
                        ref={focusVideoPeerRef}
                        autoPlay
                        playsInline
                        muted
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute bottom-2 left-2 bg-black/75 text-[10px] px-2 py-1 rounded">
                        Interlocutor
                      </div>
                    </div>
                  ) : null}
                </div>
                {!monitorChatHidden && (
                  <div
                    className={`shrink-0 border-t border-gray-800 bg-gray-950 flex flex-col min-h-[88px] ${
                      compact ? 'max-h-[min(28dvh,160px)]' : 'max-h-[min(28vh,180px)]'
                    }`}
                  >
                    <MatchChatPanel
                      messages={monitorChatMessages}
                      readOnly
                      variant={mdUp ? 'desktop' : 'mobile'}
                      headerTitle="Chat en vivo (salas vigiladas)"
                      emptyReadOnlyHint="Sin mensajes en las salas asignadas."
                      onHideChat={() => setMonitorChatHidden(true)}
                      translateMode={translateMode}
                      onTranslateModeChange={setTranslateMode}
                      profileLanguageCode={language}
                      translateTargetLabel={translateTargetLabel}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="hidden xl:flex flex-1 items-center justify-center p-6 text-center text-sm text-gray-500">
              Haz clic en una ventana del muro para abrir el monitor activo con audio, chat y grabación.
            </div>
          )}
        </div>

        {compact && pickerSlot != null && (
            <div
              className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="assign-monitor-title"
              onClick={closePicker}
            >
            <div
              className="relative w-full max-w-md max-h-[min(85dvh,560px)] flex flex-col rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-800">
                <h2 id="assign-monitor-title" className="text-base font-bold text-white flex items-center gap-2 min-w-0">
                  <User size={18} className="text-cyan-400 shrink-0" />
                  <span className="truncate">Asignar monitor {pickerSlot + 1}</span>
                </h2>
                <button
                  type="button"
                  onClick={closePicker}
                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white"
                  aria-label="Cerrar"
                >
                  <X size={20} />
                </button>
              </div>
              <AssignUserPickerList
                slotIndex={pickerSlot}
                userSearch={userSearch}
                onUserSearchChange={setUserSearch}
                candidates={pickerCandidates}
                onSelect={(u) => assignUser(pickerSlot, u)}
              />
            </div>
          </div>
        )}

        {compact && slotMenuSlot != null && (() => {
          const mi = slotMenuSlot;
          const slotBinding = bindings[mi];
          const slotUser = resolveUserByBinding(users, slotBinding);
          const slotLive = Boolean(slotUser?.sid && slotUser.presence !== 'offline');
          const slotAudioOn = audioEnabled[mi];
          return (
            <div
              className="fixed inset-0 z-[54] flex items-end justify-center p-4 bg-black/70 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="slot-menu-title"
              onClick={() => setSlotMenuSlot(null)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden mb-[env(safe-area-inset-bottom)]"
                onClick={(e) => e.stopPropagation()}
              >
                <p id="slot-menu-title" className="px-4 py-3 border-b border-gray-800 text-sm font-bold text-white">
                  Monitor {mi + 1}
                  {slotBinding ? ` · ${bindingLabel(users, slotBinding)}` : ''}
                </p>
                <div className="p-2 flex flex-col gap-1">
                  {slotBinding && (
                    <button
                      type="button"
                      onClick={() => {
                        setSlotMenuSlot(null);
                        openFocus(mi);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-white hover:bg-gray-800"
                    >
                      <Maximize2 size={18} className="text-purple-400 shrink-0" />
                      Ver en grande
                    </button>
                  )}
                  {slotLive && (
                    <button
                      type="button"
                      onClick={() => {
                        toggleSlotAudio(mi);
                        setSlotMenuSlot(null);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-white hover:bg-gray-800"
                    >
                      {slotAudioOn ? (
                        <VolumeX size={18} className="text-emerald-400 shrink-0" />
                      ) : (
                        <Volume2 size={18} className="text-gray-400 shrink-0" />
                      )}
                      {slotAudioOn ? 'Silenciar audio' : 'Escuchar audio'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSlotMenuSlot(null);
                      openPicker(mi);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-white hover:bg-gray-800"
                  >
                    <User size={18} className="text-cyan-400 shrink-0" />
                    {slotBinding ? 'Cambiar usuario' : 'Asignar usuario'}
                  </button>
                  {slotBinding && (
                    <button
                      type="button"
                      onClick={() => {
                        clearSlot(mi);
                        setSlotMenuSlot(null);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-red-300 hover:bg-red-950/40"
                    >
                      <X size={18} className="shrink-0" />
                      Quitar de este monitor
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSlotMenuSlot(null)}
                    className="w-full mt-1 py-3 text-sm font-semibold rounded-xl border border-gray-700 text-gray-300"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        <aside
          className={`shrink-0 border-t xl:border-t-0 xl:border-l border-gray-800 bg-gray-950 flex flex-col w-full xl:w-72 min-h-0 max-xl:hidden ${
            pickerSlot != null ? 'xl:flex xl:max-h-none' : 'hidden xl:flex'
          }`}
        >
          <div className="p-3 border-b border-gray-800">
            <p className="text-xs font-bold text-white flex items-center gap-2">
              <User size={14} className="text-cyan-400" />
              {pickerSlot != null ? `Asignar monitor ${pickerSlot + 1}` : 'Asignar usuario'}
            </p>
          </div>
          {pickerSlot != null ? (
            <>
              <div className="p-2 border-b border-gray-800">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Buscar…"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-8 pr-2 py-2 text-xs text-white outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
                {pickerCandidates.map((u) => (
                  <button
                    key={u.row_key}
                    type="button"
                    onClick={() => assignUser(pickerSlot, u)}
                    className="w-full text-left rounded-lg px-2 py-2 bg-gray-900/80 hover:bg-gray-800 border border-gray-800"
                  >
                    <p className="text-xs font-semibold text-white truncate">{u.display_name || 'Usuario'}</p>
                    <p className="text-[10px] text-gray-500">{statusLabel(u)}</p>
                  </button>
                ))}
              </div>
              <div className="p-2 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setPickerSlot(null)}
                  className="w-full py-2 text-xs font-semibold rounded-lg border border-gray-700 text-gray-300"
                >
                  Cerrar
                </button>
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
