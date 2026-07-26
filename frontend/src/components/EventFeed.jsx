import { useState } from "react";
import { releaseEvent } from "../api/client";

function label(event) {
  if (event.kind === "confession") return "[confession, viewers only]";
  if (event.kind === "gm_ruling") return "[game master ruling]";
  if (event.kind === "gm_announcement") return "[game master]";
  if (event.kind === "producer_note") return "[producer clue]";
  if (event.visibility === "private" && !event.released) return "[private, viewers only]";
  return "";
}

export default function EventFeed({ showId, events, narratives, onEventReleased }) {
  const [tab, setTab] = useState("live");

  async function handleReveal(seq) {
    const updated = await releaseEvent(showId, seq);
    onEventReleased(updated);
  }

  const rounds = Object.keys(narratives)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div>
      <button onClick={() => setTab("live")}>Live feed</button>
      <button onClick={() => setTab("story")}>Story</button>

      {tab === "live" && (
        <ul>
          {events.map((event) => (
            <li key={event.seq}>
              {label(event)} {event.sender_id}: {event.text}
              {event.visibility === "private" && !event.released && (
                <button onClick={() => handleReveal(event.seq)}>Reveal</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === "story" && (
        <div>
          {rounds.map((round) => (
            <p key={round}>{narratives[round]}</p>
          ))}
        </div>
      )}
    </div>
  );
}
