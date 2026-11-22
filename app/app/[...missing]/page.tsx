import { notFound } from "next/navigation";

// Cache Components needs one param to prerender the shell (it reads the path). A placeholder
// no real page has; every other unknown /app path renders on request.
export async function generateStaticParams() {
  return [{ missing: ["__shell__"] }];
}

// Any /app path with no page: the app's own not-found (inside the shell), not the bare site 404.
export default function Missing(): never {
  notFound();
}
