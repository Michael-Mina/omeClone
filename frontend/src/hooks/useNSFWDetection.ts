import { useEffect, useRef, useState } from 'react';
import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

export const useNSFWDetection = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  role: string,
  exemptFromAiCensorship: boolean
) => {
  const [isNSFW, setIsNSFW] = useState(false);
  const [internalLoading, setInternalLoading] = useState(true);
  const skipModel = role === 'superadmin' || exemptFromAiCensorship;
  const isModelLoading = skipModel ? false : internalLoading;
  const modelRef = useRef<nsfwjs.NSFWJS | null>(null);
  const intervalRef = useRef<number | null>(null);
  /** Evita parpadeo: hace falta varios frames seguidos por debajo del umbral para quitar NSFW. */
  const consecutiveLowRef = useRef(0);
  const LOW_FRAMES_TO_CLEAR = 2;

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

          // Umbral 60%; histéresis: un frame malo ya marca; hace falta varios frames buenos seguidos para limpiar.
          if (nsfwProbability > 0.6) {
            consecutiveLowRef.current = 0;
            setIsNSFW(true);
          } else {
            consecutiveLowRef.current += 1;
            if (consecutiveLowRef.current >= LOW_FRAMES_TO_CLEAR) {
              setIsNSFW(false);
            }
          }
        } catch {
          // Ignore frame errors
        }
      }
    };

    // Analiza 1 frame cada 1.5 segundos para no saturar el procesador
    intervalRef.current = window.setInterval(detect, 1500);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [videoRef, isModelLoading, skipModel]);

  return { isNSFW, isModelLoading };
};
