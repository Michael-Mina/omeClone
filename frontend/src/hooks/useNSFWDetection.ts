import { useEffect, useRef, useState } from 'react';
import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

/** Fallback ≈ intensidad global 50 (servidor) hasta que llegue `/api/settings/nsfw-detection`. */
export const DEFAULT_NSFW_DETECTION_RUNTIME = {
  probabilityThreshold: 0.6,
  frameIntervalMs: 1500,
  lowFramesToClear: 2,
  consecutiveFramesToTrigger: 2,
} as const;

export type NsfwDetectionRuntimeConfig = {
  probabilityThreshold: number;
  frameIntervalMs: number;
  lowFramesToClear: number;
  consecutiveFramesToTrigger?: number;
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
  /** Histérisis: varios frames seguidos bajo el umbral para quitar NSFW; varios por encima para activar. */
  const consecutiveLowRef = useRef(0);
  const consecutiveHighRef = useRef(0);
  const rt = runtime ?? DEFAULT_NSFW_DETECTION_RUNTIME;
  const needHigh = Math.max(1, Math.min(10, rt.consecutiveFramesToTrigger ?? 2));

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
    consecutiveHighRef.current = 0;
    consecutiveLowRef.current = 0;
  }, [rt.probabilityThreshold, rt.lowFramesToClear, needHigh, rt.frameIntervalMs]);

  useEffect(() => {
    if (skipModel) return;

    const detect = async () => {
      if (!modelRef.current) return;
      if (videoRef.current && videoRef.current.readyState === 4) { // HAVE_ENOUGH_DATA
        try {
          const predictions = await modelRef.current.classify(videoRef.current);

          const byClass = Object.fromEntries(predictions.map((p) => [p.className, p.probability])) as Record<
            string,
            number
          >;
          const p = byClass.Porn ?? 0;
          const h = byClass.Hentai ?? 0;
          const sx = byClass.Sexy ?? 0;
          // Porn+Hentai como señal fuerte; Sexy aporta ante contenido sugerente sin sumar igual que Porn.
          const nsfwProbability = Math.min(1, p + h + 0.4 * sx);

          if (nsfwProbability > rt.probabilityThreshold) {
            consecutiveLowRef.current = 0;
            consecutiveHighRef.current += 1;
            if (consecutiveHighRef.current >= needHigh) {
              setIsNSFW(true);
            }
          } else {
            consecutiveHighRef.current = 0;
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
  }, [videoRef, isModelLoading, skipModel, rt.probabilityThreshold, rt.frameIntervalMs, rt.lowFramesToClear, needHigh]);

  return { isNSFW, isModelLoading };
};
