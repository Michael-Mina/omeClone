import { useEffect, useRef, useState } from 'react';
import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

/** Fallback ≈ intensidad global 50 (servidor) hasta que llegue `/api/settings/nsfw-detection`. */
export const DEFAULT_NSFW_DETECTION_RUNTIME = {
  probabilityThreshold: 0.6,
  frameIntervalMs: 1500,
  lowFramesToClear: 2,
} as const;

export type NsfwDetectionRuntimeConfig = {
  probabilityThreshold: number;
  frameIntervalMs: number;
  lowFramesToClear: number;
};

export const useNSFWDetection = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  role: string,
  exemptFromAiCensorship: boolean,
  /** null → defaults locales hasta obtener config global (exentos igual omiten modelo). */
  runtime: NsfwDetectionRuntimeConfig | null
) => {
  const [isNSFW, setIsNSFW] = useState(false);
  const [internalLoading, setInternalLoading] = useState(true);
  const skipModel = role === 'superadmin' || exemptFromAiCensorship;
  const isModelLoading = skipModel ? false : internalLoading;
  const modelRef = useRef<nsfwjs.NSFWJS | null>(null);
  const intervalRef = useRef<number | null>(null);
  /** Evita parpadeo: hace falta varios frames seguidos por debajo del umbral para quitar NSFW. */
  const consecutiveLowRef = useRef(0);
  const rt = runtime ?? DEFAULT_NSFW_DETECTION_RUNTIME;

  useEffect(() => {
    if (skipModel) return;

    const loadModel = async () => {
      try {
        await tf.ready();
        // Se carga el modelo usando CDN
        const model = await nsfwjs.load();
        modelRef.current = model;
        setInternalLoading(false);
        console.log("NSFW Model loaded");
      } catch (err) {
        console.error("Failed to load NSFW model", err);
        setInternalLoading(false);
      }
    };

    loadModel();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [skipModel]);

  useEffect(() => {
    if (skipModel || !modelRef.current || !videoRef.current) return;

    const detect = async () => {
      if (videoRef.current && videoRef.current.readyState === 4) { // HAVE_ENOUGH_DATA
        try {
          const predictions = await modelRef.current!.classify(videoRef.current);
          
          const nsfwClasses = ['Porn', 'Hentai', 'Sexy'];
          let nsfwProbability = 0;

          predictions.forEach(p => {
            if (nsfwClasses.includes(p.className)) {
              nsfwProbability += p.probability;
            }
          });

          // Histéresis: un frame malo ya marca; hace falta varios frames buenos seguidos para limpiar.
          if (nsfwProbability > rt.probabilityThreshold) {
            consecutiveLowRef.current = 0;
            setIsNSFW(true);
          } else {
            consecutiveLowRef.current += 1;
            if (consecutiveLowRef.current >= rt.lowFramesToClear) {
              setIsNSFW(false);
            }
          }
        } catch {
          // Ignore frame errors
        }
      }
    };

    intervalRef.current = window.setInterval(detect, rt.frameIntervalMs);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [videoRef, isModelLoading, skipModel, rt.probabilityThreshold, rt.frameIntervalMs, rt.lowFramesToClear]);

  return { isNSFW, isModelLoading };
};
