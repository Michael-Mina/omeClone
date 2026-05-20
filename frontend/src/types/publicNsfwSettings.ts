/** Respuesta de GET /api/settings/nsfw-detection y evento socket `nsfw_global_settings_updated`. */
export type PublicNsfwDetectionSettings = {
  intensity: number;
  probability_threshold: number;
  frame_interval_ms: number;
  low_frames_to_clear: number;
  /** Frames seguidos por encima del umbral antes de activar (histérisis). Opcional en APIs antiguas. */
  consecutive_frames_to_trigger?: number;
  streak_ms: number;
  grace_false_ms: number;
};
