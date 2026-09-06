// A bounded network transport. No automatic retry and no persistent API cache.
export async function requestJSON(path, method = "GET", data, options = {}) {
  const writing = method !== "GET" && method !== "HEAD";
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const error = new Error("You are offline. Save eligible information requests in the Field desk, or reconnect to continue.");
    error.offline = true; error.status = 0; error.transmitted = false;
    throw error;
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? (writing ? 20000 : 12000));
  const headers = writing ? { "Content-Type": "application/json" } : {};
  if (options.expectedAccount) headers["X-ORACLE-Expected-Account"] = options.expectedAccount;
  try {
    const response = await (options.fetch || fetch)(path, {
      method, credentials: "same-origin", cache: "no-store", headers,
      body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal,
    });
    let result = {};
    if (response.status !== 204) {
      try { result = await response.json(); }
      catch {
        const error = new Error(writing ? "The server response could not be confirmed. Check the saved result before repeating this action." : "ORACLE returned an unreadable response. Your open drafts are still here; try reconnecting.");
        error.status = response.status || 502; error.transmitted = writing; error.uncertain = writing;
        throw error;
      }
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      const error = new Error("ORACLE returned an unexpected response. Reconnect and check the saved state.");
      error.status = 502; error.transmitted = writing; error.uncertain = writing;
      throw error;
    }
    return { response, result };
  } catch (cause) {
    if (typeof cause?.status === "number") throw cause;
    const error = new Error(timedOut
      ? (writing ? "The request timed out and its result is uncertain. Check the saved result, or retry a pending request with its original identifier." : "The connection is taking too long. Your drafts are still here; reconnect or open saved readings.")
      : (writing ? "The connection was interrupted and the result is uncertain. Check the saved result before repeating this action." : "ORACLE could not be reached. Your drafts are still here; reconnect or open saved readings."));
    error.status = 0; error.transmitted = writing; error.uncertain = writing; error.offline = true;
    throw error;
  } finally { clearTimeout(timer); }
}
