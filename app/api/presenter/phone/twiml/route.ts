import { twiml } from "../handlers";

export async function POST(request: Request) {
  return twiml(request);
}
