import { connection } from "next/server";
import { clip } from "../handlers";

export async function GET(request: Request) {
  await connection();
  return clip(request);
}
