import { useMemo, useState } from "react";
import WorldView from "../components/WorldView";
import { startRound } from "../api/client";

const SPAWN_POSITIONS = [
  { tileX: 2, tileY: 2 },
  { tileX: 4, tileY: 2 },
  { tileX: 6, tileY: 2 },
  { tileX: 3, tileY: 5 },
  { tileX: 6, tileY: 5 },
];

export function buildCharacters(show) {
  return show.contestants.map((contestant, index) => ({
    id: contestant.id,
    name: contestant.name,
    spriteKey: `slot-${index + 1}`,
    ...SPAWN_POSITIONS[index],
  }));
}

export default function WorldPage({ show }) {
  const [starting, setStarting] = useState(false);
  const characters = useMemo(() => buildCharacters(show), [show]);

  async function handleStart() {
    setStarting(true);
    try {
      await startRound(show.id);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div>
      <button onClick={handleStart} disabled={starting}>Start round</button>
      <WorldView showId={show.id} characters={characters} />
    </div>
  );
}
