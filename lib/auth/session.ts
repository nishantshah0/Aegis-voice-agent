// Who is making this request, from their Auth0 session. Task 2.4 wires Auth0 in.
// Until then nobody is signed in, so every approval is refused. There is
// deliberately no other way to name an approver: never from the request body.

export type Role = "pharmacist" | "reviewer";

/** TEMPORARY until lib/contract/ defines Approver. */
export type Approver = { sub: string; name: string; roles: Role[] };

export async function getApprover(request: Request): Promise<Approver | null> {
  void request; // Task 2.4 reads the Auth0 session from this request.
  return null;
}

export function hasRole(approver: Approver | null, role: Role): approver is Approver {
  return approver !== null && approver.roles.includes(role);
}
