import { start } from "../handlers";

export async function POST(request: Request) {
  return start(request);
}
