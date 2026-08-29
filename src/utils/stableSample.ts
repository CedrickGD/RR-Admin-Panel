function hashKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministically bounds decorative work without making the sample flicker on reorder. */
export function stableSampleByKey<T extends { key: string }>(
  items: readonly T[],
  limit: number,
): T[] {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (items.length <= boundedLimit) return [...items];
  if (boundedLimit === 0) return [];

  return items
    .map((item) => ({ item, hash: hashKey(item.key) }))
    .sort((left, right) => left.hash - right.hash || left.item.key.localeCompare(right.item.key))
    .slice(0, boundedLimit)
    .map(({ item }) => item);
}
