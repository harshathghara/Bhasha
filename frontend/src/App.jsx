import { useEffect, useState } from "react";
import { getShow, openEventSocket } from "./api/client";
import ShowSetup from "./components/ShowSetup";
import LiveRoom from "./components/LiveRoom";
import EventFeed from "./components/EventFeed";

export default function App() {
  const [show, setShow] = useState(null);
  const showId = show?.id;

  useEffect(() => {
    if (!showId) return undefined;
    const socket = openEventSocket(showId, (event) =>
      setShow((current) => ({ ...current, events: [...current.events, event] }))
    );
    return () => socket.close();
  }, [showId]);

  // The producer controls change server-side state rather than returning a
  // show, so refetch the authoritative one instead of trusting their payloads.
  async function refresh() {
    setShow(await getShow(showId));
  }

  if (!show) {
    return <ShowSetup onCreated={setShow} />;
  }

  return (
    <main>
      <h1>{show.title}</h1>
      <LiveRoom show={show} onShowUpdated={refresh} />
      <EventFeed
        showId={show.id}
        events={show.events}
        narratives={show.narratives}
        onEventReleased={refresh}
      />
    </main>
  );
}
