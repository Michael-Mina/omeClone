import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  ShieldBan,
  Sparkles,
  Video,
  RefreshCw,
  XCircle,
  Flag,
  Users,
  Search,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Circle,
  Square,
  MessageSquare,
} from 'lucide-react';
import { socket } from '../sockets/socket';
import {
  GENDER_OPTIONS,
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  genderLabel,
  countryLabel,
  languageLabel,
} from '../data/profileOptions';
import { apiUrl, getBackendOrigin } from '../config/apiBase';
import { startMonitorRecording } from '../utils/adminMonitorRecorder';
import { MatchChatPanel, type ChatLine } from '../components/MatchChatPanel';
import { translateForChatDisplay, resolveTranslateTargetLang } from '../utils/chatTranslate';
import { useChatTranslateMode } from '../hooks/useChatTranslateMode';
import { useMdUp } from '../hooks/useMdUp';

interface ConnectedPeer {
  sid: string;
  user_id: string | null;
  display_name: string;
}

interface DashboardUser {
  row_key: string;
  sid: string | null;
  db_user_id: number | null;
  user_id: string | null;
  display_name: string;
  role: string;
  presence: 'in_call' | 'waiting' | 'offline';
  is_anonymous: boolean;
  gender: string | null;
  birth_year: number | null;
  country: string | null;
  language: string | null;
  connected_to: ConnectedPeer | null;
  exempt_from_ban?: boolean;
  exempt_from_ai_censorship?: boolean;
  /** Sala Socket.IO del match (misma para ambos usuarios); sirve para retransmitir chat al monitor. */
  match_room_id?: string | null;
}

/** Clave estable para guardar favoritos (antes user_id||row_key fallaba con offline-* vs id). */
function getFavoriteCanonicalKey(user: DashboardUser): string {
  if (user.db_user_id != null) return String(user.db_user_id);
  const uid = user.user_id?.trim();
  if (uid) return uid;
  if (user.sid) return user.sid;
  return user.row_key;
}

function favoriteKeyMatchesUser(storedKey: string, user: DashboardUser): boolean {
  const k = String(storedKey).trim();
  if (!k) return false;
  if (k === getFavoriteCanonicalKey(user)) return true;
  const legacy = user.user_id?.trim() || user.row_key;
  if (legacy && k === legacy) return true;
  if (user.db_user_id != null && k === String(user.db_user_id)) return true;
  if (user.sid && k === user.sid) return true;
  if (user.row_key && k === user.row_key) return true;
  const offlineRow = /^offline-(\d+)$/.exec(user.row_key ?? '');
  if (offlineRow && k === offlineRow[1]) return true;
  const offlineStored = /^offline-(\d+)$/.exec(k);
  if (offlineStored && user.db_user_id != null && String(user.db_user_id) === offlineStored[1]) return true;
  return false;
}

