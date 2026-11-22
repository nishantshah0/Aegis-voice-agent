import { redirect } from "next/navigation";

export default function SafetyHome() {
  redirect("/app/safety/gate");
}
