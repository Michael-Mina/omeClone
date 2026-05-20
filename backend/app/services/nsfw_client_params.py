"""Parámetros de detección NSFW en cliente derivados de intensidad global 0–100."""
from dataclasses import dataclass


@dataclass(frozen=True)
class NsfwClientParamsDTO:
    intensity: int
    probability_threshold: float
    frame_interval_ms: int
    low_frames_to_clear: int
    # Frames seguidos por encima del umbral antes de marcar NSFW (histérisis subida).
    consecutive_frames_to_trigger: int
    streak_ms: int
    grace_false_ms: int

    def as_dict(self) -> dict:
        return {
            "intensity": self.intensity,
            "probability_threshold": self.probability_threshold,
            "frame_interval_ms": self.frame_interval_ms,
            "low_frames_to_clear": self.low_frames_to_clear,
            "consecutive_frames_to_trigger": self.consecutive_frames_to_trigger,
            "streak_ms": self.streak_ms,
            "grace_false_ms": self.grace_false_ms,
        }


def clamp_intensity(raw: object) -> int:
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return 50
    return max(0, min(100, v))


def intensity_to_client_params(intensity: int | None) -> NsfwClientParamsDTO:
    """
    - 0: más permisivo (menos falsos positivos; tarda más en reportar strikes).
    - 50: encaja con valores históricos del repo (~0.6 umbral, 1.5s frame, streak ~10s).
    - 100: más estricto.

    El cliente usa Porn + Hentai y «Sexy» ponderado (ver frontend); el umbral en i≈0
    no debe pasarse de ~0.75 o casi no dispara ante contenido claro.
    En modo permisivo se exigen más frames consecutivos antes de activar.
    """
    i = clamp_intensity(intensity)
    t = i / 100.0

    # Antes: 0.82 en i=0 (casi imposible superar con Porn+Hentai). Curva más usable.
    threshold = round(0.74 - 0.36 * t, 4)
    frame_interval_ms = int(round(2000 - 1000 * t))
    frame_interval_ms = max(700, min(2800, frame_interval_ms))

    low_frames_to_clear = max(2, min(6, int(round(2 + 4 * (1 - t)))))

    consecutive_frames_to_trigger = max(1, min(3, int(round(3 - 2 * t))))

    streak_ms = int(round(14000 - 7500 * t))
    streak_ms = max(5500, min(24000, streak_ms))

    grace_false_ms = int(round(3800 - 2000 * t))
    grace_false_ms = max(1500, min(4200, grace_false_ms))

    return NsfwClientParamsDTO(
        intensity=i,
        probability_threshold=threshold,
        frame_interval_ms=frame_interval_ms,
        low_frames_to_clear=low_frames_to_clear,
        consecutive_frames_to_trigger=consecutive_frames_to_trigger,
        streak_ms=streak_ms,
        grace_false_ms=grace_false_ms,
    )
