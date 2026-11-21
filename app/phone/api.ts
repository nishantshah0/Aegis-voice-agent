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

/** Say, code and end need the call's phone token (Role 2 DECISION: x-phone-token). */
const tokenHeader = (token?: string): Record<string, string> => (token ? { "x-phone-token": token } : {});

const json = (body: unknown, token?: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...tokenHeader(token) },
  body: JSON.stringify(body),
});

type Connected = { callId: string; phoneToken?: string };

const id = (callId: string) => encodeURIComponent(callId);

export const phoneApi = {
  dial: () => call<CallStartResponse & Connected>("/api/call/start", json({ direction: "inbound" }), "Calling the pharmacy isn't connected yet."),
  answer: (callId: string, token?: string) => call<Connected>(`/api/call/${id(callId)}/answer`, json({}, token), "Answer isn't connected yet."),
  say: (callId: string, text: string, token?: string) => call<unknown>(`/api/call/${id(callId)}/say`, json({ text }, token), "This call has ended."),
  code: (callId: string, token?: string) =>
    call<{ code?: string }>(`/api/call/${id(callId)}/code`, { method: "GET", headers: tokenHeader(token) }, "No code for this call."),
  checkIn: (callId: string, token?: string) => call<unknown>(`/api/call/${id(callId)}/check-in`, json({}, token), "Check-in isn't connected yet."),
  end: (callId: string, token?: string) => call<unknown>(`/api/call/${id(callId)}/end`, json({}, token), "Hanging up isn't connected yet."),
};
