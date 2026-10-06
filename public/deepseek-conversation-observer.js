(() => {
  const INSTALL_KEY = "__turnmapDeepSeekObserverInstalled";
  if (window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;

  const SOURCE = "turnmap-deepseek-observer";
  const COMMAND_SOURCE = "turnmap-deepseek-observer-command";
  const HISTORY_PATH = "/api/v0/chat/history_messages";
  const MAX_BUFFERED = 6;
  const captures = new Map();
  const fullHistoryRequests = new Set();
  let captureSequence = 0;

  function historyUrl(input) {
    try {
      const raw = typeof input === "string" || input instanceof URL ? input : input?.url;
      const url = new URL(String(raw || ""), window.location.href);
      return url.pathname === HISTORY_PATH ? url : null;
    } catch {
      return null;
    }
  }

  function post(type, payload) {
    window.postMessage({ source: SOURCE, type, payload }, window.location.origin);
  }

  function publishCapture(id) {
    const capture = captures.get(id);
    if (capture) post("capture", capture);
  }

  function captureBody(body) {
    if (typeof body !== "string" || body.length === 0) return;
    const id = `${Date.now()}:${++captureSequence}`;
    captures.set(id, { id, body });
    while (captures.size > MAX_BUFFERED) captures.delete(captures.keys().next().value);
    publishCapture(id);
  }

  function responseNeedsCompleteHistory(body) {
    try {
      return body && JSON.parse(body)?.data?.biz_data?.cache_control === "MERGE";
    } catch {
      return false;
    }
  }

  function completeHistoryUrl(url) {
    const complete = new URL(url.href);
    complete.searchParams.delete("cache_version");
    complete.searchParams.delete("cache_reset_at");
    return complete;
  }

  const nativeFetch = window.fetch;

  function requestCompleteHistory(input, init, url) {
    const conversationId = url.searchParams.get("chat_session_id") || "";
    if (!conversationId || fullHistoryRequests.has(conversationId)) return;
    fullHistoryRequests.add(conversationId);
    const targetUrl = completeHistoryUrl(url);
    let targetInput = targetUrl.href;
    try {
      if (typeof Request === "function" && input instanceof Request) {
        targetInput = new Request(targetUrl.href, input);
      }
    } catch {
      targetInput = targetUrl.href;
    }
    nativeFetch.call(window, targetInput, init).then((response) => {
      if (!response || typeof response.clone !== "function") return;
      response.clone().text().then(captureBody).catch(() => {});
    }).catch(() => {
      fullHistoryRequests.delete(conversationId);
    });
  }

  window.fetch = function turnMapDeepSeekFetch(input, init) {
    const url = historyUrl(input);
    const responsePromise = nativeFetch.apply(this, arguments);
    if (url) {
      responsePromise.then((response) => {
        if (!response || typeof response.clone !== "function") return;
        response.clone().text().then((body) => {
          captureBody(body);
          if (responseNeedsCompleteHistory(body)) requestCompleteHistory(input, init, url);
        }).catch(() => {});
      }).catch(() => {});
    }
    return responsePromise;
  };

  const NativeXhr = window.XMLHttpRequest;
  const nativeOpen = NativeXhr.prototype.open;
  const nativeSend = NativeXhr.prototype.send;
  NativeXhr.prototype.open = function turnMapDeepSeekOpen(method, url, ...rest) {
    this.__turnmapDeepSeekUrl = String(url || "");
    return nativeOpen.call(this, method, url, ...rest);
  };
  NativeXhr.prototype.send = function turnMapDeepSeekSend(...args) {
    if (historyUrl(this.__turnmapDeepSeekUrl)) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text") captureBody(this.responseText);
          else if (this.responseType === "json") captureBody(JSON.stringify(this.response));
        } catch {}
      }, { once: true });
    }
    return nativeSend.apply(this, args);
  };

  function escapedKey(messageId) {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(String(messageId))
      : String(messageId).replace(/["\\]/g, "\\$&");
  }

  function keyedWrappers(messageId) {
    return Array.from(document.querySelectorAll(
      `[data-virtual-list-item-key="${escapedKey(messageId)}"]`
    ));
  }

  function findMountedMessage(messageId) {
    return keyedWrappers(messageId).find((wrapper) =>
      wrapper.matches?.(".ds-message") || wrapper.querySelector?.(".ds-message")
    ) || null;
  }

  function findVisibleOutlineItem(messageId) {
    return keyedWrappers(messageId).find((wrapper) =>
      !wrapper.matches?.(".ds-message") && !wrapper.querySelector?.(".ds-message")
    ) || null;
  }

  function clickOutlineItem(item) {
    const target = item.querySelector?.('button, [role="button"], a') || item;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    target.click();
  }

  function reactFiberFor(element) {
    if (!element) return null;
    const key = Object.keys(element).find((candidate) =>
      candidate.startsWith("__reactFiber$") || candidate.startsWith("__reactInternalInstance$")
    );
    return key ? element[key] : null;
  }

  function controllerDescriptors(messageId) {
    const descriptors = [];
    const seenControllers = new Set();
    for (const element of document.querySelectorAll(".ds-virtual-list")) {
      let fiber = reactFiberFor(element);
      let depth = 0;
      while (fiber && depth < 120) {
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const items = Array.isArray(props?.items) ? props.items : null;
          const controller = props?.componentRef?.current;
          if (!items || !controller || typeof controller.scrollTo !== "function" || seenControllers.has(controller)) {
            continue;
          }
          const mainMatch = items.some((item) =>
            item && typeof item === "object" && "messageId" in item && String(item.messageId) === messageId
          );
          const outlineMatch = items.some((item) =>
            item && typeof item === "object" && "id" in item && String(item.id) === messageId
          );
          if (!mainMatch && !outlineMatch) continue;
          seenControllers.add(controller);
          descriptors.push({ controller, kind: mainMatch ? "message" : "outline" });
        }
        fiber = fiber.return;
        depth += 1;
      }
    }
    return descriptors;
  }

  function waitFor(find, timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        const value = find();
        if (value || Date.now() - startedAt >= timeoutMs) {
          resolve(value || null);
          return;
        }
        window.setTimeout(check, 32);
      };
      check();
    });
  }

  async function activateNativeTarget(messageId) {
    if (findMountedMessage(messageId)) return true;

    const visibleOutline = findVisibleOutlineItem(messageId);
    if (visibleOutline) {
      clickOutlineItem(visibleOutline);
      return true;
    }

    const descriptors = controllerDescriptors(messageId);
    const messageController = descriptors.find((entry) => entry.kind === "message");
    if (messageController) {
      messageController.controller.scrollTo({ key: messageId, debounce: false, behavior: "instant" });
      return true;
    }

    const outlineController = descriptors.find((entry) => entry.kind === "outline");
    if (!outlineController) return false;
    outlineController.controller.scrollTo({ key: messageId, debounce: false, behavior: "instant" });
    const outlineItem = await waitFor(() => findVisibleOutlineItem(messageId), 700);
    if (!outlineItem) return false;
    clickOutlineItem(outlineItem);
    return true;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== COMMAND_SOURCE) return;
    if (data.type === "flush") {
      captures.forEach((_capture, id) => publishCapture(id));
      return;
    }
    if (data.type === "ack" && typeof data.payload?.id === "string") {
      captures.delete(data.payload.id);
      return;
    }
    if (data.type === "navigate" && typeof data.payload?.requestId === "string") {
      const messageId = String(data.payload?.messageId || "");
      void activateNativeTarget(messageId).then((accepted) => {
        post("navigate-result", {
          requestId: data.payload.requestId,
          accepted: accepted === true
        });
      }).catch(() => {
        post("navigate-result", { requestId: data.payload.requestId, accepted: false });
      });
    }
  });
})();
