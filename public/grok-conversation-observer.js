(() => {
  const INSTALL_KEY = "__turnmapGrokObserverInstalled";
  if (window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;

  const SOURCE = "turnmap-grok-observer";
  const COMMAND_SOURCE = "turnmap-grok-observer-command";
  const MAX_CAPTURE_CHARS = 8 * 1024 * 1024;
  const MAX_BUFFERED = 12;
  const captures = new Map();
  let sequence = 0;

  function isConversationEndpoint(input) {
    try {
      const path = new URL(String(input), window.location.href).pathname;
      return /\/rest\/app-chat\/conversations\/[^/]+\/responses\/?$/i.test(path)
        || /\/rest\/app-chat\/conversations\/new\/?$/i.test(path);
    } catch {
      return false;
    }
  }

  function post(type, payload) {
    window.postMessage({ source: SOURCE, type, payload }, window.location.origin);
  }

  function publish(id) {
    const capture = captures.get(id);
    if (capture) post("capture", capture);
  }

  function capture(url, requestBody, responseBody) {
    if (typeof responseBody !== "string" || !responseBody || responseBody.length > MAX_CAPTURE_CHARS) return;
    const id = `${Date.now()}:${++sequence}`;
    const body = JSON.stringify({
      turnmapRequestBody: typeof requestBody === "string" ? requestBody : "",
      turnmapResponseBody: responseBody
    });
    captures.set(id, { id, url: String(url || ""), body });
    while (captures.size > MAX_BUFFERED) captures.delete(captures.keys().next().value);
    publish(id);
  }

  async function requestBodyText(input, init) {
    if (typeof init?.body === "string") return init.body;
    try {
      if (input instanceof Request) return await input.clone().text();
    } catch {}
    return "";
  }

  async function captureResponseStream(url, requestBody, response) {
    const clone = response.clone();
    if (!clone.body || typeof TextDecoder !== "function") {
      try {
        capture(url, requestBody, await clone.text());
      } catch {}
      return;
    }
    const reader = clone.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        if (accumulated.length > MAX_CAPTURE_CHARS) return;
        capture(url, requestBody, accumulated);
      }
      accumulated += decoder.decode();
      capture(url, requestBody, accumulated);
    } catch {}
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function turnMapGrokFetch(input, init) {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      const requestBody = isConversationEndpoint(url) ? requestBodyText(input, init) : Promise.resolve("");
      const responsePromise = nativeFetch.call(this, input, init);
      if (isConversationEndpoint(url)) {
        responsePromise.then(async (response) => {
          void captureResponseStream(url, await requestBody, response);
        }).catch(() => {});
      }
      return responsePromise;
    };
  }

  const NativeXhr = window.XMLHttpRequest;
  if (typeof NativeXhr === "function") {
    const nativeOpen = NativeXhr.prototype.open;
    const nativeSend = NativeXhr.prototype.send;
    NativeXhr.prototype.open = function turnMapGrokOpen(method, url, ...rest) {
      this.__turnmapGrokUrl = String(url || "");
      return nativeOpen.call(this, method, url, ...rest);
    };
    NativeXhr.prototype.send = function turnMapGrokSend(body) {
      if (isConversationEndpoint(this.__turnmapGrokUrl)) {
        const requestBody = typeof body === "string" ? body : "";
        this.addEventListener("load", () => {
          try {
            if (this.responseType === "" || this.responseType === "text") {
              capture(this.__turnmapGrokUrl, requestBody, this.responseText);
            } else if (this.responseType === "json") {
              capture(this.__turnmapGrokUrl, requestBody, JSON.stringify(this.response));
            }
          } catch {}
        }, { once: true });
      }
      return nativeSend.apply(this, arguments);
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== COMMAND_SOURCE) return;
    if (data.type === "flush") {
      captures.forEach((_capture, id) => publish(id));
      return;
    }
    if (data.type === "ack" && typeof data.payload?.id === "string") captures.delete(data.payload.id);
  });
})();
