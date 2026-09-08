/** @param {string} message @param {string[]} secrets @param {NodeJS.ProcessEnv} env */
export function redactDiagnostic(message, secrets = [], env = process.env) {
  const credentials = [
    ...secrets,
    ...Object.entries(env)
      .filter(([name]) => /KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION/i.test(name))
      .map(([, value]) => value || ""),
  ];
  const literals = [...new Set(credentials.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (literals.length)
    message = message.replace(new RegExp(literals.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"), "[REDACTED]");
  message = message
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(
      /(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|_auth(?:token)?|token|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ");
  return message;
}
