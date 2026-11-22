import { connection } from "next/server";
import { audio } from "../handlers";

export async function GET(request: Request) {
  await connection();
  return audio(request);
}
