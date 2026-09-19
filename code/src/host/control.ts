type ParentPort = {
  on(event: "message", listener: (event: unknown) => void): void;
  off?(event: "message", listener: (event: unknown) => void): void;
  postMessage(message: unknown): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;

export function hostConnected() {
  return Boolean(parentPort || process.connected);
}

export function sendHost(message: unknown, callback?: (error?: Error | null) => void) {
  if (parentPort) {
    try {
      parentPort.postMessage(message);
      callback?.(null);
      return true;
    } catch (error) {
      callback?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }
  if (!process.connected || !process.send) {
    callback?.(new Error("Host is disconnected"));
    return false;
  }
  if (callback) process.send(message, (error) => callback(error));
  else process.send(message);
  return true;
}

export function onHostMessage(listener: (message: unknown) => void) {
  if (parentPort) {
    const handler = (event: unknown) => {
      const value = event && typeof event === "object" && "data" in event
        ? (event as { data: unknown }).data
        : event;
      listener(value);
    };
    parentPort.on("message", handler);
    return () => parentPort.off?.("message", handler);
  }
  process.on("message", listener);
  return () => process.off("message", listener);
}

export function onHostDisconnect(listener: () => void) {
  if (parentPort) return () => {};
  process.once("disconnect", listener);
  return () => process.off("disconnect", listener);
}

export function disconnectHost() {
  if (!parentPort && process.connected) process.disconnect();
}
