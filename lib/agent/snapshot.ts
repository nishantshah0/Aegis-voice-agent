// A driver call's state as plain JSON, and back (hosted demo, Trail #70). Serverless instances
// share nothing in memory, so between turns the call's state lives in Postgres: the driver
// exports it after a turn and the next instance imports it before the next one. Maps and Sets
// are tagged so they come back as Maps and Sets; everything else is already plain data (the
// model's own message blocks, thinking signatures included, pass through unchanged).

type Tagged = { $map: [unknown, unknown][] } | { $set: unknown[] };

export function toSnapshot(value: unknown): unknown {
  if (value instanceof Map) return { $map: [...value].map(([k, v]) => [toSnapshot(k), toSnapshot(v)]) };
  if (value instanceof Set) return { $set: [...value].map(toSnapshot) };
  if (Array.isArray(value)) return value.map(toSnapshot);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toSnapshot(v)]));
  }
  return value;
}

export function fromSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromSnapshot);
  if (value && typeof value === "object") {
    const tagged = value as Tagged;
    if ("$map" in tagged && Array.isArray(tagged.$map)) return new Map(tagged.$map.map(([k, v]) => [fromSnapshot(k), fromSnapshot(v)]));
    if ("$set" in tagged && Array.isArray(tagged.$set)) return new Set(tagged.$set.map(fromSnapshot));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromSnapshot(v)]));
  }
  return value;
}
