import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MatchZone } from '../types/matchZone';
import { DEFAULT_MATCH_ZONE } from '../types/matchZone';

interface AppState {
  userId: string | null;
  token: string | null;
  role: 'user' | 'superadmin';
  displayName: string | null;
  isAnonymous: boolean;
  /** Admin: saltar modelo NSFW local (además de superadmin). */
  exemptFromAiCensorship: boolean;
  gender: string | null;
  country: string | null;
  language: string | null;
  birthYear: number | null;
  /** Sala de videollamada elegida (colas separadas en el servidor). */
  matchZone: MatchZone;
  /** true tras elegir sala en /salas y entrar a videollamadas. */
  salaSessionActive: boolean;
  matchStatus: 'idle' | 'waiting' | 'matched' | 'stopped';
  roomId: string | null;
  peerSid: string | null;
  isInitiator: boolean;

  setAuth: (
    userId: string,
    token: string,
    role?: 'user' | 'superadmin',
    displayName?: string | null,
    isAnonymous?: boolean,
    profile?: {
      gender?: string | null;
      country?: string | null;
      language?: string | null;
      birthYear?: number | null;
      exemptFromAiCensorship?: boolean;
    } | null
  ) => void;
  setMatchStatus: (status: 'idle' | 'waiting' | 'matched' | 'stopped') => void;
  setMatchData: (roomId: string, initiator: boolean) => void;
  resetMatch: () => void;
  stopMatch: () => void;
  setMatchZone: (zone: MatchZone) => void;
  setSalaSessionActive: (active: boolean) => void;
  /** Sincronía desde servidor (admin / socket) sin volver a iniciar sesión. */
  applyServerExemptionSync: (p: { exemptFromAiCensorship: boolean }) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      userId: null,
      token: null,
      role: 'user',
      displayName: null,
      isAnonymous: false,
      exemptFromAiCensorship: false,
      gender: null,
      country: null,
      language: null,
      birthYear: null,
      matchZone: DEFAULT_MATCH_ZONE,
      salaSessionActive: false,
      matchStatus: 'idle',
      roomId: null,
      peerSid: null,
      isInitiator: false,

      setAuth: (userId, token, role = 'user', displayName = null, isAnonymous = false, profile) =>
        set({
          userId,
          token,
          role,
          displayName,
          isAnonymous,
          exemptFromAiCensorship: profile?.exemptFromAiCensorship ?? false,
          gender: profile?.gender ?? null,
          country: profile?.country ?? null,
          language: profile?.language ?? null,
          birthYear: profile?.birthYear ?? null,
        }),
      setMatchStatus: (status) => set({ matchStatus: status }),
      setMatchData: (roomId, initiator) => set({ roomId, isInitiator: initiator, matchStatus: 'matched' }),
      resetMatch: () => set({ matchStatus: 'idle', roomId: null, peerSid: null, isInitiator: false }),
      stopMatch: () => set({ matchStatus: 'stopped', roomId: null, peerSid: null, isInitiator: false }),
      setMatchZone: (zone) => set({ matchZone: zone }),
      setSalaSessionActive: (active) => set({ salaSessionActive: active }),
      applyServerExemptionSync: (p) => set({ exemptFromAiCensorship: p.exemptFromAiCensorship }),
    }),
    {
      name: 'ometv-auth',
      storage: createJSONStorage(() => localStorage),
      /** Solo sesión / perfil; matchmaking y sala no se persisten (evita estado “matched” fantasma al F5). */
      partialize: (state) => ({
        userId: state.userId,
        token: state.token,
        role: state.role,
        displayName: state.displayName,
        isAnonymous: state.isAnonymous,
        exemptFromAiCensorship: state.exemptFromAiCensorship,
        gender: state.gender,
        country: state.country,
        language: state.language,
        birthYear: state.birthYear,
        matchZone: state.matchZone,
      }),
    }
  )
);
