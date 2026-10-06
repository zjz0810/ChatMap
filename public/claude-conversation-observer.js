(function installTurnMapClaudeObserver() {
  if (window.__turnMapClaudeObserverInstalled) return;
  window.__turnMapClaudeObserverInstalled = true;

  var SOURCE = "turnmap-claude-observer";
  var COMMAND_SOURCE = "turnmap-claude-observer-command";
  var MAX_CAPTURE_CHARS = 16 * 1024 * 1024;
  var MAX_BUFFERED_CAPTURES = 2;
  var sequence = 0;
  var buffer = [];

  function isConversationDetailRequest(method, url) {
    try {
      var parsed = new URL(String(url || ""), window.location.origin);
      return method === "GET" && /^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/?$/.test(parsed.pathname);
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
          payload: { id: item.id, url: item.url, body: item.body }
        },
        window.location.origin
      );
    } catch (_error) {}
  }

  function capture(url, body) {
    if (typeof body !== "string" || body.length === 0 || body.length > MAX_CAPTURE_CHARS) return;
    var item = {
      id: String(Date.now()) + ":" + String(++sequence),
      url: String(url || ""),
      body: body
    };
    buffer.push(item);
    while (buffer.length > MAX_BUFFERED_CAPTURES) buffer.shift();
    publish(item);
  }

  function acknowledge(id) {
    buffer = buffer.filter(function (item) {
      return item.id !== id;
    });
  }

  function handleCommand(event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || data.source !== COMMAND_SOURCE) return;
    if (data.type === "flush") {
      buffer.forEach(publish);
      return;
    }
    if (data.type === "ack") acknowledge(data.payload && data.payload.id);
  }

  window.addEventListener("message", handleCommand);

  if (typeof window.fetch === "function") {
    var originalFetch = window.fetch;
    window.fetch = function () {
      var input = arguments[0];
      var init = arguments[1];
      var url = typeof input === "string" ? input : input && (input.url || input.href);
      var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      var promise = originalFetch.apply(this, arguments);
      if (isConversationDetailRequest(method, url)) {
        promise.then(
          function (response) {
            if (!response || typeof response.clone !== "function") return;
            try {
              response.clone().text().then(
                function (body) {
                  capture(url, body);
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
    var OriginalXMLHttpRequest = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
      var request = new OriginalXMLHttpRequest();
      var requestMethod = "GET";
      var requestUrl = "";
      var originalOpen = request.open;
      var originalSend = request.send;

      request.open = function (method, url) {
        requestMethod = String(method || "GET").toUpperCase();
        requestUrl = String(url || "");
        return originalOpen.apply(request, arguments);
      };
      request.send = function () {
        if (isConversationDetailRequest(requestMethod, requestUrl)) {
          request.addEventListener(
            "load",
            function () {
              try {
                if (request.responseType && request.responseType !== "text" && request.responseType !== "json") return;
                var body = request.responseType === "json" ? JSON.stringify(request.response) : request.responseText;
                capture(requestUrl, body);
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
