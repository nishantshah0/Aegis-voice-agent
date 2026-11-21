import { getApprover } from "@/lib/auth/session";
import { labelBodySchema, saveLabel } from "../labels";

// POST /console/review/labels { callId, marks, note? } → 200 { label }
// A pharmacist or reviewer signed in through Auth0 labels a finished call. The labeller
// is always the session's approver; anything named in the body is ignored.
export async function POST(request: Request) {
  const approver = await getApprover();
  if (!approver) return Response.json({ error: "Sign in as a pharmacist or reviewer to label calls" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send the label as JSON" }, { status: 400 });
  }
  const parsed = labelBodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "That isn't a label", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  const label = await saveLabel({ ...parsed.data, by: approver });
  return Response.json({ label });
}
