import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { socket } from '../sockets/socket';
import { resolveUserIdForIdentify } from '../utils/resolveSocketUserId';
import type { DashboardUser } from '../types/adminDashboard';
import {
  MONITOR_WALL_SLOT_COUNT,
  type SlotBinding,
  loadMonitorSlotBindings,
  saveMonitorSlotBindings,
  loadMonitorAudioEnabled,
  saveMonitorAudioEnabled,
  resolveUserByBinding,
} from '../utils/adminMonitorSlots';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function collectSpyTargets(users: DashboardUser[], bindings: SlotBinding[]) {
  const targets = new Set<string>();
  const primarySidBySlot: (string | null)[] = Array(MONITOR_WALL_SLOT_COUNT).fill(null);
  const peerSidBySlot: (string | null)[] = Array(MONITOR_WALL_SLOT_COUNT).fill(null);

  for (let i = 0; i < MONITOR_WALL_SLOT_COUNT; i++) {
    const u = resolveUserByBinding(users, bindings[i]);
    if (!u?.sid) continue;
    targets.add(u.sid);
    primarySidBySlot[i] = u.sid;
    if (u.presence === 'in_call' && u.connected_to?.sid) {
      targets.add(u.connected_to.sid);
      peerSidBySlot[i] = u.connected_to.sid;
    }
  }

  return {
    targets: [...targets],
    primarySidBySlot,
    peerSidBySlot,
  };
}

function collectRoomIds(users: DashboardUser[], bindings: SlotBinding[]): string[] {
  const set = new Set<string>();
  for (const b of bindings) {
    const u = resolveUserByBinding(users, b);
    if (u?.match_room_id) set.add(u.match_room_id);
  }
  return [...set];
}

