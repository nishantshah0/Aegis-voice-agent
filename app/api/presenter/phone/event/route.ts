import { event } from "../handlers";

export async function POST(request: Request) {
  return event(request);
}
