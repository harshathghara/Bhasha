import WorldView from "../components/WorldView";

export const PLACEHOLDER_CHARACTERS = [
  { id: "slot-1", name: "Housemate 1", spriteKey: "slot-1", tileX: 2, tileY: 2 },
  { id: "slot-2", name: "Housemate 2", spriteKey: "slot-2", tileX: 4, tileY: 2 },
  { id: "slot-3", name: "Housemate 3", spriteKey: "slot-3", tileX: 6, tileY: 2 },
  { id: "slot-4", name: "Housemate 4", spriteKey: "slot-4", tileX: 3, tileY: 5 },
  { id: "slot-5", name: "Housemate 5", spriteKey: "slot-5", tileX: 6, tileY: 5 },
];

export default function WorldPage() {
  return (
    <div>
      <h1>The House</h1>
      <WorldView characters={PLACEHOLDER_CHARACTERS} />
    </div>
  );
}
