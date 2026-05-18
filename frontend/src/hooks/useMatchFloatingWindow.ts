import { useCallback, useEffect, useRef, type RefObject } from 'react';

type DocPiP = {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
};

function getDocumentPiP(): DocPiP | undefined {
  return (window as Window & { documentPictureInPicture?: DocPiP }).documentPictureInPicture;
}

function supportsDocumentPiP(): boolean {
  return typeof getDocumentPiP()?.requestWindow === 'function';
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
    .wrap { display: flex; flex-direction: column; height: 100%; }
  .video-wrap {
      flex: 1; position: relative; background: #000; min-height: 0;
    }
    video {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .bar {
      display: flex; align-items: center; justify-content: center;
      gap: 10px; padding: 10px 12px;
      background: linear-gradient(to top, rgba(0,0,0,.95), rgba(0,0,0,.75));
      border-top: 1px solid rgba(255,255,255,.08);
    }
    .btn {
      flex: 1; max-width: 88px; display: flex; flex-direction: column;
      align-items: center; gap: 4px; padding: 8px 6px;
      border: none; border-radius: 12px; cursor: pointer;
      background: rgba(255,255,255,.1); color: #e5e7eb;
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .04em; transition: background .15s, transform .1s;
    }
    .btn:hover { background: rgba(255,255,255,.18); }
    .btn:active { transform: scale(.96); }
    .btn svg { width: 22px; height: 22px; }
    .btn-mic-on { background: rgba(34,197,94,.25); color: #86efac; }
    .btn-mic-off { background: rgba(239,68,68,.3); color: #fca5a5; }
    .btn-next { background: rgba(59,130,246,.3); color: #93c5fd; }
    .btn-max { background: rgba(168,85,247,.25); color: #d8b4fe; }
    .badge {
      position: absolute; top: 8px; left: 8px; z-index: 2;
      padding: 4px 8px; border-radius: 8px; font-size: 10px; font-weight: 800;
      background: rgba(0,0,0,.65); color: #a5b4fc; letter-spacing: .06em;
    }
  `;
  doc.head.appendChild(style);
}

const ICON_MIC_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICON_MIC_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICON_NEXT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l10 8-10 8V4zm11 0v16h2V4h-2z"/></svg>`;
const ICON_MAX = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

type Options = {
  /** Solo en llamada activa. */
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
  const pipWindowRef = useRef<Window | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipMicBtnRef = useRef<HTMLButtonElement | null>(null);
  const openingRef = useRef(false);
  const callbacksRef = useRef({ onToggleMic, onNext });
  callbacksRef.current = { onToggleMic, onNext };

  const syncStreamToPiP = useCallback(() => {
    const pipV = pipVideoRef.current;
    const main = remoteVideoRef.current;
    if (!pipV || !main?.srcObject) return;
    if (pipV.srcObject !== main.srcObject) {
      pipV.srcObject = main.srcObject;
      pipV.muted = false;
      void pipV.play().catch(() => {
        pipV.muted = true;
        void pipV.play().catch(() => {});
      });
    }
  }, [remoteVideoRef]);

  const updateMicButton = useCallback((muted: boolean) => {
    const btn = pipMicBtnRef.current;
    if (!btn) return;
    btn.className = `btn ${muted ? 'btn-mic-off' : 'btn-mic-on'}`;
    btn.innerHTML = `${muted ? ICON_MIC_OFF : ICON_MIC_ON}<span>${muted ? 'Activar' : 'Silenciar'}</span>`;
    btn.title = muted ? 'Activar micrófono' : 'Silenciar micrófono';
  }, []);

  const closePiP = useCallback(() => {
    const w = pipWindowRef.current;
    pipWindowRef.current = null;
    pipVideoRef.current = null;
    pipMicBtnRef.current = null;
    if (w && !w.closed) {
      try {
        w.close();
      } catch {
        /* noop */
      }
    }
    const api = getDocumentPiP();
    if (api?.window && !api.window.closed) {
      try {
        api.window.close();
      } catch {
        /* noop */
      }
    }
  }, []);

  const openDocumentPiP = useCallback(async () => {
    if (!supportsDocumentPiP() || !active || openingRef.current) return;
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      syncStreamToPiP();
      return;
    }
    const main = remoteVideoRef.current;
    if (!main?.srcObject) return;

    const api = getDocumentPiP();
    if (!api) return;

    openingRef.current = true;
    try {
      const pipWin = await api.requestWindow({
        width: Math.min(420, Math.round(window.screen.width * 0.38)),
        height: Math.min(340, Math.round(window.screen.height * 0.32)),
      });
      pipWindowRef.current = pipWin;
      const doc = pipWin.document;
      injectPiPStyles(doc);

      const wrap = doc.createElement('div');
      wrap.className = 'wrap';
      wrap.innerHTML = `
        <div class="video-wrap">
          <span class="badge">Albedrío</span>
        </div>
        <div class="bar"></div>
      `;

      const videoWrap = wrap.querySelector('.video-wrap')!;
      const video = doc.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.playsInline = true;
      video.autoplay = true;
      pipVideoRef.current = video;
      videoWrap.appendChild(video);

      const bar = wrap.querySelector('.bar')!;

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
        closePiP();
        window.focus();
      });

      bar.append(btnMic, btnNext, btnMax);
      doc.body.appendChild(wrap);

      updateMicButton(micMuted);
      syncStreamToPiP();

      pipWin.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        pipVideoRef.current = null;
        pipMicBtnRef.current = null;
      });
    } catch (err) {
      console.warn('[PiP] No se pudo abrir ventana flotante', err);
    } finally {
      openingRef.current = false;
    }
  }, [active, remoteVideoRef, micMuted, syncStreamToPiP, updateMicButton, closePiP]);

  const openClassicVideoPiP = useCallback(async () => {
    const el = remoteVideoRef.current;
    if (!el?.srcObject || document.pictureInPictureElement === el) return;
    try {
      await el.requestPictureInPicture();
    } catch {
      /* noop */
    }
  }, [remoteVideoRef]);

  const tryOpenFloating = useCallback(() => {
    if (!active) return;
    if (supportsDocumentPiP()) {
      void openDocumentPiP();
    } else if (document.pictureInPictureEnabled && remoteVideoRef.current) {
      void openClassicVideoPiP();
    }
  }, [active, openDocumentPiP, openClassicVideoPiP, remoteVideoRef]);

  useEffect(() => {
    if (!active) {
      closePiP();
      if (document.pictureInPictureElement instanceof HTMLVideoElement) {
        void document.exitPictureInPicture().catch(() => {});
      }
      return;
    }

    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        tryOpenFloating();
      }
    };

    const onShow = () => {
      closePiP();
      if (document.pictureInPictureElement) {
        void document.exitPictureInPicture().catch(() => {});
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
      else onShow();
    };

    const onBlur = () => {
      if (document.visibilityState === 'hidden') onHide();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onShow);
      closePiP();
    };
  }, [active, tryOpenFloating, closePiP]);

  useEffect(() => {
    updateMicButton(micMuted);
  }, [micMuted, updateMicButton]);

  useEffect(() => {
    if (!pipWindowRef.current || pipWindowRef.current.closed) return;
    syncStreamToPiP();
  }, [active, syncStreamToPiP]);

  useEffect(() => {
    if (!pipWindowRef.current) return;
    const id = window.setInterval(syncStreamToPiP, 800);
    return () => window.clearInterval(id);
  }, [active, syncStreamToPiP]);

  return { tryOpenFloating, closeFloating: closePiP, supportsDocumentPiP: supportsDocumentPiP() };
}
