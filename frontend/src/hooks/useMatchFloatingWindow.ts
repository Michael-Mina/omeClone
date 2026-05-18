import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type DocPiPApi = {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export type PipCapability = 'document' | 'video' | 'none';
export type PipMode = 'document' | 'video' | null;
export type MatchStatus = 'idle' | 'waiting' | 'matched' | 'stopped';

function getDocPiP(): DocPiPApi | undefined {
  return (window as Window & { documentPictureInPicture?: DocPiPApi }).documentPictureInPicture;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function getPipCapability(): PipCapability {
  if (typeof getDocPiP()?.requestWindow === 'function') return 'document';
  if (!isMobileDevice() && typeof document !== 'undefined' && document.pictureInPictureEnabled) {
    return 'video';
  }
  return 'none';
}

function injectPiPStyles(doc: Document): void {
  const style = doc.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100%; overflow: hidden;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      background: #0a0a0a; color: #fff;
    }
    .wrap {
      display: flex; flex-direction: column;
      width: 100%; height: 100%; max-height: 100dvh;
    }
    .video-wrap {
      flex: 1 1 auto; position: relative; background: #000; min-height: 0;
    }
    video {
      width: 100%; height: 100%; object-fit: cover; display: block; background: #000;
    }
    .bar {
      display: flex; align-items: stretch; justify-content: center;
      gap: 6px; padding: 8px 8px max(10px, env(safe-area-inset-bottom, 0px));
      background: #111; border-top: 1px solid rgba(255,255,255,.12);
      flex: 0 0 auto; min-height: 52px;
    }
    .btn {
      flex: 1; max-width: 72px; display: flex; align-items: center; justify-content: center;
      min-height: 44px; min-width: 44px; padding: 8px;
      border: none; border-radius: 12px; cursor: pointer;
      background: rgba(255,255,255,.12); color: #e5e7eb;
    }
    .btn:hover { background: rgba(255,255,255,.2); }
    .btn:active { transform: scale(.96); }
    .btn svg { width: 24px; height: 24px; flex-shrink: 0; display: block; }
    .btn-mic-on { background: rgba(34,197,94,.35); color: #bbf7d0; }
    .btn-mic-off { background: rgba(239,68,68,.4); color: #fecaca; }
    .btn-next { background: rgba(59,130,246,.35); color: #bfdbfe; }
    .btn-max { background: rgba(168,85,247,.35); color: #e9d5ff; }
    .badge {
      position: absolute; top: 6px; left: 6px; z-index: 2;
      padding: 3px 7px; border-radius: 6px; font-size: 9px; font-weight: 800;
      background: rgba(0,0,0,.7); color: #c4b5fd;
    }
    .waiting {
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; color: #9ca3af; font-size: 11px; padding: 8px;
      text-align: center;
    }
  `;
  doc.head.appendChild(style);
}

const ICON_MIC_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICON_MIC_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICON_NEXT = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4l10 8-10 8V4zm11 0v16h2V4h-2z"/></svg>`;
const ICON_MAX = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

type Options = {
  matchStatus: MatchStatus;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  micMuted: boolean;
  onToggleMic: () => void;
  onNext: () => void;
};

export function useMatchFloatingWindow({
  matchStatus,
  remoteVideoRef,
  micMuted,
  onToggleMic,
  onNext,
}: Options) {
  const [isFloatingOpen, setIsFloatingOpen] = useState(false);
  const [pipMode, setPipMode] = useState<PipMode>(null);
  const [floatingError, setFloatingError] = useState<string | null>(null);

  const pipWindowRef = useRef<Window | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipMicBtnRef = useRef<HTMLButtonElement | null>(null);
  const pipWaitingElRef = useRef<HTMLElement | null>(null);
  const openingRef = useRef(false);
  const modeRef = useRef<PipMode>(null);
  const callbacksRef = useRef({ onToggleMic, onNext, onFocusApp: () => {} });
  callbacksRef.current.onToggleMic = onToggleMic;
  callbacksRef.current.onNext = onNext;

  const pipCapability = getPipCapability();
  const keepFloatingAlive = matchStatus === 'matched' || matchStatus === 'waiting';
  const canOpenFloating = matchStatus === 'matched';

  const getRemoteStream = useCallback(() => {
    const el = remoteVideoRef.current;
    if (!el?.srcObject || !(el.srcObject instanceof MediaStream)) return null;
    return el.srcObject;
  }, [remoteVideoRef]);

  const focusMainAndClosePip = useCallback(() => {
    const child = pipWindowRef.current;
    const api = getDocPiP();

    if (child && !child.closed) {
      try {
        child.close();
      } catch {
        /* noop */
      }
    } else if (api?.window && !api.window.closed) {
      try {
        api.window.close();
      } catch {
        /* noop */
      }
    }

    pipWindowRef.current = null;
    pipVideoRef.current = null;
    pipMicBtnRef.current = null;
    pipWaitingElRef.current = null;
    modeRef.current = null;
    setPipMode(null);
    setIsFloatingOpen(false);

    try {
      window.focus();
    } catch {
      /* noop */
    }
  }, []);

  callbacksRef.current.onFocusApp = focusMainAndClosePip;

  const updateMicButton = useCallback((muted: boolean) => {
    const btn = pipMicBtnRef.current;
    if (!btn) return;
    btn.className = `btn ${muted ? 'btn-mic-off' : 'btn-mic-on'}`;
    btn.innerHTML = muted ? ICON_MIC_OFF : ICON_MIC_ON;
    btn.title = muted ? 'Activar micrófono' : 'Silenciar micrófono';
    btn.setAttribute('aria-label', btn.title);
  }, []);

  const setWaitingVisible = useCallback((show: boolean) => {
    const w = pipWaitingElRef.current;
    const v = pipVideoRef.current;
    if (w) w.style.display = show ? 'flex' : 'none';
    if (v) v.style.display = show ? 'none' : 'block';
  }, []);

  const syncStreamToPiP = useCallback(async () => {
    const stream = getRemoteStream();
    const pipV = pipVideoRef.current;

    if (modeRef.current === 'video') {
      const main = remoteVideoRef.current;
      if (main && stream && document.pictureInPictureElement !== main) {
        try {
          await main.requestPictureInPicture();
        } catch {
          /* noop */
        }
      }
      return;
    }

    if (!pipV) return;

    if (!stream || stream.getVideoTracks().length === 0) {
      setWaitingVisible(true);
      return;
    }

    setWaitingVisible(false);

    if (pipV.srcObject !== stream) {
      pipV.srcObject = stream;
    }

    pipV.muted = false;
    try {
      await pipV.play();
    } catch {
      pipV.muted = true;
      try {
        await pipV.play();
      } catch {
        /* noop */
      }
    }
  }, [getRemoteStream, remoteVideoRef, setWaitingVisible]);

  const cleanupDocumentPiP = useCallback(() => {
    pipWindowRef.current = null;
    pipVideoRef.current = null;
    pipMicBtnRef.current = null;
    pipWaitingElRef.current = null;
    if (modeRef.current === 'document') {
      modeRef.current = null;
      setPipMode(null);
    }
    setIsFloatingOpen(false);
  }, []);

  const cleanupAll = useCallback(async () => {
    const w = pipWindowRef.current;
    pipWindowRef.current = null;
    pipVideoRef.current = null;
    pipMicBtnRef.current = null;
    pipWaitingElRef.current = null;
    modeRef.current = null;
    setPipMode(null);

    if (w && !w.closed) {
      try {
        w.close();
      } catch {
        /* noop */
      }
    }

    const api = getDocPiP();
    if (api?.window && !api.window.closed) {
      try {
        api.window.close();
      } catch {
        /* noop */
      }
    }

    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch {
        /* noop */
      }
    }

    setIsFloatingOpen(false);
  }, []);

  const buildDocumentPiPWindow = useCallback(
    (pipWin: Window) => {
      const doc = pipWin.document;
      doc.title = 'Albedrío — llamada';
      injectPiPStyles(doc);

      const wrap = doc.createElement('div');
      wrap.className = 'wrap';

      const videoWrap = doc.createElement('div');
      videoWrap.className = 'video-wrap';

      const badge = doc.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Albedrío';

      const waiting = doc.createElement('div');
      waiting.className = 'waiting';
      waiting.textContent = 'Buscando…';
      pipWaitingElRef.current = waiting;

      const video = doc.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.setAttribute('disablepictureinpicture', '');
      video.playsInline = true;
      video.autoplay = true;
      video.controls = false;
      video.disablePictureInPicture = true;
      pipVideoRef.current = video;

      videoWrap.append(badge, waiting, video);

      const bar = doc.createElement('div');
      bar.className = 'bar';

      const btnMic = doc.createElement('button');
      btnMic.type = 'button';
      pipMicBtnRef.current = btnMic;
      btnMic.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.onToggleMic();
      });

      const btnNext = doc.createElement('button');
      btnNext.type = 'button';
      btnNext.className = 'btn btn-next';
      btnNext.innerHTML = ICON_NEXT;
      btnNext.title = 'Siguiente persona';
      btnNext.setAttribute('aria-label', 'Siguiente persona');
      btnNext.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.onNext();
      });

      const btnMax = doc.createElement('button');
      btnMax.type = 'button';
      btnMax.className = 'btn btn-max';
      btnMax.innerHTML = ICON_MAX;
      btnMax.title = 'Volver a la aplicación';
      btnMax.setAttribute('aria-label', 'Volver a la aplicación');
      btnMax.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.onFocusApp();
      });

      bar.append(btnMic, btnNext, btnMax);
      wrap.append(videoWrap, bar);
      doc.body.append(wrap);

      updateMicButton(micMuted);
    },
    [micMuted, updateMicButton]
  );

  const openDocumentPiP = useCallback(async (): Promise<boolean> => {
    const api = getDocPiP();
    if (!api || !canOpenFloating) return false;

    if (api.window && !api.window.closed) {
      pipWindowRef.current = api.window;
      modeRef.current = 'document';
      setPipMode('document');
      await syncStreamToPiP();
      setIsFloatingOpen(true);
      setFloatingError(null);
      return true;
    }

    if (openingRef.current) return false;

    const stream = getRemoteStream();
    if (!stream) {
      setFloatingError('Aún no hay vídeo. Espera a que conecte.');
      return false;
    }

    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch {
        /* noop */
      }
    }

    openingRef.current = true;
    setFloatingError(null);

    const mobile = window.matchMedia('(max-width: 768px)').matches;

    try {
      const pipWin = await api.requestWindow({
        width: mobile
          ? Math.min(360, window.screen.width - 16)
          : Math.min(440, Math.max(320, Math.round(window.screen.width * 0.34))),
        height: mobile
          ? Math.min(340, Math.max(280, Math.round(window.screen.height * 0.38)))
          : Math.min(380, Math.max(260, Math.round(window.screen.height * 0.36))),
      });

      pipWindowRef.current = pipWin;
      modeRef.current = 'document';
      setPipMode('document');
      buildDocumentPiPWindow(pipWin);
      await syncStreamToPiP();

      pipWin.addEventListener('pagehide', () => {
        cleanupDocumentPiP();
      });

      setIsFloatingOpen(true);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[PiP] Document PiP falló:', msg);
      setFloatingError('No se pudo abrir la ventana flotante.');
      return false;
    } finally {
      openingRef.current = false;
    }
  }, [canOpenFloating, getRemoteStream, syncStreamToPiP, buildDocumentPiPWindow, cleanupDocumentPiP]);

  const openVideoPiP = useCallback(async (asFallback = false): Promise<boolean> => {
    const el = remoteVideoRef.current;
    if (!el?.srcObject || !document.pictureInPictureEnabled) return false;

    try {
      if (document.pictureInPictureElement && document.pictureInPictureElement !== el) {
        await document.exitPictureInPicture();
      }
      if (document.pictureInPictureElement !== el) {
        await el.requestPictureInPicture();
      }
      modeRef.current = 'video';
      setPipMode('video');
      setIsFloatingOpen(true);
      setFloatingError(
        asFallback
          ? 'Vídeo flotante sin controles en ventana. Usa la barra inferior de la app.'
          : null
      );
      return true;
    } catch (err) {
      console.warn('[PiP] Video PiP falló:', err);
      return false;
    }
  }, [remoteVideoRef]);

  const enableFloating = useCallback(async () => {
    if (!canOpenFloating) {
      setFloatingError('Conéctate con alguien primero.');
      return false;
    }

    const mobile = isMobileDevice();

    if (pipCapability === 'document') {
      const ok = await openDocumentPiP();
      if (ok) return true;
      if (mobile) {
        setFloatingError('Usa Chrome en Android para ventana flotante con controles propios.');
        return false;
      }
      return openVideoPiP(true);
    }

    if (mobile) {
      setFloatingError(
        'En móvil el PiP del sistema no permite controles personalizados. Usa Chrome en Android.'
      );
      return false;
    }

    if (pipCapability === 'video') {
      return openVideoPiP(false);
    }

    setFloatingError('Tu navegador no admite ventana flotante.');
    return false;
  }, [canOpenFloating, pipCapability, openDocumentPiP, openVideoPiP]);

  const disableFloating = useCallback(async () => {
    setFloatingError(null);
    await cleanupAll();
  }, [cleanupAll]);

  const toggleFloating = useCallback(async () => {
    if (isFloatingOpen || pipWindowRef.current || document.pictureInPictureElement) {
      await disableFloating();
      return false;
    }
    return enableFloating();
  }, [isFloatingOpen, enableFloating, disableFloating]);

  useEffect(() => {
    if (!keepFloatingAlive) {
      void disableFloating();
    }
  }, [keepFloatingAlive, disableFloating]);

  useEffect(() => {
    if (matchStatus === 'waiting' && isFloatingOpen) {
      setWaitingVisible(true);
    }
    if (matchStatus === 'matched' && isFloatingOpen) {
      void syncStreamToPiP();
    }
  }, [matchStatus, isFloatingOpen, syncStreamToPiP, setWaitingVisible]);

  useEffect(() => {
    updateMicButton(micMuted);
  }, [micMuted, updateMicButton]);

  useEffect(() => {
    if (!isFloatingOpen) return;
    void syncStreamToPiP();
  }, [isFloatingOpen, matchStatus, syncStreamToPiP]);

  useEffect(() => {
    if (!isFloatingOpen) return;
    const id = window.setInterval(() => {
      void syncStreamToPiP();
    }, 600);
    return () => window.clearInterval(id);
  }, [isFloatingOpen, syncStreamToPiP]);

  useEffect(() => {
    const api = getDocPiP();
    if (!api?.addEventListener) return;

    const onLeave = () => {
      if (modeRef.current === 'document') cleanupDocumentPiP();
    };

    api.addEventListener('leave', onLeave);
    return () => api.removeEventListener?.('leave', onLeave);
  }, [cleanupDocumentPiP]);

  useEffect(() => {
    const onExitClassic = () => {
      if (modeRef.current === 'video') {
        modeRef.current = null;
        setPipMode(null);
        setIsFloatingOpen(false);
      }
    };
    document.addEventListener('leavepictureinpicture', onExitClassic);
    return () => document.removeEventListener('leavepictureinpicture', onExitClassic);
  }, []);

  useEffect(() => {
    if (!isFloatingOpen) return;

    const onVisibility = () => {
      void syncStreamToPiP();
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isFloatingOpen, syncStreamToPiP]);

  /** Controles en auriculares / pantalla bloqueada (móvil). */
  useEffect(() => {
    if (!isFloatingOpen || !('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: 'Albedrío', artist: 'Videollamada' });
    } catch {
      /* noop */
    }

    const onNextHandler = () => callbacksRef.current.onNext();
    const onMicHandler = () => callbacksRef.current.onToggleMic();

    try {
      ms.setActionHandler('nexttrack', onNextHandler);
      ms.setActionHandler('play', onMicHandler);
      ms.setActionHandler('pause', onMicHandler);
    } catch {
      /* noop */
    }

    return () => {
      try {
        ms.setActionHandler('nexttrack', null);
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
      } catch {
        /* noop */
      }
    };
  }, [isFloatingOpen]);

  return {
    pipCapability,
    pipMode,
    isFloatingOpen,
    floatingError,
    enableFloating,
    disableFloating,
    toggleFloating,
    focusMainAndClosePip,
    supportsDocumentPiP: pipCapability === 'document',
    showInAppPipControls: isFloatingOpen && pipMode === 'video',
  };
}
