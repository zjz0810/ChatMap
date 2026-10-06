(function installTurnMapGeminiObserver() {
  if (window.__turnMapGeminiObserverInstalled) return;
  window.__turnMapGeminiObserverInstalled = true;

  var SOURCE = "turnmap-gemini-observer";
  var COMMAND_SOURCE = "turnmap-gemini-observer-command";
  var MAX_CAPTURE_CHARS = 8 * 1024 * 1024;
  var MAX_BUFFERED_CAPTURES = 2;
  var sequence = 0;
  var buffer = [];

  function isConversationHistoryRequest(url) {
    var value = String(url || "");
    return value.indexOf("batchexecute") >= 0 && value.indexOf("hNvQHb") >= 0;
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
      var url = typeof input === "string" ? input : input && (input.url || input.href);
      var promise = originalFetch.apply(this, arguments);
      if (isConversationHistoryRequest(url)) {
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
      var requestUrl = "";
      var originalOpen = request.open;
      var originalSend = request.send;

      request.open = function (_method, url) {
        requestUrl = String(url || "");
        return originalOpen.apply(request, arguments);
      };
      request.send = function () {
        if (isConversationHistoryRequest(requestUrl)) {
          request.addEventListener(
            "load",
            function () {
              try {
                if (request.responseType && request.responseType !== "text") return;
                capture(requestUrl, request.responseText);
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
