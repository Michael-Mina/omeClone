from pydantic import BaseModel, Field


class NsfwGlobalPatch(BaseModel):
    intensity: int = Field(ge=0, le=100)


class NsfwGlobalAdminOut(BaseModel):
    intensity: int
    probability_threshold: float
    frame_interval_ms: int
    low_frames_to_clear: int
    consecutive_frames_to_trigger: int = Field(ge=1, le=10)
    streak_ms: int
    grace_false_ms: int
