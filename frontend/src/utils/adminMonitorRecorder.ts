/**
 * Grabación del monitor admin: compone los <video> en un canvas y usa MediaRecorder.
 * MP4 solo si el navegador lo permite para MediaRecorder; si no, WebM (VP8/VP9).
 */

export type MonitorRecorderStop = () => Promise<void>;

export type MonitorRecorderOptions = {
  getVideoPrimary: () => HTMLVideoElement | null;
  getVideoPeer: () => HTMLVideoElement | null;
  getHasPeer: () => boolean;
  /** FPS del canvas (captureStream). Por defecto 30. */
  fps?: number;
};

function pickRecorderMimeType(): { mimeType: string; extension: 'mp4' | 'webm' } {
  const candidates: { mimeType: string; extension: 'mp4' | 'webm' }[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=h264', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder no está disponible en este navegador');
  }
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) {
      return { mimeType: c.mimeType, extension: c.extension };
    }
  }
  return { mimeType: 'video/webm', extension: 'webm' };
}

function attachAudioTracksFromVideo(canvasStream: MediaStream, videoEl: HTMLVideoElement | null) {
  const ms = videoEl?.srcObject;
  if (!(ms instanceof MediaStream)) return;
  const existing = new Set(canvasStream.getAudioTracks().map((t) => t.id));
  for (const t of ms.getAudioTracks()) {
    if (t.readyState !== 'live' || existing.has(t.id)) continue;
    try {
      canvasStream.addTrack(t);
      existing.add(t.id);
    } catch {
      /* track ya presente o no mezclable */
    }
  }
}

/**
 * Inicia la grabación; al llamar a stop() se genera la descarga automática.
 */
export function startMonitorRecording(opts: MonitorRecorderOptions): { stop: MonitorRecorderStop } {
  const fps = opts.fps ?? 30;
  const W = 1280;
  const H = 720;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear contexto 2D');

  let rafId = 0;
  const draw = () => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    const v1 = opts.getVideoPrimary();
    const v2 = opts.getVideoPeer();
    const hasPeer = opts.getHasPeer();
    try {
      if (hasPeer && v1 && v2 && v1.readyState >= 2 && v2.readyState >= 2) {
        ctx.drawImage(v1, 0, 0, W / 2, H);
        ctx.drawImage(v2, W / 2, 0, W / 2, H);
      } else if (v1 && v1.readyState >= 2) {
        ctx.drawImage(v1, 0, 0, W, H);
      }
    } catch {
      /* frame no listo */
    }
    rafId = requestAnimationFrame(draw);
  };
  rafId = requestAnimationFrame(draw);

  const { mimeType, extension } = pickRecorderMimeType();
  const canvasStream = canvas.captureStream(fps);
  attachAudioTracksFromVideo(canvasStream, opts.getVideoPrimary());
  if (opts.getHasPeer()) {
    attachAudioTracksFromVideo(canvasStream, opts.getVideoPeer());
  }

  const chunks: BlobPart[] = [];
  const rec = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
  });
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopPromise = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });

  rec.start(250);

  const baseType = mimeType.split(';')[0].trim() || (extension === 'mp4' ? 'video/mp4' : 'video/webm');

  return {
    async stop() {
      cancelAnimationFrame(rafId);
      if (rec.state === 'recording') {
        try {
          rec.requestData();
        } catch {
          /* ignore */
        }
        rec.stop();
      }
      await stopPromise;
      const blob = new Blob(chunks, { type: baseType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `ometv-monitor-${stamp}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}
