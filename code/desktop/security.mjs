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
