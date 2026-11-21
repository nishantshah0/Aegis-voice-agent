import { redirect } from "next/navigation";

// /console has one tab on main so far: open Today.
export default function ConsolePage() {
  redirect("/console/today");
}
