import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type DocPiPApi = {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export type PipCapability = 'document' | 'video' | 'none';

function getDocPiP(): DocPiPApi | undefined {
  return (window as Window & { documentPictureInPicture?: DocPiPApi }).documentPictureInPicture;
}

export function getPipCapability(): PipCapability {
  if (typeof getDocPiP()?.requestWindow === 'function') return 'document';
  if (typeof document !== 'undefined' && document.pictureInPictureEnabled) return 'video';
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
    .wrap { display: flex; flex-direction: column; height: 100%; min-height: 100vh; }
    .video-wrap {
      flex: 1; position: relative; background: #000; min-height: 120px;
    }
    video {
      width: 100%; height: 100%; object-fit: cover; display: block; background: #000;
    }
    .bar {
      display: flex; align-items: center; justify-content: center;
      gap: 8px; padding: 10px 10px 12px;
      background: #111; border-top: 1px solid rgba(255,255,255,.1);
      flex-shrink: 0;
    }
    .btn {
      flex: 1; max-width: 92px; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 4px;
      min-height: 56px; padding: 6px 4px;
      border: none; border-radius: 12px; cursor: pointer;
      background: rgba(255,255,255,.12); color: #e5e7eb;
      font-size: 9px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .04em;
    }
    .btn:hover { background: rgba(255,255,255,.2); }
    .btn:active { transform: scale(.96); }
    .btn svg { width: 22px; height: 22px; flex-shrink: 0; }
    .btn-mic-on { background: rgba(34,197,94,.35); color: #bbf7d0; }
    .btn-mic-off { background: rgba(239,68,68,.4); color: #fecaca; }
    .btn-next { background: rgba(59,130,246,.35); color: #bfdbfe; }
    .btn-max { background: rgba(168,85,247,.35); color: #e9d5ff; }
    .badge {
      position: absolute; top: 8px; left: 8px; z-index: 2;
      padding: 4px 8px; border-radius: 8px; font-size: 10px; font-weight: 800;
      background: rgba(0,0,0,.7); color: #c4b5fd;
    }
    .waiting {
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; color: #9ca3af; font-size: 12px; padding: 12px;
      text-align: center;
    }
  `;
  doc.head.appendChild(style);
}

const ICON_MIC_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICON_MIC_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICON_NEXT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l10 8-10 8V4zm11 0v16h2V4h-2z"/></svg>`;
const ICON_MAX = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

type Options = {
  active: boolean;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  micMuted: boolean;
  onToggleMic: () => void;
  onNext: () => void;
};

export function useMatchFloatingWindow({
  active,
  remoteVideoRef,
  micMuted,
  onToggleMic,
  onNext,
}: Options) {
  const [isFloatingOpen, setIsFloatingOpen] = useState(false);
  const [floatingError, setFloatingError] = useState<string | null>(null);

  const pipWindowRef = useRef<Window | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipMicBtnRef = useRef<HTMLButtonElement | null>(null);
  const pipWaitingElRef = useRef<HTMLElement | null>(null);
  const openingRef = useRef(false);
  const modeRef = useRef<'document' | 'video' | null>(null);
  const callbacksRef = useRef({ onToggleMic, onNext });
  callbacksRef.current = { onToggleMic, onNext };

  const pipCapability = getPipCapability();

  const getRemoteStream = useCallback(() => {
    const el = remoteVideoRef.current;
    if (!el?.srcObject || !(el.srcObject instanceof MediaStream)) return null;
    return el.srcObject;
  }, [remoteVideoRef]);

  const updateMicButton = useCallback((muted: boolean) => {
    const btn = pipMicBtnRef.current;
    if (!btn) return;
    btn.className = `btn ${muted ? 'btn-mic-off' : 'btn-mic-on'}`;
    btn.innerHTML = `${muted ? ICON_MIC_OFF : ICON_MIC_ON}<span>${muted ? 'Activar' : 'Silenciar'}</span>`;
    btn.title = muted ? 'Activar micrófono' : 'Silenciar micrófono';
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
    if (modeRef.current === 'document') modeRef.current = null;
    setIsFloatingOpen(false);
  }, []);

  const cleanupAll = useCallback(async () => {
    const w = pipWindowRef.current;
    pipWindowRef.current = null;
    pipVideoRef.current = null;
    pipMicBtnRef.current = null;
    pipWaitingElRef.current = null;
    modeRef.current = null;

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
      waiting.textContent = 'Esperando vídeo…';
      pipWaitingElRef.current = waiting;

      const video = doc.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.playsInline = true;
      video.autoplay = true;
      pipVideoRef.current = video;

      videoWrap.append(badge, waiting, video);

      const bar = doc.createElement('div');
      bar.className = 'bar';

      const btnMic = doc.createElement('button');
      btnMic.type = 'button';
      pipMicBtnRef.current = btnMic;
      btnMic.addEventListener('click', () => callbacksRef.current.onToggleMic());

      const btnNext = doc.createElement('button');
      btnNext.type = 'button';
      btnNext.className = 'btn btn-next';
      btnNext.innerHTML = `${ICON_NEXT}<span>Siguiente</span>`;
      btnNext.title = 'Siguiente persona';
      btnNext.addEventListener('click', () => callbacksRef.current.onNext());

      const btnMax = doc.createElement('button');
      btnMax.type = 'button';
      btnMax.className = 'btn btn-max';
      btnMax.innerHTML = `${ICON_MAX}<span>Abrir app</span>`;
      btnMax.title = 'Volver a la aplicación';
      btnMax.addEventListener('click', () => {
        try {
          window.opener?.focus();
        } catch {
          /* noop */
        }
        window.close();
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
    if (!api || !active) return false;

    if (api.window && !api.window.closed) {
      pipWindowRef.current = api.window;
      modeRef.current = 'document';
      await syncStreamToPiP();
      setIsFloatingOpen(true);
      setFloatingError(null);
      return true;
    }

    if (openingRef.current) return false;

    const stream = getRemoteStream();
    if (!stream) {
      setFloatingError('Aún no hay vídeo del otro usuario. Espera a que conecte.');
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

    try {
      const pipWin = await api.requestWindow({
        width: Math.min(440, Math.max(320, Math.round(window.screen.width * 0.34))),
        height: Math.min(380, Math.max(260, Math.round(window.screen.height * 0.36))),
      });

      pipWindowRef.current = pipWin;
      modeRef.current = 'document';
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
      setFloatingError(
        'No se pudo abrir la ventana flotante. En PC usa Chrome/Edge y pulsa el botón Flotante mientras ves la llamada.'
      );
      return false;
    } finally {
      openingRef.current = false;
    }
  }, [active, getRemoteStream, syncStreamToPiP, buildDocumentPiPWindow, cleanupDocumentPiP]);

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
      setIsFloatingOpen(true);
      setFloatingError(
        asFallback
          ? 'Modo vídeo flotante (sin botones). Para controles completos usa Chrome o Edge en PC.'
          : null
      );
      return true;
    } catch (err) {
      console.warn('[PiP] Video PiP falló:', err);
      return false;
    }
  }, [remoteVideoRef]);

  /** Debe llamarse desde un clic del usuario (obligatorio en PC). */
  const enableFloating = useCallback(async () => {
    if (!active) {
      setFloatingError('Conéctate con alguien primero.');
      return false;
    }

    if (pipCapability === 'document') {
      const ok = await openDocumentPiP();
      if (ok) return true;
      return openVideoPiP(true);
    }

    if (pipCapability === 'video') {
      return openVideoPiP(false);
    }

    setFloatingError('Tu navegador no admite ventana flotante. Prueba Chrome o Edge en PC.');
    return false;
  }, [active, pipCapability, openDocumentPiP, openVideoPiP]);

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
    if (!active) {
      void disableFloating();
    }
  }, [active, disableFloating]);

  useEffect(() => {
    updateMicButton(micMuted);
  }, [micMuted, updateMicButton]);

  useEffect(() => {
    if (!isFloatingOpen) return;
    void syncStreamToPiP();
  }, [isFloatingOpen, active, syncStreamToPiP]);

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
        setIsFloatingOpen(false);
      }
    };
    document.addEventListener('leavepictureinpicture', onExitClassic);
    return () => document.removeEventListener('leavepictureinpicture', onExitClassic);
  }, []);

  /** Si ya está activo el flotante y cambias de pestaña, solo re-sincroniza (no reabrir sin gesto). */
  useEffect(() => {
    if (!active || !isFloatingOpen) return;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void syncStreamToPiP();
      } else {
        void syncStreamToPiP();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, isFloatingOpen, syncStreamToPiP]);

  return {
    pipCapability,
    isFloatingOpen,
    floatingError,
    enableFloating,
    disableFloating,
    toggleFloating,
    supportsDocumentPiP: pipCapability === 'document',
  };
}