/** WebRTC espía hasta 16 usuarios; audio opcional por celda; streams completos (vídeo+audio). */
export function useAdminMonitorWall(users: DashboardUser[]) {
  const [bindings, setBindings] = useState<SlotBinding[]>(() => loadMonitorSlotBindings());
  const [audioEnabled, setAudioEnabled] = useState<boolean[]>(() => loadMonitorAudioEnabled());
  const [streamTick, setStreamTick] = useState(0);

  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const spyPcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const streamsRef = useRef<Record<string, MediaStream>>({});
  const videoRefs = useRef<(HTMLVideoElement | null)[]>(Array(MONITOR_WALL_SLOT_COUNT).fill(null));
  const audioRefs = useRef<(HTMLAudioElement | null)[]>(Array(MONITOR_WALL_SLOT_COUNT).fill(null));
  const primarySidBySlotRef = useRef<(string | null)[]>(Array(MONITOR_WALL_SLOT_COUNT).fill(null));
  const peerSidBySlotRef = useRef<(string | null)[]>(Array(MONITOR_WALL_SLOT_COUNT).fill(null));
  const prevTargetsRef = useRef<string[]>([]);

  const setSlotBinding = useCallback((slotIndex: number, binding: SlotBinding) => {
    setBindings((prev) => {
      const next = [...prev];
      next[slotIndex] = binding;
      saveMonitorSlotBindings(next);
      return next;
    });
  }, []);

  const clearAllSlots = useCallback(() => {
    const empty = Array(MONITOR_WALL_SLOT_COUNT).fill(null) as SlotBinding[];
    saveMonitorSlotBindings(empty);
    setBindings(empty);
  }, []);

  const toggleSlotAudio = useCallback((slotIndex: number) => {
    setAudioEnabled((prev) => {
      const next = [...prev];
      next[slotIndex] = !next[slotIndex];
      saveMonitorAudioEnabled(next);
      return next;
    });
  }, []);

  const setVideoRef = useCallback((slotIndex: number, el: HTMLVideoElement | null) => {
    videoRefs.current[slotIndex] = el;
    const sid = primarySidBySlotRef.current[slotIndex];
    if (el && sid && streamsRef.current[sid]) {
      el.srcObject = streamsRef.current[sid];
      el.muted = true;
    }
  }, []);

  const setAudioRef = useCallback((slotIndex: number, el: HTMLAudioElement | null) => {
    audioRefs.current[slotIndex] = el;
  }, []);

  const attachStreamToSlots = useCallback((targetSid: string, stream: MediaStream) => {
    streamsRef.current[targetSid] = stream;
    for (let i = 0; i < MONITOR_WALL_SLOT_COUNT; i++) {
      if (primarySidBySlotRef.current[i] === targetSid) {
        const v = videoRefs.current[i];
        if (v) {
          v.srcObject = stream;
          v.muted = true;
        }
      }
    }
    setStreamTick((t) => t + 1);
  }, []);

  const closePc = useCallback((sid: string) => {
    const pc = spyPcsRef.current[sid];
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      delete spyPcsRef.current[sid];
    }
    delete streamsRef.current[sid];
    for (let i = 0; i < MONITOR_WALL_SLOT_COUNT; i++) {
      if (primarySidBySlotRef.current[i] === sid) {
        const v = videoRefs.current[i];
        if (v) v.srcObject = null;
      }
    }
    setStreamTick((t) => t + 1);
  }, []);

  useEffect(() => {
    for (let i = 0; i < MONITOR_WALL_SLOT_COUNT; i++) {
      const el = audioRefs.current[i];
      if (!el) continue;
      const sid = primarySidBySlotRef.current[i];
      const stream = sid ? streamsRef.current[sid] : null;
      if (audioEnabled[i] && stream) {
        el.srcObject = stream;
        el.muted = false;
        void el.play().catch(() => {});
      } else {
        el.pause();
        el.srcObject = null;
      }
    }
  }, [audioEnabled, streamTick, bindings]);

  useEffect(() => {
    const onConnect = () => {
      const st = useAppStore.getState();
      socket.emit('identify', {
        user_id: resolveUserIdForIdentify(socket.id),
        role: st.role,
        display_name: st.displayName,
        gender: null,
        country: null,
        language: null,
        birth_year: null,
        is_anonymous: false,
      });
    };

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
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        attachStreamToSlots(targetSid, stream);
      };
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('spy_answer', { target_sid: targetSid, answer });
    };

    const handleSpyIce = async (data: { from_sid: string; candidate: RTCIceCandidateInit }) => {
      const pc = spyPcsRef.current[data.from_sid];
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    };

    if (!socket.connected) socket.connect();
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    socket.on('spy_offer', handleSpyOffer);
    socket.on('spy_ice_candidate', handleSpyIce);

    return () => {
      socket.off('connect', onConnect);
      socket.off('spy_offer', handleSpyOffer);
      socket.off('spy_ice_candidate', handleSpyIce);
      Object.keys(spyPcsRef.current).forEach((sid) => closePc(sid));
      if (socket.connected) {
        socket.emit('admin_spy_watch', { targets: [], room_ids: [] });
      }
    };
  }, [attachStreamToSlots, closePc]);

  useEffect(() => {
    const { targets, primarySidBySlot, peerSidBySlot } = collectSpyTargets(users, bindings);
    primarySidBySlotRef.current = primarySidBySlot;
    peerSidBySlotRef.current = peerSidBySlot;

    const prev = prevTargetsRef.current;
    for (const sid of prev) {
      if (!targets.includes(sid)) closePc(sid);
    }
    for (const sid of targets) {
      if (!prev.includes(sid) && socket.connected) {
        socket.emit('admin_spy_request', { target_sid: sid });
      }
    }
    prevTargetsRef.current = targets;

    if (socket.connected) {
      socket.emit('admin_spy_watch', {
        targets,
        room_ids: collectRoomIds(users, bindings),
      });
    }
  }, [users, bindings, closePc]);

  const getStreamForSid = useCallback((sid: string | null) => {
    if (!sid) return null;
    return streamsRef.current[sid] ?? null;
  }, [streamTick]);

  const getSlotMeta = useCallback(
    (slotIndex: number) => {
      const binding = bindings[slotIndex];
      const user = resolveUserByBinding(users, binding);
      return {
        binding,
        user,
        primarySid: primarySidBySlotRef.current[slotIndex],
        peerSid: peerSidBySlotRef.current[slotIndex],
        audioOn: audioEnabled[slotIndex],
      };
    },
    [bindings, users, audioEnabled, streamTick]
  );

  return {
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
    getVideoAtSlot: (i: number) => videoRefs.current[i],
  };
}
