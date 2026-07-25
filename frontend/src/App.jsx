import { useState } from "react";
import ShowSetup from "./components/ShowSetup";
import WorldPage from "./pages/WorldPage";

export default function App() {
  const [show, setShow] = useState(null);

  if (!show) {
    return <ShowSetup onCreated={setShow} />;
  }

  return <WorldPage show={show} onEndGame={() => setShow(null)} />;
}
