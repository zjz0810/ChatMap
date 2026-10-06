(function installTurnMapGlmObserver() {
  if (window.__turnMapGlmObserverInstalled) return;
  window.__turnMapGlmObserverInstalled = true;

  const SOURCE = "turnmap-glm-observer";
  const COMMAND_SOURCE = "turnmap-glm-observer-command";
  const MAX_CAPTURE_CHARS = 8 * 1024 * 1024;
  const MAX_BUFFERED_CAPTURES = 3;
  let sequence = 0;
  let buffer = [];

  function isZaiConversationRequest(url) {
    try {
      const parsed = new URL(String(url || ""), window.location.origin);
      if (parsed.hostname !== "chat.z.ai" && parsed.hostname !== "z.ai") return false;
      return /^\/api\/v1\/chats\/(?:new|[^/?#]+)\/?$/i.test(parsed.pathname);
    } catch (_error) {
      return false;
    }
  }

  function publish(item) {
    try {
      window.postMessage(
        {
          source: SOURCE,
          type: "capture",
          payload: { id: item.id, url: item.url, body: item.body, requestBody: item.requestBody }
        },
        window.location.origin
      );
    } catch (_error) {}
  }

  function capture(url, body, requestBody) {
    if (typeof body !== "string" || body.length === 0 || body.length > MAX_CAPTURE_CHARS) return;
    if (typeof requestBody !== "string" || requestBody.length > MAX_CAPTURE_CHARS) requestBody = "";
    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(String(url || ""), window.location.origin).href;
    } catch (_error) {
      return;
    }
    const item = {
      id: `${Date.now()}:${++sequence}`,
      url: absoluteUrl,
      body,
      requestBody
    };
    buffer.push(item);
    while (buffer.length > MAX_BUFFERED_CAPTURES) buffer.shift();
    publish(item);
  }

  function handleCommand(event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== COMMAND_SOURCE) return;
    if (data.type === "flush") {
      buffer.forEach(publish);
      return;
    }
    if (data.type === "ack") {
      const id = data.payload && data.payload.id;
      buffer = buffer.filter((item) => item.id !== id);
    }
  }

  window.addEventListener("message", handleCommand);

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function () {
      const input = arguments[0];
      const init = arguments[1];
      const url = typeof input === "string" ? input : input && (input.url || input.href);
      const requestBody = init && typeof init.body === "string" ? init.body : "";
      const promise = originalFetch.apply(this, arguments);
      if (isZaiConversationRequest(url)) {
        promise.then(
          function (response) {
            if (!response || typeof response.clone !== "function") return;
            try {
              response.clone().text().then(
                function (body) {
                  capture(url, body, requestBody);
                },
                function () {}
              );
            } catch (_error) {}
          },
          function () {}
        );
      }
      return promise;
    };
  }

  if (typeof window.XMLHttpRequest === "function") {
    const OriginalXMLHttpRequest = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
      const request = new OriginalXMLHttpRequest();
      let requestUrl = "";
      const originalOpen = request.open;
      const originalSend = request.send;

      request.open = function (_method, url) {
        requestUrl = String(url || "");
        return originalOpen.apply(request, arguments);
      };
      request.send = function (body) {
        const requestBody = typeof body === "string" ? body : "";
        if (isZaiConversationRequest(requestUrl)) {
          request.addEventListener(
            "load",
            function () {
              try {
                if (request.responseType && request.responseType !== "text") return;
                capture(requestUrl, request.responseText, requestBody);
              } catch (_error) {}
            },
            { once: true }
          );
        }
        return originalSend.apply(request, arguments);
      };
      return request;
    };
    window.XMLHttpRequest.prototype = OriginalXMLHttpRequest.prototype;
    Object.setPrototypeOf(window.XMLHttpRequest, OriginalXMLHttpRequest);
  }
})();
