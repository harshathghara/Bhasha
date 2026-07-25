import { useMemo, useState } from "react";
import WorldView from "../components/WorldView";
import RoundEndModal from "../components/RoundEndModal";
import { getShow, startRound } from "../api/client";

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

function isRoundLimitError(error) {
  return /round limit/i.test(error?.message || "");
}

export default function WorldPage({ show }) {
  const [starting, setStarting] = useState(false);
  const [roundActive, setRoundActive] = useState(false);
  const [endedRound, setEndedRound] = useState(null);
  const [narratives, setNarratives] = useState(() => ({ ...(show.narratives || {}) }));
  const [storyOpen, setStoryOpen] = useState(false);
  const [showOver, setShowOver] = useState(show.status === "ended");
  const [startError, setStartError] = useState(null);
  const [dialogueBusy, setDialogueBusy] = useState(false);

  const characters = useMemo(() => buildCharacters(show), [show]);

  // Wait for in-world bubbles / pending dialogue to finish before showing the modal.
  const modalOpen = endedRound != null && !roundActive && !dialogueBusy;

  async function runRound(producerNote = "") {
    const previousEnded = endedRound;
    setStarting(true);
    setStartError(null);
    setStoryOpen(false);
    setRoundActive(true);
    setEndedRound(null);
    try {
      const trimmed = typeof producerNote === "string" ? producerNote.trim() : "";
      const result = await startRound(
        show.id,
        trimmed ? { producer_note: trimmed } : {},
      );
      setNarratives((prev) => ({
        ...prev,
        [result.round]: result.narrative,
      }));
      setEndedRound({
        round: result.round,
        narrative: result.narrative,
      });
      if (show.max_rounds != null && result.round >= show.max_rounds) {
        setShowOver(true);
      }
    } catch (error) {
      if (isRoundLimitError(error)) {
        setShowOver(true);
        setEndedRound((prev) => {
          if (prev) return prev;
          if (previousEnded) return previousEnded;
          const rounds = Object.keys(narratives).map(Number);
          if (rounds.length === 0) return null;
          const last = Math.max(...rounds);
          return { round: last, narrative: narratives[last] };
        });
      } else {
        setStartError(error.message || "Failed to start round");
      }
    } finally {
      setStarting(false);
      setRoundActive(false);
    }
  }

  async function handleToggleStory() {
    const next = !storyOpen;
    setStoryOpen(next);
    if (next) {
      try {
        const fresh = await getShow(show.id);
        if (fresh.narratives) {
          setNarratives((prev) => ({ ...prev, ...fresh.narratives }));
        }
      } catch {
        // Keep local narratives if refresh fails.
      }
    }
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      {!roundActive && !modalOpen && (
        <button
          onClick={() => runRound()}
          disabled={starting || showOver}
          style={{ position: "absolute", top: 12, left: 12, zIndex: 2 }}
        >
          {showOver ? "Show over" : "Start round"}
        </button>
      )}
      {startError && (
        <p
          role="alert"
          style={{
            position: "absolute",
            top: 48,
            left: 12,
            zIndex: 2,
            color: "#ff6b6b",
            maxWidth: 320,
            background: "rgba(0,0,0,0.7)",
            padding: "8px 10px",
            margin: 0,
          }}
        >
          {startError}
        </p>
      )}
      <WorldView
        showId={show.id}
        characters={characters}
        onDialogueBusyChange={setDialogueBusy}
      />
      {modalOpen && (
        <RoundEndModal
          round={endedRound.round}
          recap={endedRound.narrative}
          narratives={narratives}
          storyOpen={storyOpen}
          showOver={showOver}
          starting={starting}
          onStartNext={runRound}
          onToggleStory={handleToggleStory}
        />
      )}
    </div>
  );
}
