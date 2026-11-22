import { notFound } from "next/navigation";

// Any /app path with no page: the app's own not-found (inside the shell), not the bare site 404.
export default function Missing(): never {
  notFound();
}
