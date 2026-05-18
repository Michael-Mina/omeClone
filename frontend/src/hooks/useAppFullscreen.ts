import { useCallback, useEffect, useState, type RefObject } from 'react';

type WebKitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitExitFullscreen?: () => void;
};

export function useAppFullscreen(
  containerRef: RefObject<HTMLElement | null>,
  videoRef?: RefObject<HTMLVideoElement | null>
) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => {
      const el = containerRef.current;
      const video = videoRef?.current as WebKitVideo | null | undefined;
      const nativeVideoFs = Boolean(video?.webkitDisplayingFullscreen);
      setIsFullscreen(
        nativeVideoFs || (!!el && document.fullscreenElement === el)
      );
    };

    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    const video = videoRef?.current as WebKitVideo | undefined;
    video?.addEventListener?.('webkitbeginfullscreen', sync);
    video?.addEventListener?.('webkitendfullscreen', sync);

    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      video?.removeEventListener?.('webkitbeginfullscreen', sync);
      video?.removeEventListener?.('webkitendfullscreen', sync);
    };
  }, [containerRef, videoRef]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    const video = videoRef?.current as WebKitVideo | null | undefined;
    if (!el) return;

    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
        return;
      }

      if (video?.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
        video.webkitExitFullscreen();
        return;
      }

      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }

      if (el.requestFullscreen) {
        await el.requestFullscreen();
        return;
      }
    } catch {
      /* fallback iOS: pantalla completa del vídeo */
    }

    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
      setIsFullscreen(true);
    }
  }, [containerRef, videoRef]);

  return { isFullscreen, toggleFullscreen };
}
