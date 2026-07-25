import { useState } from "react";
import WorldPage from "./pages/WorldPage";

export default function App() {
  const [view, setView] = useState("setup");

  return (
    <div>
      <nav>
        <button onClick={() => setView("setup")} disabled={view === "setup"}>
          Show Setup
        </button>
        <button onClick={() => setView("world")} disabled={view === "world"}>
          View World
        </button>
      </nav>

      {view === "setup" && <p>Show setup flow goes here.</p>}
      {view === "world" && <WorldPage />}
    </div>
  );
}
