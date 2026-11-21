// What the phone asks the server for. Every answer the phone shows comes back on
// /api/events; these calls only start things.

import type { CallStartResponse } from "@/lib/contract";

export type Result<T> = { ok: true; value: T } | { ok: false; problem: string };

async function call<T>(url: string, init: RequestInit, notWired: string): Promise<Result<T>> {
  try {
    const res = await fetch(url, init);
    if (res.status === 404 || res.status === 405) return { ok: false, problem: notWired };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, problem: body.error ?? `The pharmacy line answered ${res.status}.` };
    }
    const text = await res.text();
    return { ok: true, value: (text ? JSON.parse(text) : {}) as T };
  } catch {
    return { ok: false, problem: "No connection to the pharmacy line." };
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const id = (callId: string) => encodeURIComponent(callId);

export const phoneApi = {
  dial: () => call<CallStartResponse>("/api/call/start", json({ direction: "inbound" }), "Calling the pharmacy isn't connected yet."),
  answer: (callId: string) => call<unknown>(`/api/call/${id(callId)}/answer`, json({}), "Answer isn't connected yet."),
  say: (callId: string, text: string) => call<unknown>(`/api/call/${id(callId)}/say`, json({ text }), "This call has ended."),
  code: (callId: string) => call<{ code?: string }>(`/api/call/${id(callId)}/code`, { method: "GET" }, "No code for this call."),
  end: (callId: string) => call<unknown>(`/api/call/${id(callId)}/end`, json({}), "Hanging up isn't connected yet."),
};
