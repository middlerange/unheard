export function researchJobErrorMessage(error: unknown): string {
  let current = error;
  let message = "Research job failed";
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && current && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current === "string") {
      if (current.trim()) message = current;
      break;
    }
    if (typeof current !== "object") break;
    const detail = current as { message?: unknown; cause?: unknown };
    if (typeof detail.message === "string" && detail.message.trim())
      message = detail.message;
    current = detail.cause;
  }
  if (/Failed query:|\bparams:/i.test(message))
    return "Research storage failed; no underlying database error was available.";
  return message.slice(0, 500);
}
