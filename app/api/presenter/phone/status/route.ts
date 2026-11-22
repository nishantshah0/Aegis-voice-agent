import { connection } from "next/server";
import { status } from "../handlers";

export async function GET(request: Request) {
  await connection();
  return status(request);
}