function userMatchesAnyFavorite(user: DashboardUser, favorites: Set<string>): boolean {
  for (const key of favorites) {
    if (favoriteKeyMatchesUser(key, user)) return true;
  }
  return false;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const FAVORITES_KEY = 'admin_favorites';
const USERS_PAGE_SIZE = 20;

const loadFavorites = (): Set<string> => {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};

const saveFavorites = (favs: Set<string>) => {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
};

function approxAge(birthYear: number | null | undefined): number | null {
  if (birthYear == null || Number.isNaN(Number(birthYear))) return null;
  return new Date().getFullYear() - Number(birthYear);
}

function statusLabel(u: DashboardUser): string {
  if (u.presence === 'in_call') return 'En llamada';
  if (u.presence === 'waiting') return 'Esperando';
  return 'Desconectado';
}

function statusDotClass(u: DashboardUser): string {
  if (u.presence === 'in_call') return 'bg-green-500 animate-pulse';
  if (u.presence === 'waiting') return 'bg-yellow-500';
  return 'bg-gray-500';
}

function statusTextClass(u: DashboardUser): string {
  if (u.presence === 'in_call') return 'text-green-400';
  if (u.presence === 'waiting') return 'text-yellow-400';
  return 'text-gray-500';
}

const AdminDashboard: React.FC = () => {
  const { setAuth, userId, language } = useAppStore();
  const navigate = useNavigate();
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [spyTarget, setSpyTarget] = useState<string | null>(null);
  /** Sid del otro participante cuando el monitoreado está «en llamada» (segunda cámara). */
  const [spyPeerSid, setSpyPeerSid] = useState<string | null>(null);
  const [monitorFullscreen, setMonitorFullscreen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordElapsedSec, setRecordElapsedSec] = useState(0);
  const monitorRecorderStopRef = useRef<(() => Promise<void>) | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'favorites'>('all');

  const [filterGender, setFilterGender] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');
  const [filterPresence, setFilterPresence] = useState('');
  const [filterAnonType, setFilterAnonType] = useState('');
  const [filterAgeMin, setFilterAgeMin] = useState('');
  const [filterAgeMax, setFilterAgeMax] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [adminListError, setAdminListError] = useState<string | null>(null);
  const [userListPage, setUserListPage] = useState(1);

  const spyVideoPrimaryRef = useRef<HTMLVideoElement>(null);
  const spyVideoPeerRef = useRef<HTMLVideoElement>(null);
  /** Una RTCPeerConnection por usuario espiado (clave = sid del objetivo). */
  const spyPcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const spyPrimarySidRef = useRef<string | null>(null);
  const spyPeerSidRef = useRef<string | null>(null);
  const monitorPanelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  const [monitorChatMessages, setMonitorChatMessages] = useState<ChatLine[]>([]);
  const [monitorChatHidden, setMonitorChatHidden] = useState(false);

  const mdUp = useMdUp();
  const { mode: translateMode, setMode: setTranslateMode } = useChatTranslateMode();
  const translateModeRef = useRef(translateMode);
  translateModeRef.current = translateMode;

  const monitorChatMessagesRef = useRef<ChatLine[]>([]);
  useEffect(() => {
    monitorChatMessagesRef.current = monitorChatMessages;
  }, [monitorChatMessages]);

  const translateTargetLabel = useMemo(
    () => languageLabel(resolveTranslateTargetLang(translateMode, language)),
    [translateMode, language]
  );

  useEffect(() => {
    if (!spyTarget) return;
    let cancelled = false;
    const snapshot = monitorChatMessagesRef.current;
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
          return {
            ...m,
            text: seg.text,
            originalText: seg.originalText,
          };
        })
      );
      if (cancelled) return;
      setMonitorChatMessages((curr) => {
        if (curr.length !== ids.length) return curr;
        const same = curr.every((m, i) => m.id === ids[i]);
        return same ? next : curr;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [translateMode, language, spyTarget]);

  const diagnoseWrongBackend = async (): Promise<string> => {
    try {
      const h = await fetch(apiUrl('/api/health'));
      if (!h.ok) {
        return `En ${apiUrl('')} no responde este API OmeTV (prueba /api/health). Suele haber otro programa usando el puerto o uvicorn no está arrancado desde la carpeta backend.`;
      }
      const j = await h.json();
      if (j?.service === 'ometv-api') {
        return 'El API está activo pero falta la ruta admin (¿servidor sin reiniciar tras actualizar?). Para backend: python -m uvicorn app.main:application --reload --port 8002';
      }
    } catch {
      /* ignore */
    }
    return `No se encontró la ruta en el servidor. Arranca: desde backend/, python -m uvicorn app.main:application --reload --host 0.0.0.0 --port 8002`;
  };

  const fetchUsers = async () => {
    setLoading(true);
    const listUrl = apiUrl('/api/admin/dashboard-users');
    try {
      const { token } = useAppStore.getState();
      const response = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setAdminListError(null);
        const data = await response.json();
        const list = data?.users;
        setUsers(Array.isArray(list) ? list : []);
        if (!Array.isArray(list)) {
          console.error('dashboard-users: expected users[]', data);
          setAdminListError('Respuesta inválida del servidor (no hay lista users).');
        }
      } else {
        const text = await response.text();
        console.error('Error fetching users:', response.status, text);
        setUsers([]);
        let extra404 = '';
        if (response.status === 404) {
          extra404 = await diagnoseWrongBackend();
        }
        setAdminListError(
          response.status === 401 || response.status === 403
            ? 'Sin permiso o sesión caducada. Cierra sesión y entra como superusuario con token válido (el “Modo SA” de prueba no sirve para esta lista).'
            : response.status === 404
              ? `404 en ${listUrl}. ${extra404} · Comprueba también ${
                  getBackendOrigin() || (typeof window !== 'undefined' ? window.location.origin : '')
                }/openapi.json (debe listar GET /api/admin/dashboard-users).`
              : `No se pudo cargar la lista (${response.status}).`,
        );
      }
    } catch (err) {
      console.error('Error fetching dashboard users', err);
      setUsers([]);
      setAdminListError('Error de red al cargar usuarios.');
    }
    setLoading(false);
  };

  useEffect(() => {
    queueMicrotask(() => {
      void fetchUsers();
    });
    const interval = setInterval(() => void fetchUsers(), 5000);

    if (!socket.connected) socket.connect();

    const onConnect = () => {
      const { userId: uid, role, displayName } = useAppStore.getState();
      socket.emit('identify', {
        user_id: uid,
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

    const handleSpyOffer = async (data: { target_sid: string; offer: RTCSessionDescriptionInit }) => {
      const targetSid = data.target_sid;
      const prev = spyPcsRef.current[targetSid];
      if (prev) {
        try {
          prev.close();
        } catch {
          /* ignore */
        }
        delete spyPcsRef.current[targetSid];
      }
      const pc = new RTCPeerConnection(ICE_SERVERS);
      spyPcsRef.current[targetSid] = pc;
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('spy_ice_candidate', { to_sid: targetSid, candidate: event.candidate });
        }
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0];
        const primary = spyPrimarySidRef.current;
        const peer = spyPeerSidRef.current;
        if (targetSid === primary && spyVideoPrimaryRef.current) {
          spyVideoPrimaryRef.current.srcObject = stream;
        } else if (targetSid === peer && spyVideoPeerRef.current) {
          spyVideoPeerRef.current.srcObject = stream;
        } else if (spyVideoPrimaryRef.current && !spyVideoPrimaryRef.current.srcObject) {
          spyVideoPrimaryRef.current.srcObject = stream;
        } else if (spyVideoPeerRef.current && !spyVideoPeerRef.current.srcObject) {
          spyVideoPeerRef.current.srcObject = stream;
        }
      };
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('spy_answer', { target_sid: targetSid, answer });
    };

    const handleSpyIceCandidate = async (data: { from_sid: string; candidate: RTCIceCandidateInit }) => {
      const pc = spyPcsRef.current[data.from_sid];
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    };

    socket.on('spy_offer', handleSpyOffer);
    socket.on('spy_ice_candidate', handleSpyIceCandidate);

    return () => {
      clearInterval(interval);
      socket.off('connect', onConnect);
      socket.off('spy_offer', handleSpyOffer);
      socket.off('spy_ice_candidate', handleSpyIceCandidate);
      Object.values(spyPcsRef.current).forEach((pc) => {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
      });
      spyPcsRef.current = {};
    };
  }, []);

  useEffect(() => {
    setMonitorChatMessages([]);
  }, [spyTarget]);

  useEffect(() => {
    const syncWatch = () => {
      if (!socket.connected) return;
      if (!spyTarget) {
        socket.emit('admin_spy_watch', { targets: [], room_ids: [] });
        return;
      }
      const targets = [spyTarget, spyPeerSid].filter((x): x is string => Boolean(x));
      const primaryRow = users.find((u) => u.sid === spyTarget);
      const peerRow = spyPeerSid ? users.find((u) => u.sid === spyPeerSid) : undefined;
      const roomId = primaryRow?.match_room_id ?? peerRow?.match_room_id ?? null;
      const room_ids = roomId ? [roomId] : [];
      socket.emit('admin_spy_watch', { targets, room_ids });
    };
    syncWatch();
    socket.on('connect', syncWatch);
    return () => {
      socket.off('connect', syncWatch);
    };
  }, [spyTarget, spyPeerSid, users]);

  useEffect(() => {
    return () => {
      if (socket.connected) socket.emit('admin_spy_watch', { targets: [], room_ids: [] });
    };
  }, []);

  useEffect(() => {
    const onRelay = (payload: {
      text: string;
      sender_sid: string;
      sender_label?: string;
      sender_language?: string | null;
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
        if (!seg.originalText) return;
        setMonitorChatMessages((prev) =>
          prev.map((m) =>
            m.id === lineId ? { ...m, text: seg.text, originalText: seg.originalText } : m
          )
        );
      })();
    };
    socket.on('admin_chat_relay', onRelay);
    return () => {
      socket.off('admin_chat_relay', onRelay);
    };
  }, []);

  useEffect(() => {
    if (!spyTarget) setMonitorChatHidden(false);
  }, [spyTarget]);

  useEffect(() => {
    const onFs = () => {
      const active = !!document.fullscreenElement;
      setMonitorFullscreen(active);
      if (!active) {
        try {
          screen.orientation?.unlock?.();
        } catch {
          /* sin API o ya desbloqueado */
        }
      }
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      try {
        screen.orientation?.unlock?.();
      } catch {
        /* noop */
      }
    };
  }, []);

  useEffect(() => {
    setUserListPage(1);
  }, [
    searchQuery,
    filterMode,
    filterGender,
    filterCountry,
    filterLanguage,
    filterPresence,
    filterAnonType,
    filterAgeMin,
    filterAgeMax,
  ]);

  useEffect(() => {
    if (!isRecording) {
      setRecordElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    const id = window.setInterval(() => setRecordElapsedSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const handleLogout = () => {
    setAuth('', '', 'user', null, false);
    navigate('/login');
  };

  /** 404 de Starlette/FastAPI cuando no coincide ninguna ruta (p. ej. API antigua o puerto distinto). */
  const isUnmatchedRoute404 = (detail: unknown): boolean => {
    if (detail == null) return true;
    if (typeof detail !== 'string') return true;
    const t = detail.trim().toLowerCase();
    return t === '' || t === 'not found';
  };

  const patchExemptions = async (
    dbId: number,
    body: { exempt_from_ban?: boolean; exempt_from_ai_censorship?: boolean }
  ) => {
    try {
      const { token } = useAppStore.getState();
      const res = await fetch(apiUrl(`/api/admin/users/${dbId}/exemptions`), {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) {
        if (res.status === 404) {
          if (!isUnmatchedRoute404(data.detail)) {
            alert(
              typeof data.detail === 'string'
                ? data.detail
                : 'No existe ese usuario en la base de datos (actualiza la lista).'
            );
            return;
          }
          alert(
            'Ruta no encontrada (404). Comprueba que el backend tenga el último código y que VITE_BACKEND_URL ' +
              'en frontend/.env coincida con el puerto de uvicorn (proxy de Vite usa la misma variable; ' +
              'p. ej. http://127.0.0.1:8002). Luego reinicia el API y `npm run dev`.'
          );
          return;
        }
        alert(typeof data.detail === 'string' ? data.detail : 'No se pudo actualizar las exenciones');
        return;
      }
      fetchUsers();
    } catch (err) {
      console.error('patchExemptions', err);
      alert('Error de conexión al actualizar exenciones');
    }
  };

  const handleBan = async (dashboardUserId: string) => {
    try {
      const { token } = useAppStore.getState();
      const res = await fetch(apiUrl(`/api/admin/users/${dashboardUserId}/ban`), {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof data.detail === 'string' ? data.detail : 'No se pudo banear / desconectar');
        return;
      }
      fetchUsers();
    } catch (err) {
      console.error('Error banning user', err);
    }
  };

  const stopMonitorRecording = useCallback(async () => {
    const fn = monitorRecorderStopRef.current;
    monitorRecorderStopRef.current = null;
    if (fn) await fn();
    setIsRecording(false);
  }, []);

  const startMonitorRecordingClick = useCallback(() => {
    if (!spyTarget || isRecording) return;
    try {
      const { stop } = startMonitorRecording({
        getVideoPrimary: () => spyVideoPrimaryRef.current,
        getVideoPeer: () => spyVideoPeerRef.current,
        getHasPeer: () => !!spyPeerSidRef.current,
      });
      monitorRecorderStopRef.current = stop;
      setIsRecording(true);
    } catch (e) {
      console.error('Grabación monitor:', e);
    }
  }, [spyTarget, isRecording]);

  const cleanupSpyPeerConnections = () => {
    Object.values(spyPcsRef.current).forEach((pc) => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    });
    spyPcsRef.current = {};
    if (spyVideoPrimaryRef.current) spyVideoPrimaryRef.current.srcObject = null;
    if (spyVideoPeerRef.current) spyVideoPeerRef.current.srcObject = null;
  };

  const stopSpying = async () => {
    await stopMonitorRecording();
    cleanupSpyPeerConnections();
    spyPrimarySidRef.current = null;
    spyPeerSidRef.current = null;
    setSpyTarget(null);
    setSpyPeerSid(null);
    if (monitorPanelRef.current && document.fullscreenElement === monitorPanelRef.current) {
      void document.exitFullscreen().catch(() => {});
    }
  };

  const startSpying = async (sid: string | null) => {
    if (!sid) return;
    await stopMonitorRecording();
    cleanupSpyPeerConnections();
    const row = users.find((u) => u.sid === sid);
    const peerSid =
      row?.presence === 'in_call' && row?.connected_to?.sid ? row.connected_to.sid : null;

    spyPrimarySidRef.current = sid;
    spyPeerSidRef.current = peerSid;
    setSpyTarget(sid);
    setSpyPeerSid(peerSid);

    socket.emit('admin_spy_request', { target_sid: sid });
    if (peerSid) {
      socket.emit('admin_spy_request', { target_sid: peerSid });
    }
  };

  const toggleMonitorFullscreen = async () => {
    const el = monitorPanelRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        const mobileForFs =
          typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches;
        if (mobileForFs) {
          const o = screen.orientation;
          if (o && typeof o.lock === 'function') {
            try {
              await o.lock('landscape-primary');
            } catch {
              try {
                await o.lock('landscape');
              } catch {
                /* Safari iOS u otros: sin lock; el panel sigue en pantalla completa */
              }
            }
          }
        }
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.warn('Pantalla completa no disponible', e);
    }
  };

  const jumpToUser = (peerSid: string | null | undefined) => {
    if (!peerSid) return;
    const peer = users.find((u) => u.sid === peerSid);
    setHighlightedKey(peer?.row_key ?? null);
    if (filterMode === 'favorites' && peer && !userMatchesAnyFavorite(peer, favorites)) setFilterMode('all');
    setTimeout(() => {
      const key = peer?.row_key ?? peerSid;
      const row = rowRefs.current[key];
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    setTimeout(() => setHighlightedKey(null), 2000);
  };

  const toggleFavorite = (user: DashboardUser) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      const matchingKeys = [...next].filter((key) => favoriteKeyMatchesUser(key, user));
      if (matchingKeys.length > 0) {
        matchingKeys.forEach((key) => next.delete(key));
      } else {
        next.add(getFavoriteCanonicalKey(user));
      }
      saveFavorites(next);
      return next;
    });
  };

  const clearAdvancedFilters = () => {
    setFilterGender('');
    setFilterCountry('');
    setFilterLanguage('');
    setFilterPresence('');
    setFilterAnonType('');
    setFilterAgeMin('');
    setFilterAgeMax('');
    setSearchQuery('');
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterGender) n++;
    if (filterCountry) n++;
    if (filterLanguage) n++;
    if (filterPresence) n++;
    if (filterAnonType) n++;
    if (filterAgeMin.trim()) n++;
    if (filterAgeMax.trim()) n++;
    return n;
  }, [
    filterGender,
    filterCountry,
    filterLanguage,
    filterPresence,
    filterAnonType,
    filterAgeMin,
    filterAgeMax,
  ]);

  const selectCls =
    'bg-gray-900 border border-gray-700 text-[11px] rounded-md px-2 py-1 text-gray-200 min-w-0 w-full sm:w-auto sm:max-w-[8.75rem]';

  const favoritesListed = users.filter((u) => userMatchesAnyFavorite(u, favorites));

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.trim().toLowerCase();
    const name = String(u.display_name ?? '').toLowerCase();
    const idStr = String(u.user_id ?? '').toLowerCase();
    const matchesSearch =
      !q ||
      name.includes(q) ||
      idStr.includes(q) ||
      (u.country && countryLabel(u.country).toLowerCase().includes(q)) ||
      (u.language && languageLabel(u.language).toLowerCase().includes(q));

    let matchesFilter = true;
    if (filterMode === 'favorites') matchesFilter = userMatchesAnyFavorite(u, favorites);

    if (filterGender && u.gender !== filterGender) return false;
    if (filterCountry && u.country !== filterCountry) return false;
    if (filterLanguage && u.language !== filterLanguage) return false;

    if (filterPresence) {
      const online = u.presence !== 'offline';
      if (filterPresence === 'offline' && u.presence !== 'offline') return false;
      if (filterPresence === 'online' && !online) return false;
      if (filterPresence === 'in_call' && u.presence !== 'in_call') return false;
      if (filterPresence === 'waiting' && u.presence !== 'waiting') return false;
    }

    if (filterAnonType === 'anon' && !u.is_anonymous) return false;
    if (filterAnonType === 'registered' && u.is_anonymous) return false;

    const age = approxAge(u.birth_year);
    if (filterAgeMin) {
      const min = Number(filterAgeMin);
      if (!Number.isNaN(min)) {
        if (age === null || age < min) return false;
      }
    }
    if (filterAgeMax) {
      const max = Number(filterAgeMax);
      if (!Number.isNaN(max)) {
        if (age === null || age > max) return false;
      }
    }

    return matchesSearch && matchesFilter;
  });

  const sortedUsers = [...filteredUsers];

  const totalFiltered = sortedUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / USERS_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, userListPage), totalPages);
  const pageRangeStart = totalFiltered === 0 ? 0 : (safePage - 1) * USERS_PAGE_SIZE + 1;
  const pageRangeEnd = Math.min(safePage * USERS_PAGE_SIZE, totalFiltered);
  const paginatedUsers = sortedUsers.slice(
    (safePage - 1) * USERS_PAGE_SIZE,
    (safePage - 1) * USERS_PAGE_SIZE + USERS_PAGE_SIZE,
  );

  const UserRow: React.FC<{ user: DashboardUser }> = ({ user }) => {
    const isFav = userMatchesAnyFavorite(user, favorites);
    const alive = !!user.sid;
    const myBanId = user.user_id ?? '';
    const isSelfSuperadminViewer = roleMatchesAdminSession(user.user_id);
    const banExempt = Boolean(user.exempt_from_ban);
    const aiExempt = Boolean(user.exempt_from_ai_censorship);
    const dbId = user.db_user_id;

    return (
      <tr
        ref={(el) => {
          rowRefs.current[user.row_key] = el;
        }}
        className={`transition-colors duration-300 ${
          highlightedKey === user.row_key
            ? 'bg-blue-900/40 ring-1 ring-inset ring-blue-500'
            : user.sid && (user.sid === spyTarget || user.sid === spyPeerSid)
            ? 'bg-purple-900/20'
            : isFav
            ? 'bg-amber-950/20'
            : 'hover:bg-gray-800/50'
        }`}
      >
        <td className="pl-4 pr-2 py-3 w-8">
          <button
            onClick={() => toggleFavorite(user)}
            title={isFav ? 'Quitar marcador' : 'Marcar usuario'}
            type="button"
            className={`transition-all duration-200 hover:scale-125 ${
              isFav ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]' : 'text-gray-600 hover:text-amber-400'
            }`}
          >
            <Flag size={16} fill={isFav ? 'currentColor' : 'none'} />
          </button>
        </td>

        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
                isFav ? 'bg-gradient-to-br from-amber-500 to-orange-500' : 'bg-gradient-to-br from-purple-500 to-pink-500'
              }`}
            >
              {(user.display_name || 'A')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <span className="font-medium text-gray-200 truncate max-w-[120px] block" title={user.display_name}>
                {user.display_name || 'Usuario'}
              </span>
              <span className="text-[10px] text-gray-600">
                {user.is_anonymous ? 'Anónimo' : 'Registrado'}
              </span>
              {isFav && (
                <span className="ml-1 text-[9px] text-amber-500 font-bold uppercase tracking-wider">marcado</span>
              )}
            </div>
          </div>
        </td>

        <td className="px-3 py-3 font-mono text-xs text-gray-500">{user.user_id ?? '—'}</td>

        <td className="px-3 py-3">
          <span
            className={`px-2 py-1 rounded text-xs font-bold whitespace-nowrap ${
              user.role === 'superadmin' ? 'bg-pink-900/50 text-pink-400' : 'bg-gray-800 text-gray-400'
            }`}
          >
            {user.role}
          </span>
        </td>

        <td className="px-3 py-3">
          <span className={`flex items-center gap-1.5 ${statusTextClass(user)} text-xs whitespace-nowrap`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass(user)}`} />
            {statusLabel(user)}
          </span>
        </td>

        <td className="px-3 py-3 text-xs text-gray-300 max-w-[100px]" title={genderLabel(user.gender)}>
          {genderLabel(user.gender)}
        </td>

        <td className="px-3 py-3 font-mono text-xs text-gray-400">
          {approxAge(user.birth_year) != null ? `${approxAge(user.birth_year)}` : '—'}
        </td>

        <td className="px-3 py-3 text-xs text-gray-400 truncate max-w-[96px]" title={countryLabel(user.country)}>
          {countryLabel(user.country)}
        </td>

        <td className="px-3 py-3 text-xs text-gray-400 truncate max-w-[80px]" title={languageLabel(user.language)}>
          {languageLabel(user.language)}
        </td>

        <td className="px-3 py-3">
          {user.connected_to ? (
            <button
              type="button"
              onClick={() => jumpToUser(user.connected_to!.sid)}
              className="flex items-center gap-2 group text-left"
              title={`Ir a ${user.connected_to.display_name}`}
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {(user.connected_to.display_name || 'A')[0].toUpperCase()}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-blue-400 group-hover:text-blue-300 group-hover:underline transition-colors font-medium text-xs truncate max-w-[100px]">
                  {user.connected_to.display_name || 'Anónimo'}
                </span>
                <span className="text-gray-600 text-[10px] font-mono">{user.connected_to.user_id || '—'}</span>
              </div>
            </button>
          ) : (
            <span className="text-gray-600 text-sm">—</span>
          )}
        </td>

        <td className="px-3 py-3 text-right align-middle">
          {/* Una sola fila; si falta ancho, scroll horizontal en la celda */}
          <div className="ml-auto flex max-w-full flex-nowrap justify-end gap-2 overflow-x-auto overscroll-x-contain [&_button]:size-10 [&_button]:inline-flex [&_button]:items-center [&_button]:justify-center [&_button]:shrink-0">
            {dbId != null && (
              <>
                <button
                  type="button"
                  onClick={() => patchExemptions(dbId, { exempt_from_ban: !banExempt })}
                  title={
                    banExempt
                      ? 'Exento de baneos — clic para quitar'
                      : 'Marcar exento de baneos (no se puede banear)'
                  }
                  className={`rounded-lg transition-all ${
                    banExempt
                      ? 'bg-emerald-900/45 text-emerald-300 ring-1 ring-emerald-600/40'
                      : 'bg-gray-800 text-gray-500 hover:text-emerald-400 hover:bg-gray-700'
                  }`}
                >
                  <ShieldCheck size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => patchExemptions(dbId, { exempt_from_ai_censorship: !aiExempt })}
                  title={
                    aiExempt
                      ? 'Exento de censura IA (modelo local) — clic para quitar'
                      : 'Eximir de censura IA en su cliente (debe volver a iniciar sesión para aplicar)'
                  }
                  className={`rounded-lg transition-all ${
                    aiExempt
                      ? 'bg-violet-900/45 text-violet-300 ring-1 ring-violet-600/40'
                      : 'bg-gray-800 text-gray-500 hover:text-violet-300 hover:bg-gray-700'
                  }`}
                >
                  <Sparkles size={18} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => startSpying(user.sid)}
              disabled={!alive}
              title={alive ? 'Ver cámara (espiar)' : 'Usuario desconectado'}
              className={`rounded-lg transition-all ${
                user.sid && (user.sid === spyTarget || user.sid === spyPeerSid)
                  ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(147,51,234,0.5)]'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-35 disabled:pointer-events-none'
              }`}
            >
              <Video size={18} />
            </button>
            <button
              type="button"
              onClick={() => handleBan(myBanId)}
              disabled={
                user.role === 'superadmin' || isSelfSuperadminViewer || !myBanId || banExempt
              }
              className="bg-gray-800 text-red-400 rounded-lg hover:bg-red-900/50 hover:text-red-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              title={banExempt ? 'Usuario exento de baneos' : 'Ban / desconectar'}
            >
              <ShieldBan size={18} />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const UserMobileCard: React.FC<{ user: DashboardUser }> = ({ user }) => {
    const isFav = userMatchesAnyFavorite(user, favorites);
    const alive = !!user.sid;
    const myBanId = user.user_id ?? '';
    const isSelfSuperadminViewer = roleMatchesAdminSession(user.user_id);
    const banExempt = Boolean(user.exempt_from_ban);
    const aiExempt = Boolean(user.exempt_from_ai_censorship);
    const dbId = user.db_user_id;
    const age = approxAge(user.birth_year);

    return (
      <div
        ref={(el) => {
          rowRefs.current[user.row_key] = el;
        }}
        className={`rounded-lg border transition-colors duration-300 ${
          highlightedKey === user.row_key
            ? 'border-blue-500 bg-blue-900/40 ring-1 ring-blue-500/50'
            : user.sid && (user.sid === spyTarget || user.sid === spyPeerSid)
              ? 'border-purple-800/60 bg-purple-900/20'
              : isFav
                ? 'border-amber-900/40 bg-amber-950/15'
                : 'border-gray-800 bg-gray-900/85'
        }`}
      >
        <div className="flex items-center gap-2 px-2.5 py-2">
          <button
            onClick={() => toggleFavorite(user)}
            title={isFav ? 'Quitar marcador' : 'Marcar usuario'}
            type="button"
            className={`shrink-0 flex size-7 items-center justify-center rounded-md transition-colors ${
              isFav ? 'text-amber-400' : 'text-gray-600 hover:text-amber-400 hover:bg-gray-800/80'
            }`}
          >
            <Flag size={13} strokeWidth={isFav ? 2.25 : 2} fill={isFav ? 'currentColor' : 'none'} />
          </button>
          <div
            className={`size-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 shadow-inner ${
              isFav ? 'bg-gradient-to-br from-amber-500 to-orange-500' : 'bg-gradient-to-br from-purple-500 to-pink-500'
            }`}
          >
            {(user.display_name || 'A')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-gray-100 text-[13px] leading-tight truncate" title={user.display_name}>
                {user.display_name || 'Usuario'}
              </p>
              <span
                className={`shrink-0 px-1.5 py-0 rounded text-[8px] font-bold uppercase tracking-wide ${
                  user.role === 'superadmin' ? 'bg-pink-900/50 text-pink-400' : 'bg-gray-800 text-gray-500'
                }`}
              >
                {user.role}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-gray-500">
              <span className={`inline-flex items-center gap-1 ${statusTextClass(user)}`}>
                <span className={`size-1.5 rounded-full shrink-0 ${statusDotClass(user)}`} />
                {statusLabel(user)}
              </span>
              <span className="text-gray-700">·</span>
              <span>{user.is_anonymous ? 'Anón.' : 'Reg.'}</span>
              {isFav && <span className="text-amber-500 font-bold">★</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-x-2 gap-y-1 px-2.5 pb-1.5 text-[9px] border-t border-gray-800/70 pt-1.5">
          <div className="min-w-0 col-span-2">
            <span className="text-gray-600 uppercase tracking-wide text-[8px]">ID</span>
            <p className="font-mono text-gray-400 truncate tabular-nums leading-tight" title={user.user_id ?? ''}>
              {user.user_id ?? '—'}
            </p>
          </div>
          <div className="min-w-0">
            <span className="text-gray-600 uppercase tracking-wide text-[8px]">Gen.</span>
            <p className="text-gray-300 truncate leading-tight" title={genderLabel(user.gender)}>
              {genderLabel(user.gender)}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <span className="text-gray-600 uppercase tracking-wide text-[8px]">Edad</span>
            <p className="font-mono text-gray-400 leading-tight tabular-nums">{age != null ? `${age}` : '—'}</p>
          </div>
          <div className="min-w-0 col-span-2">
            <span className="text-gray-600 uppercase tracking-wide text-[8px]">País</span>
            <p className="text-gray-400 truncate leading-tight" title={countryLabel(user.country)}>
              {countryLabel(user.country)}
            </p>
          </div>
          <div className="min-w-0 col-span-2">
            <span className="text-gray-600 uppercase tracking-wide text-[8px]">Idioma</span>
            <p className="text-gray-400 truncate leading-tight" title={languageLabel(user.language)}>
              {languageLabel(user.language)}
            </p>
          </div>
        </div>

        {user.connected_to ? (
          <div className="px-2.5 pb-1 border-t border-gray-800/50 bg-gray-950/30">
            <span className="text-[8px] text-gray-600 uppercase tracking-wide">Con</span>
            <button
              type="button"
              onClick={() => jumpToUser(user.connected_to!.sid)}
              className="mt-0.5 flex items-center gap-1.5 w-full min-w-0 text-left group rounded-md py-0.5 pr-1 -mr-1"
              title={`Ir a ${user.connected_to.display_name}`}
            >
              <span className="size-6 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                {(user.connected_to.display_name || 'A')[0].toUpperCase()}
              </span>
              <span className="min-w-0 text-[11px] text-blue-400 group-hover:underline truncate">
                {user.connected_to.display_name || 'Anónimo'}
              </span>
              <span className="text-[9px] text-gray-600 font-mono shrink-0 tabular-nums">
                {user.connected_to.user_id || ''}
              </span>
            </button>
          </div>
        ) : null}

        <div className="border-t border-gray-800 px-2 py-1.5 flex flex-wrap justify-end gap-1 bg-black/25">
          {dbId != null && (
            <>
              <button
                type="button"
                onClick={() => patchExemptions(dbId, { exempt_from_ban: !banExempt })}
                title={
                  banExempt
                    ? 'Exento de baneos — clic para quitar'
                    : 'Marcar exento de baneos (no se puede banear)'
                }
                className={`rounded-md transition-all size-8 inline-flex items-center justify-center ${
                  banExempt
                    ? 'bg-emerald-900/45 text-emerald-300 ring-1 ring-emerald-600/40'
                    : 'bg-gray-800/90 text-gray-500 hover:text-emerald-400 hover:bg-gray-700'
                }`}
              >
                <ShieldCheck size={15} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => patchExemptions(dbId, { exempt_from_ai_censorship: !aiExempt })}
                title={
                  aiExempt
                    ? 'Exento de censura IA (modelo local) — clic para quitar'
                    : 'Eximir de censura IA en su cliente (debe volver a iniciar sesión para aplicar)'
                }
                className={`rounded-md transition-all size-8 inline-flex items-center justify-center ${
                  aiExempt
                    ? 'bg-violet-900/45 text-violet-300 ring-1 ring-violet-600/40'
                    : 'bg-gray-800/90 text-gray-500 hover:text-violet-300 hover:bg-gray-700'
                }`}
              >
                <Sparkles size={15} strokeWidth={2} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => startSpying(user.sid)}
            disabled={!alive}
            title={alive ? 'Ver cámara (espiar)' : 'Usuario desconectado'}
            className={`rounded-md transition-all size-8 inline-flex items-center justify-center ${
              user.sid && (user.sid === spyTarget || user.sid === spyPeerSid)
                ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.45)]'
                : 'bg-gray-800/90 text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-35 disabled:pointer-events-none'
            }`}
          >
            <Video size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => handleBan(myBanId)}
            disabled={user.role === 'superadmin' || isSelfSuperadminViewer || !myBanId || banExempt}
            className="bg-gray-800/90 text-red-400 rounded-md hover:bg-red-900/45 hover:text-red-300 transition-all size-8 inline-flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
            title={banExempt ? 'Usuario exento de baneos' : 'Ban / desconectar'}
          >
            <ShieldBan size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  };

  function roleMatchesAdminSession(peerUserId: string | null) {
    if (!peerUserId || !userId) return false;
    return peerUserId === String(userId);
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-gray-950 text-gray-200 font-sans">
      <header className="bg-gray-900 shadow-xl py-2 md:py-3 px-3 md:px-5 flex flex-col gap-2 border-b border-gray-800 sticky top-0 z-10">
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 shrink">
            <ShieldCheck size={24} className="text-pink-500 shrink-0 md:w-7 md:h-7" />
            <h1 className="text-lg md:text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 truncate">
              OmeClone Control Center
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              type="button"
              onClick={handleLogout}
              className="bg-gray-800 hover:bg-gray-700 text-white text-xs md:text-sm font-semibold py-1.5 px-4 rounded-full border border-gray-700 shrink-0"
            >
              Cerrar sesión
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative group w-full sm:flex-1 sm:min-w-[min(100%,220px)] sm:max-w-xl">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-400" />
            <input
              type="text"
              placeholder="Buscar…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              title="Nombre, ID, país o idioma"
              className="w-full bg-gray-800 border border-gray-700 text-sm rounded-full pl-8 pr-3 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setFiltersExpanded((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors shrink-0 ${
              filtersExpanded || activeFilterCount > 0
                ? 'border-blue-500/50 bg-blue-900/25 text-blue-200'
                : 'border-gray-700 bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700'
            }`}
          >
            <Filter size={14} />
            Filtros
            {activeFilterCount > 0 && (
              <span className="min-w-[1.15rem] rounded-full bg-blue-600 px-1 text-center text-[10px] leading-tight text-white">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown
              size={14}
              className={`transition-transform duration-150 ${filtersExpanded ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAdvancedFilters}
              className="text-[11px] font-semibold text-gray-400 hover:text-white px-2 py-1 shrink-0"
            >
              Limpiar filtros
            </button>
          )}

          <div className="flex items-center bg-gray-800 rounded-full border border-gray-700 p-0.5 shrink-0 sm:ms-auto lg:ms-0 w-fit max-w-full">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                filterMode === 'all' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('favorites')}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                filterMode === 'favorites'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-sm'
                  : 'text-gray-400 hover:text-amber-400'
              }`}
              title="Solo marcados"
            >
              <Flag size={12} fill={filterMode === 'favorites' ? 'currentColor' : 'none'} />
              Marcados
              {favoritesListed.length > 0 && (
                <span
                  className={`text-[10px] px-1 py-0.5 rounded-full font-bold ${
                    filterMode === 'favorites' ? 'bg-amber-500 text-black' : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {filterMode === 'favorites' ? sortedUsers.length : favoritesListed.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {filtersExpanded && (
          <div className="rounded-lg border border-gray-800 bg-gray-800/25 px-2 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-wrap gap-2 items-end">
              <select
                value={filterGender}
                onChange={(e) => setFilterGender(e.target.value)}
                className={selectCls}
              >
                <option value="">Género</option>
                {GENDER_OPTIONS.filter((g) => g.value).map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              <select
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value)}
                className={selectCls}
              >
                <option value="">País</option>
                {COUNTRY_OPTIONS.filter((c) => c.value).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                value={filterLanguage}
                onChange={(e) => setFilterLanguage(e.target.value)}
                className={selectCls}
              >
                <option value="">Idioma</option>
                {LANGUAGE_OPTIONS.filter((l) => l.value).map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <select
                value={filterPresence}
                onChange={(e) => setFilterPresence(e.target.value)}
                className={`${selectCls} sm:max-w-[10rem]`}
              >
                <option value="">Estado</option>
                <option value="online">Conectados (cualquier)</option>
                <option value="in_call">En llamada</option>
                <option value="waiting">Esperando</option>
                <option value="offline">Fuera de línea</option>
              </select>
              <select
                value={filterAnonType}
                onChange={(e) => setFilterAnonType(e.target.value)}
                className={selectCls}
              >
                <option value="">Cuenta</option>
                <option value="anon">Solo anónimos</option>
                <option value="registered">Solo registrados</option>
              </select>
              <input
                type="number"
                min={13}
                max={120}
                placeholder="Edad min"
                aria-label="Edad mínima"
                value={filterAgeMin}
                onChange={(e) => setFilterAgeMin(e.target.value)}
                className="min-w-0 w-full sm:w-[76px] bg-gray-900 border border-gray-700 text-[11px] rounded-md px-2 py-1 text-gray-200 shrink-0"
              />
              <input
                type="number"
                min={13}
                max={120}
                placeholder="Edad máx"
                aria-label="Edad máxima"
                value={filterAgeMax}
                onChange={(e) => setFilterAgeMax(e.target.value)}
                className="min-w-0 w-full sm:w-[76px] bg-gray-900 border border-gray-700 text-[11px] rounded-md px-2 py-1 text-gray-200 shrink-0"
              />
              <button
                type="button"
                onClick={clearAdvancedFilters}
                className="text-[11px] font-semibold text-gray-400 hover:text-white px-2 py-1 shrink-0"
              >
                Limpiar
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 min-h-0 p-3 sm:p-4 md:p-8 flex gap-4 md:gap-8 max-w-[1920px] mx-auto w-full flex-col lg:flex-row">
        <div className="flex-1 min-w-0 min-h-0 bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden flex flex-col">
          <div className="p-3 sm:p-4 md:p-5 border-b border-gray-800 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center bg-gray-800/50 shrink-0">
            <h2 className="text-base md:text-xl font-bold flex flex-wrap items-center gap-2 min-w-0">
              <Users size={18} className="text-blue-400" />
              {filterMode === 'favorites' ? 'Marcadores' : 'Usuarios (en vivo + registrados offline)'}
              <span className="text-white text-xs px-2 py-0.5 rounded-full bg-blue-600">{totalFiltered}</span>
            </h2>
            <button type="button" onClick={fetchUsers} title="Refrescar" className="text-gray-400 hover:text-white transition-colors">
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {adminListError && (
            <div className="px-4 py-2 text-xs text-amber-200 bg-amber-950/40 border-b border-amber-900/50 shrink-0">
              {adminListError}
            </div>
          )}
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="md:hidden flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2 space-y-1.5 [-webkit-overflow-scrolling:touch]">
              {paginatedUsers.map((user) => (
                <UserMobileCard key={user.row_key} user={user} />
              ))}
              {sortedUsers.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 text-gray-500 py-12 px-4 text-center">
                  {filterMode === 'favorites' ? (
                    <>
                      <Flag size={36} className="opacity-30 text-amber-500" />
                      <p className="italic text-sm">No hay marcados que cumplan los filtros.</p>
                      <button type="button" onClick={() => setFilterMode('all')} className="text-xs text-blue-400 hover:underline">
                        Ver todos
                      </button>
                    </>
                  ) : (
                    <>
                      <Users size={36} className="opacity-30" />
                      <p className="italic text-sm">
                        {users.length === 0 && !loading
                          ? adminListError
                            ? 'No se cargó la lista. Revisa el aviso de arriba o pulsa refrescar.'
                            : 'No hay usuarios en la lista (comprueba el backend o la conexión).'
                          : 'No hay usuarios según estos criterios.'}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="hidden md:block overflow-x-auto overflow-y-auto flex-1 min-h-0">
              <table className="w-full text-left text-sm text-gray-300 min-w-[880px] lg:min-w-[1040px]">
                <thead className="text-[10px] md:text-xs text-gray-400 uppercase bg-gray-900/80 border-b border-gray-800">
                  <tr>
                    <th className="pl-4 pr-1 py-3 w-8">
                      <Flag size={12} className="text-amber-500" />
                    </th>
                    <th className="px-3 py-3 font-semibold whitespace-nowrap">Usuario</th>
                    <th className="px-3 py-3 font-semibold">ID</th>
                    <th className="px-3 py-3 font-semibold">Rol</th>
                    <th className="px-3 py-3 font-semibold">Estado</th>
                    <th className="px-3 py-3 font-semibold">Género</th>
                    <th className="px-3 py-3 font-semibold">Edad</th>
                    <th className="px-3 py-3 font-semibold">País</th>
                    <th className="px-3 py-3 font-semibold">Idioma</th>
                    <th className="px-3 py-3 font-semibold">Conectado con</th>
                    <th className="px-3 py-3 font-semibold text-right min-w-[12.5rem] whitespace-nowrap">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {paginatedUsers.map((user) => (
                    <UserRow key={user.row_key} user={user} />
                  ))}
                  {sortedUsers.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-3 text-gray-500">
                          {filterMode === 'favorites' ? (
                            <>
                              <Flag size={36} className="opacity-30 text-amber-500" />
                              <p className="italic">No hay marcados que cumplan los filtros.</p>
                              <button type="button" onClick={() => setFilterMode('all')} className="text-xs text-blue-400 hover:underline">
                                Ver todos
                              </button>
                            </>
                          ) : (
                            <>
                              <Users size={36} className="opacity-30" />
                              <p className="italic">
                                {users.length === 0 && !loading
                                  ? adminListError
                                    ? 'No se cargó la lista. Revisa el aviso de arriba o pulsa refrescar.'
                                    : 'No hay usuarios en la lista (comprueba el backend o la conexión).'
                                  : 'No hay usuarios según estos criterios.'}
                              </p>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t border-gray-800 px-3 sm:px-4 py-3 bg-gray-900/95 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3 shrink-0">
            <p className="text-[11px] sm:text-xs text-gray-500 text-center sm:text-left">
              {totalFiltered === 0
                ? 'Sin resultados'
                : `Mostrando ${pageRangeStart}–${pageRangeEnd} de ${totalFiltered}`}
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={safePage <= 1}
                aria-label="Página anterior"
                onClick={() =>
                  setUserListPage((p) => {
                    const cur = Math.min(Math.max(1, p), totalPages);
                    return Math.max(1, cur - 1);
                  })
                }
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-35 disabled:pointer-events-none border border-gray-700"
              >
                <ChevronLeft size={16} className="shrink-0" />
                <span className="hidden sm:inline">Anterior</span>
              </button>
              <span className="text-[11px] sm:text-xs text-gray-400 tabular-nums px-1">
                Página {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                aria-label="Página siguiente"
                onClick={() =>
                  setUserListPage((p) => {
                    const cur = Math.min(Math.max(1, p), totalPages);
                    return Math.min(totalPages, cur + 1);
                  })
                }
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-35 disabled:pointer-events-none border border-gray-700"
              >
                <span className="hidden sm:inline">Siguiente</span>
                <ChevronRight size={16} className="shrink-0" />
              </button>
            </div>
          </div>
        </div>

        <div
          ref={monitorPanelRef}
          className={`w-full lg:w-[min(92vw,560px)] shrink-0 bg-gray-900 rounded-2xl border border-gray-800 flex flex-col overflow-hidden lg:max-h-none lg:min-h-0 fullscreen:fixed fullscreen:inset-0 fullscreen:z-[200] fullscreen:max-h-none fullscreen:min-h-0 fullscreen:w-screen fullscreen:h-[100dvh] fullscreen:rounded-none fullscreen:border-0 ${
            spyTarget
              ? 'max-lg:max-h-[min(48vh,min(460px,100dvh))] fullscreen:max-lg:max-h-none'
              : 'max-lg:max-h-[12rem] max-lg:min-h-[10.5rem] fullscreen:max-lg:max-h-none fullscreen:max-lg:min-h-0'
          }`}
        >
          <div className="p-3 md:p-4 border-b border-gray-800 bg-gray-800/50 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center shrink-0">
            <h3 className="font-bold flex items-center gap-2 text-purple-400 text-sm md:text-base min-w-0">
              <Video size={18} className="shrink-0" />{' '}
              <span className="truncate">Monitor activo</span>
              {spyPeerSid && spyTarget && (
                <span className="text-[10px] font-normal text-gray-500 hidden sm:inline shrink-0">· dos cámaras</span>
              )}
            </h3>
            <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
              {spyTarget && (
                <>
                  {!isRecording ? (
                    <button
                      type="button"
                      onClick={startMonitorRecordingClick}
                      title="Grabar monitor (descarga MP4 o WebM según el navegador)"
                      className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors"
                    >
                      <Circle size={20} className="text-red-500 fill-red-500/90" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void stopMonitorRecording()}
                      title="Detener grabación y descargar vídeo"
                      className="flex items-center gap-2 p-2 rounded-lg text-white bg-red-700 hover:bg-red-600 transition-colors"
                    >
                      <Square size={18} className="fill-current" />
                      <span className="text-xs font-mono tabular-nums">
                        {String(Math.floor(recordElapsedSec / 60)).padStart(2, '0')}:
                        {String(recordElapsedSec % 60).padStart(2, '0')}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMonitorChatHidden((v) => !v)}
                    title={monitorChatHidden ? 'Mostrar chat de texto' : 'Ocultar chat de texto'}
                    className={`p-2 rounded-lg transition-colors ${
                      monitorChatHidden
                        ? 'text-gray-400 hover:text-blue-400 hover:bg-gray-700'
                        : 'text-blue-400 hover:text-blue-300 hover:bg-gray-700'
                    }`}
                  >
                    <MessageSquare size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleMonitorFullscreen()}
                    title={monitorFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                  >
                    {monitorFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                  </button>
                  <button
                    type="button"
                    onClick={stopSpying}
                    title="Cerrar monitor"
                    className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors"
                  >
                    <XCircle size={20} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <div
              className={`flex-1 bg-black grid min-h-0 min-w-0 ${
                spyTarget && spyPeerSid
                  ? 'grid-cols-1 min-[420px]:grid-cols-2 divide-y min-[420px]:divide-y-0 min-[420px]:divide-x divide-gray-800'
                  : 'grid-cols-1'
              }`}
            >
            {spyTarget ? (
              <>
                <div className="relative bg-gray-950 flex flex-col min-h-[140px] min-w-0">
                  <video
                    ref={spyVideoPrimaryRef}
                    autoPlay
                    playsInline
                    muted
                    className="flex-1 w-full min-h-[120px] object-cover bg-black"
                  />
                  <div className="absolute top-2 left-2 bg-red-600/85 backdrop-blur text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 animate-pulse z-10">
                    <span className="w-1.5 h-1.5 bg-white rounded-full" />
                    LIVE
                  </div>
                  {(() => {
                    const target = users.find((u) => u.sid === spyTarget);
                    return target ? (
                      <div className="absolute bottom-2 left-2 right-2 bg-black/75 backdrop-blur text-white text-[11px] px-2 py-1.5 rounded-lg flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 z-10">
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[9px] font-bold shrink-0">
                          {(target.display_name || 'A')[0].toUpperCase()}
                        </div>
                        <span className="font-medium truncate min-w-0 max-w-full">{target.display_name}</span>
                        <span className="text-[9px] text-gray-400 shrink-0">Monitoreado</span>
                        {userMatchesAnyFavorite(target, favorites) && (
                          <Flag size={11} className="text-amber-400 shrink-0" fill="currentColor" />
                        )}
                      </div>
                    ) : null;
                  })()}
                </div>
                {spyPeerSid ? (
                  <div className="relative bg-gray-950 flex flex-col min-h-[140px] min-w-0">
                    <video
                      ref={spyVideoPeerRef}
                      autoPlay
                      playsInline
                      muted
                      className="flex-1 w-full min-h-[120px] object-cover bg-black"
                    />
                    {(() => {
                      const peer = users.find((u) => u.sid === spyPeerSid);
                      return peer ? (
                        <div className="absolute bottom-2 left-2 right-2 bg-black/75 backdrop-blur text-white text-[11px] px-2 py-1.5 rounded-lg flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 z-10">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-[9px] font-bold shrink-0">
                            {(peer.display_name || 'B')[0].toUpperCase()}
                          </div>
                          <span className="font-medium truncate min-w-0 max-w-full">{peer.display_name}</span>
                          <span className="text-[9px] text-gray-400 shrink-0">Interlocutor</span>
                          {userMatchesAnyFavorite(peer, favorites) && (
                            <Flag size={11} className="text-amber-400 shrink-0" fill="currentColor" />
                          )}
                        </div>
                      ) : (
                        <div className="absolute bottom-2 left-2 right-2 bg-black/75 text-gray-400 text-[11px] px-2 py-1 rounded z-10">
                          Interlocutor (sid…{spyPeerSid.slice(-6)})
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="col-span-full text-gray-600 flex flex-col items-center justify-center gap-1.5 max-lg:gap-1 max-lg:p-3 lg:gap-3 lg:p-6 text-center">
                <Video className="opacity-50 w-8 h-8 max-lg:w-7 max-lg:h-7 lg:w-12 lg:h-12 shrink-0" aria-hidden />
                <p className="text-xs lg:text-sm font-medium leading-snug px-2 max-lg:line-clamp-2">
                  Selecciona un usuario en línea para ver su cámara
                </p>
                <p className="text-[10px] lg:text-xs text-gray-600 max-w-[220px] lg:max-w-[240px] leading-snug max-lg:line-clamp-2">
                  En llamada: también aparece el interlocutor.
                </p>
              </div>
            )}
            </div>

            {spyTarget && !monitorChatHidden && (
              <div
                className={`shrink-0 border-t border-gray-800 flex flex-col min-h-[96px] bg-gray-950 ${
                  mdUp ? 'max-h-[min(28vh,168px)]' : 'max-h-[min(36vh,220px)]'
                }`}
              >
                <MatchChatPanel
                  messages={monitorChatMessages}
                  readOnly
                  variant={mdUp ? 'desktop' : 'mobile'}
                  headerTitle="Chat en vivo"
                  emptyReadOnlyHint="Sin mensajes todavía en esta sesión."
                  onHideChat={() => setMonitorChatHidden(true)}
                  translateMode={translateMode}
                  onTranslateModeChange={setTranslateMode}
                  profileLanguageCode={language}
                  translateTargetLabel={translateTargetLabel}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
