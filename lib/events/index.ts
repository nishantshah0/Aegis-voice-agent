// Server-side entry point. Pages in the browser use "@/lib/events/client".
// The demo clock lives on the Store (store.now() / store.setNow()).
export { emit, subscribe, eventsSince } from "./bus";
export type * from "./types";
