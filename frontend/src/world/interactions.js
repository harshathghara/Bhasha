export const INTERACTION_DURATION_MS = 3500;
// Matches engine.js's WALK_DURATION_MS: halved because map.js's grid
// resolution doubled, so each tile-step now covers half the real distance.
const INTERACT_WALK_DURATION_MS = 175;

export function directionToward(fromX, fromY, toX, toY) {
  if (toX > fromX) return "right";
  if (toX < fromX) return "left";
  if (toY > fromY) return "down";
  return "up";
}

export function isCommandReady(character, charactersById) {
  const command = character.queue[0];
  if (!command) return false;
  if (command.kind !== "private") return true;

  const partnerId = command.senderId === character.id ? command.recipientId : command.senderId;
  const partner = charactersById.get(partnerId);
  if (!partner) return false;
  return Boolean(partner.queue[0] && partner.queue[0].id === command.id);
}

export function beginInteracting(character, direction) {
  character.mode = "interacting";
  character.direction = direction;
  character.interactingRemainingMs = INTERACTION_DURATION_MS;
  character.moving = false;
  character.path = [];
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function distanceToNearest(tile, occupiedTiles) {
  if (occupiedTiles.length === 0) return Infinity;
  return Math.min(...occupiedTiles.map((occupied) => manhattan(occupied, tile)));
}

// Other characters currently paused in a conversation (mode "interacting"),
// excluding the two about to meet — this is the "crowd" a new meeting point
// should stay away from, not just anyone who happens to be wandering nearby.
function otherActivePairTiles(charactersById, excludingIds) {
  const tiles = [];
  for (const character of charactersById.values()) {
    if (excludingIds.has(character.id)) continue;
    if (character.mode === "interacting") {
      tiles.push({ x: character.tileX, y: character.tileY });
    }
  }
  return tiles;
}

// Among every way to split the shared route into a sender-half and a
// recipient-half, pick the split whose two meeting tiles are farthest from
// the nearest occupied tile (maximizing the minimum distance), tie-breaking
// toward the natural midpoint so behavior is unchanged when nothing is
// crowded (occupiedTiles empty -> every candidate scores Infinity -> the
// tie-break alone decides, landing exactly on the old floor(length/2) split).
function pickSpacedSplitIndex(route, occupiedTiles) {
  const naturalMid = Math.floor(route.length / 2);
  let bestIndex = naturalMid;
  let bestScore = -Infinity;
  let bestTieDistance = Infinity;

  for (let i = 0; i <= route.length - 2; i += 1) {
    const score = Math.min(
      distanceToNearest(route[i], occupiedTiles),
      distanceToNearest(route[i + 1], occupiedTiles),
    );
    const tieDistance = Math.abs(i - naturalMid);
    if (score > bestScore || (score === bestScore && tieDistance < bestTieDistance)) {
      bestScore = score;
      bestTieDistance = tieDistance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// Both participants need to converge on the SAME fixed meeting point, computed
// once from a single shared route between their starting tiles and cached on
// the command object (so whichever character's startCommand runs first computes
// it, and the other reuses it). Splitting the route and having each side walk
// their own half guarantees they end up adjacent to each other, regardless of
// how the room's other characters are wandering around them — unlike having
// each side independently path toward the other's starting snapshot, which
// does NOT reliably converge once both are moving at once. The split point is
// chosen to keep this new meeting away from any other pair already mid
// conversation, so the room doesn't accumulate a single huddle over time.
export function buildMeetPlan(command, charactersById, findPath) {
  const sender = charactersById.get(command.senderId);
  const recipient = charactersById.get(command.recipientId);
  const route = findPath(
    { x: sender.tileX, y: sender.tileY },
    { x: recipient.tileX, y: recipient.tileY },
  );

  if (!route) {
    return { senderPath: null, recipientPath: null };
  }

  if (route.length <= 2) {
    return { senderPath: [], recipientPath: [] };
  }

  const occupied = otherActivePairTiles(charactersById, new Set([sender.id, recipient.id]));
  const splitIndex = pickSpacedSplitIndex(route, occupied);
  return {
    senderPath: route.slice(1, splitIndex + 1),
    recipientPath: route.slice(splitIndex + 1, route.length - 1).reverse(),
  };
}

export function startCommand(character, charactersById, findPath) {
  const command = character.queue[0];
  character.activeCommand = command;

  if (command.kind !== "private") {
    beginInteracting(character, character.direction);
    return;
  }

  const partnerId = command.senderId === character.id ? command.recipientId : command.senderId;
  const partner = charactersById.get(partnerId);

  if (!command.meetPlan) {
    command.meetPlan = buildMeetPlan(command, charactersById, findPath);
  }

  const isSender = command.senderId === character.id;
  const myPath = isSender ? command.meetPlan.senderPath : command.meetPlan.recipientPath;

  if (myPath === null || myPath.length === 0) {
    beginInteracting(
      character,
      directionToward(character.tileX, character.tileY, partner.tileX, partner.tileY),
    );
    return;
  }

  character.mode = "walking-to-interact";
  character.path = myPath;
}

export function advanceWalkingToInteract(character, deltaMs, charactersById) {
  if (!character.moving) {
    const next = character.path[0];
    if (!next) {
      const command = character.activeCommand;
      const partnerId = command.senderId === character.id ? command.recipientId : command.senderId;
      const partner = charactersById.get(partnerId);
      const direction = partner
        ? directionToward(character.tileX, character.tileY, partner.tileX, partner.tileY)
        : character.direction;
      beginInteracting(character, direction);
      return;
    }

    character.targetX = next.x;
    character.targetY = next.y;
    character.direction = directionToward(character.tileX, character.tileY, next.x, next.y);
    character.moving = true;
    character.walkProgress = 0;
    character.path = character.path.slice(1);
    return;
  }

  character.walkProgress += deltaMs / INTERACT_WALK_DURATION_MS;
  if (character.walkProgress >= 1) {
    character.tileX = character.targetX;
    character.tileY = character.targetY;
    character.targetX = undefined;
    character.targetY = undefined;
    character.moving = false;
    character.walkProgress = 0;
  }
}

export function advanceInteracting(character, deltaMs) {
  character.interactingRemainingMs -= deltaMs;
  if (character.interactingRemainingMs <= 0) {
    character.queue = character.queue.slice(1);
    character.activeCommand = null;
    character.mode = "wander";
  }
}
