export function mapEvent(event) {
  if (event.kind === "agent_action" && event.visibility === "public") {
    return {
      id: event.seq, kind: "public", senderId: event.sender_id, text: event.text,
    };
  }

  if (event.kind === "agent_action" && event.visibility === "private") {
    return {
      id: event.seq,
      kind: "private",
      senderId: event.sender_id,
      recipientId: event.recipients[0],
      text: event.text,
    };
  }

  if (event.kind === "confession") {
    return {
      id: event.seq, kind: "confession", senderId: event.sender_id, text: event.text,
    };
  }

  if (event.kind === "gm_ruling" || event.kind === "gm_announcement") {
    return { id: event.seq, kind: "gm", text: event.text };
  }

  if (event.kind === "leak") {
    return {
      id: event.seq, kind: "leak", senderId: event.sender_id, text: event.text,
    };
  }

  return null;
}
