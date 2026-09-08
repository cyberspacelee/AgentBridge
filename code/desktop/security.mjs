export function isWorkspaceUrl(value, origin) {
  try {
    const url = new URL(value);
    return (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      /^\/(?:tasks|agents|observability|settings)(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function externalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function authorizedHeaders(headers, url, origin, token, trusted) {
  const result = Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) => key.toLowerCase() !== "authorization",
    ),
  );
  try {
    const target = new URL(url);
    if (
      trusted &&
      target.origin === origin &&
      !target.username &&
      !target.password
    )
      result.Authorization = `Bearer ${token}`;
  } catch {
    // Malformed URLs must never receive the backend credential.
  }
  return result;
}
