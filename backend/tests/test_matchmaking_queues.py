"""Tests del servicio de matchmaking en memoria."""
import asyncio

from app.services.matchmaking import VALID_MATCH_ZONES, MatchmakingService, waiting_queues


def test_start_matchmaking_clears_sid_from_all_zones_before_enqueuing():
    for z in VALID_MATCH_ZONES:
        waiting_queues[z].clear()
    waiting_queues["moderated"].append({"user_id": "42", "sid": "sock-1", "match_zone": "moderated"})
    waiting_queues["adult"].append({"user_id": "42", "sid": "sock-1", "match_zone": "adult"})

    async def run():
        return await MatchmakingService.find_match_or_wait("42", "sock-1", {"match_zone": "moderated"})

    res = asyncio.run(run())
    assert res.get("matched") is False
    assert len(waiting_queues["adult"]) == 0
    assert len(waiting_queues["moderated"]) == 1
    assert waiting_queues["moderated"][0]["sid"] == "sock-1"
