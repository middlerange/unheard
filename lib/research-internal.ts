// Signed calls let Workflows drive bounded steps without exposing an unauthenticated job runner.
const encoder = new TextEncoder();
export async function signResearchRequest(
  body: string,
  secret: string,
  timestamp = Date.now().toString(),
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${body}`),
  );
  return {
    timestamp,
    signature: Array.from(new Uint8Array(mac), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
export async function verifyResearchRequest(
  request: Request,
  body: string,
  secret: string,
  now = Date.now(),
) {
  const timestamp = request.headers.get("x-research-timestamp") || "";
  const signature = request.headers.get("x-research-signature") || "";
  if (
    secret.length < 32 ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300_000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const expected = await signResearchRequest(body, secret, timestamp);
  let difference = 0;
  for (let i = 0; i < expected.signature.length; i++)
    difference |= expected.signature.charCodeAt(i) ^ signature.charCodeAt(i);
  return difference === 0;
}
