/** Respuesta de GET /api/settings/nsfw-detection y evento socket `nsfw_global_settings_updated`. */
export type PublicNsfwDetectionSettings = {
  intensity: number;
  probability_threshold: number;
  frame_interval_ms: number;
  low_frames_to_clear: number;
  streak_ms: number;
  grace_false_ms: number;
};
