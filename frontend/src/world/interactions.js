export const INTERACTION_DURATION_MS = 3500;
const INTERACT_WALK_DURATION_MS = 350;

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

// Both participants need to converge on the SAME fixed meeting point, computed
// once from a single shared route between their starting tiles and cached on
// the command object (so whichever character's startCommand runs first computes
// it, and the other reuses it). Splitting the route down the middle and having
// each side walk their own half guarantees they end up adjacent to each other,
// regardless of how the room's other characters are wandering around them —
// unlike having each side independently path toward the other's starting
// snapshot, which does NOT reliably converge once both are moving at once.
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

  const splitIndex = Math.floor(route.length / 2);
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
