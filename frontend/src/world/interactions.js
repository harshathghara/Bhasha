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

export function startCommand(character, charactersById, findPath) {
  const command = character.queue[0];
  character.activeCommand = command;

  if (command.kind !== "private") {
    beginInteracting(character, character.direction);
    return;
  }

  const partnerId = command.senderId === character.id ? command.recipientId : command.senderId;
  const partner = charactersById.get(partnerId);
  const path = findPath(
    { x: character.tileX, y: character.tileY },
    { x: partner.tileX, y: partner.tileY },
  );

  if (path && path.length > 0) {
    character.mode = "walking-to-interact";
    character.path = path;
  } else {
    beginInteracting(
      character,
      directionToward(character.tileX, character.tileY, partner.tileX, partner.tileY),
    );
  }
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
