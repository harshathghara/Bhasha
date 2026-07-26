import { useMemo, useState } from "react";
import WorldView from "../components/WorldView";
import RoundEndModal from "../components/RoundEndModal";
import { getShow, startRound, endShow } from "../api/client";

const SPAWN_POSITIONS = [
  { tileX: 3, tileY: 3 },
  { tileX: 16, tileY: 3 },
  { tileX: 10, tileY: 3 },
  { tileX: 3, tileY: 12 },
  { tileX: 16, tileY: 12 },
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

const startRoundButtonStyle = {
  position: "absolute",
  top: 12,
  left: 12,
  zIndex: 2,
  border: "1px solid #3a3a44",
  borderRadius: "6px",
  background: "#2a2a32",
  color: "#e8e8ec",
  padding: "9px 12px",
  fontWeight: 700,
};

export default function WorldPage({ show, onEndGame = () => {} }) {
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
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

  async function runRound(openingBrief = "") {
    const previousEnded = endedRound;
    setStarting(true);
    setStartError(null);
    setStoryOpen(false);
    setRoundActive(true);
    setEndedRound(null);
    try {
      const trimmed = typeof openingBrief === "string" ? openingBrief.trim() : "";
      const result = await startRound(
        show.id,
        trimmed ? { opening_brief: trimmed } : {},
      );
      setNarratives((prev) => ({
        ...prev,
        [result.round]: result.narrative,
      }));
      setEndedRound({
        round: result.round,
        recap: result.recap || result.narrative,
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
          return {
            round: last,
            recap: narratives[last],
            narrative: narratives[last],
          };
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

  async function handleEndGame() {
    setEnding(true);
    setStartError(null);
    try {
      await endShow(show.id);
      onEndGame();
    } catch (error) {
      setStartError(error.message || "Failed to end game");
    } finally {
      setEnding(false);
    }
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      {!roundActive && !modalOpen && (
        <button
          onClick={() => runRound()}
          disabled={starting || showOver}
          style={{ ...startRoundButtonStyle, opacity: starting || showOver ? 0.6 : 1 }}
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
            color: "#8c4456",
            maxWidth: 320,
            background: "#fff2f5",
            border: "1px solid #e5b7c4",
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
          recap={endedRound.recap}
          narratives={narratives}
          storyOpen={storyOpen}
          showOver={showOver}
          starting={starting}
          ending={ending}
          onStartNext={runRound}
          onToggleStory={handleToggleStory}
          onEndGame={handleEndGame}
        />
      )}
    </div>
  );
}
