import json
from pathlib import Path


class ShowStore:
    def __init__(self, snapshot_dir: str = "snapshots"):
        self.shows = {}
        self.snapshot_dir = Path(snapshot_dir)
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)

    def add(self, show) -> None:
        self.shows[show.id] = show

    def get(self, show_id: str):
        if show_id not in self.shows:
            raise KeyError(f"No show with id {show_id}")
        return self.shows[show_id]

    def snapshot(self, show_id: str) -> None:
        show = self.get(show_id)
        path = self.snapshot_dir / f"{show_id}.json"
        path.write_text(json.dumps(show.to_dict(), indent=2))
