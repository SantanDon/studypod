/**
 * Keep notebook history deterministic even when legacy rows share a timestamp.
 * New local turns use distinct timestamps, but older chat rows may not.
 */
export function sortChatMessages(messages) {
  const roleOrder = { user: 0, assistant: 1 };
  return [...messages].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;

    const leftRole = roleOrder[left.role] ?? 2;
    const rightRole = roleOrder[right.role] ?? 2;
    if (leftRole !== rightRole) return leftRole - rightRole;

    const leftId = String(left.id ?? "");
    const rightId = String(right.id ?? "");
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}
