import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "../../_lib/http";

export const prefix = "/api/presenter/phone";
export const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export const callSid = /^CA[a-f\d]{32}$/i;
export function equal(a: string, b: string) {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}
export function origin(): string {
  const value = process.env.AEGIS_PUBLIC_ORIGIN ?? "";
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value) throw new Error("Invalid public origin");
  return value;
}
export function presenter(request: Request) {
  const secret = process.env.AEGIS_PRESENTER_SECRET ?? "";
  const proof = request.headers.get("x-aegis-presenter");
  if (Buffer.byteLength(secret) < 32 || !proof || !equal(proof, secret))
    return fail(403, "Presenter access required.");
  const supplied = request.headers.get("origin");
  if (supplied && supplied !== origin()) return fail(403, "Invalid presenter origin.");
  return null;
}
export function demoCode(id: string) {
  return String(
    createHmac("sha256", process.env.AEGIS_PRESENTER_SECRET!)
      .update("phone/pin/" + id)
      .digest()
      .readUInt32BE(0) % 1_000_000,
  ).padStart(6, "0");
}
export function turnToken(id: string, step: number, expires: string) {
  return createHmac("sha256", process.env.AEGIS_PRESENTER_SECRET!)
    .update(["phone/turn", id, step, expires].join("/"))
    .digest("base64url");
}
export function clipToken(id: string, key: string) {
  return createHmac("sha256", process.env.AEGIS_PRESENTER_SECRET!)
    .update("phone/audio/" + id + "/" + key)
    .digest("base64url");
}
export function ready() {
  origin();
  return Boolean(
    process.env.AEGIS_DEMO_STORAGE_URL &&
    process.env.ELEVENLABS_API_KEY &&
    process.env.TWILIO_AUTH_TOKEN &&
    /^AC[a-f\d]{32}$/i.test(process.env.TWILIO_ACCOUNT_SID ?? "") &&
    [process.env.TWILIO_PHONE_NUMBER, process.env.TEST_PATIENT_PHONE].every((v) =>
      /^\+[1-9]\d{6,14}$/.test(v ?? ""),
    ),
  );
}
