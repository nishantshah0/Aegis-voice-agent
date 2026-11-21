// The contract: shared types every role builds against (DESIGN section 3).
// Fakes are in ./fakes and are imported separately: import { createFakes } from "@/lib/contract/fakes".
// Changes need a "Contract change request" issue and a HUMAN "ok".

export * from "./ids";
export * from "./buttons";
export * from "./guard";
export * from "./events";
export * from "./driver";
export * from "./rules";
export * from "./store";
export * from "./api";
export { STARTING_CARDS } from "./cards";
