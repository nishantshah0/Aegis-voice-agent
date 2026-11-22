import { sameSecret } from "@/lib/auth/presenter";
import { runBusinessChecks } from "./business-checks";

export async function POST(request: Request) {
  const secret = process.env.AEGIS_PRESENTER_SECRET;
  const proof = request.headers.get("x-aegis-presenter");
  const headers = { "Cache-Control": "private, no-store" };
  if (!secret || !proof || !sameSecret(proof, secret)) {
    return Response.json({ error: "Presenter access is required." }, { status: 403, headers });
  }
  return Response.json(await runBusinessChecks(), { headers });
}
