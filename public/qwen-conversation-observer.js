(() => {
  const INSTALL_KEY = "__turnmapQwenObserverInstalled";
  if (window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;

  const SOURCE = "turnmap-qwen-observer";
  const COMMAND_SOURCE = "turnmap-qwen-observer-command";
  const MAX_CAPTURE_CHARS = 12 * 1024 * 1024;
  const MAX_BUFFERED = 6;
  const captures = new Map();
  let sequence = 0;

  function isConversationDetailRequest(input) {
    try {
      const path = new URL(String(input), window.location.href).pathname;
      return /\/(?:api\/(?:v\d+\/)?|)chats\/[^/]+\/?$/i.test(path);
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

  function capture(url, body) {
    if (typeof body !== "string" || body.length === 0 || body.length > MAX_CAPTURE_CHARS) return;
    const id = `${Date.now()}:${++sequence}`;
    captures.set(id, { id, url: String(url || ""), body });
    while (captures.size > MAX_BUFFERED) captures.delete(captures.keys().next().value);
    publish(id);
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = async function turnMapQwenFetch(input, init) {
      const response = await nativeFetch.call(this, input, init);
      const url = typeof input === "string" || input instanceof URL ? input : input && input.url;
      if (isConversationDetailRequest(url)) {
        void response.clone().text().then((body) => capture(url, body)).catch(() => {});
      }
      return response;
    };
  }

  const NativeXhr = window.XMLHttpRequest;
  if (typeof NativeXhr === "function") {
    const nativeOpen = NativeXhr.prototype.open;
    const nativeSend = NativeXhr.prototype.send;
    NativeXhr.prototype.open = function turnMapQwenOpen(method, url, ...rest) {
      this.__turnmapQwenUrl = String(url || "");
      return nativeOpen.call(this, method, url, ...rest);
    };
    NativeXhr.prototype.send = function turnMapQwenSend(...args) {
      const url = this.__turnmapQwenUrl;
      if (isConversationDetailRequest(url)) {
        this.addEventListener("load", () => {
          try {
            if (this.responseType === "" || this.responseType === "text") capture(url, this.responseText);
            else if (this.responseType === "json") capture(url, JSON.stringify(this.response));
          } catch {}
        }, { once: true });
      }
      return nativeSend.apply(this, args);
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== COMMAND_SOURCE) return;
    if (data.type === "flush") captures.forEach((_capture, id) => publish(id));
    if (data.type === "ack" && typeof data.payload?.id === "string") captures.delete(data.payload.id);
  });
})();
