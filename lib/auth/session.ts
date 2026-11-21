import type { Approver } from "@/lib/contract";

// Who is making this request, from their Auth0 session. Task 2.4 wires Auth0 in.
// Until then nobody is signed in, so every approval is refused. There is
// deliberately no other way to name an approver: never from the request body.

export type { Approver };
export type Role = Approver["role"];

export async function getApprover(request: Request): Promise<Approver | null> {
  void request; // Task 2.4 reads the Auth0 session from this request.
  return null;
}

export function hasRole(approver: Approver | null, role: Role): approver is Approver {
  return approver !== null && approver.role === role;
}
