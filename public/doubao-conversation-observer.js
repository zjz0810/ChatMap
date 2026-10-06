(() => {
  const INSTALL_KEY = "__turnmapDoubaoObserverInstalled";
  if (window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;

  const SOURCE = "turnmap-doubao-observer";
  const COMMAND_SOURCE = "turnmap-doubao-observer-command";
  const MAX_BUFFERED = 12;
  const ENDPOINTS = [
    "/alice/message/list",
    "/alice/message/index_list",
    "/im/chain/single"
  ];
  const captures = new Map();
  let captureSequence = 0;

  function isConversationEndpoint(input) {
    try {
      const path = new URL(String(input), window.location.href).pathname;
      return ENDPOINTS.some((endpoint) => path === endpoint || path === `${endpoint}/v2`);
    } catch {
      return false;
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

  const nativeFetch = window.fetch;
  window.fetch = async function turnMapDoubaoFetch(input, init) {
    const response = await nativeFetch.call(this, input, init);
    const url = typeof input === "string" || input instanceof URL ? input : input.url;
    if (isConversationEndpoint(url)) {
      void response.clone().text().then(captureBody).catch(() => {});
    }
    return response;
  };

  const NativeXhr = window.XMLHttpRequest;
  const nativeOpen = NativeXhr.prototype.open;
  const nativeSend = NativeXhr.prototype.send;
  NativeXhr.prototype.open = function turnMapDoubaoOpen(method, url, ...rest) {
    this.__turnmapDoubaoUrl = String(url);
    return nativeOpen.call(this, method, url, ...rest);
  };
  NativeXhr.prototype.send = function turnMapDoubaoSend(...args) {
    if (isConversationEndpoint(this.__turnmapDoubaoUrl)) {
      this.addEventListener("load", () => {
        if (this.responseType === "" || this.responseType === "text") captureBody(this.responseText);
        else if (this.responseType === "json") captureBody(JSON.stringify(this.response));
      }, { once: true });
    }
    return nativeSend.apply(this, args);
  };

  function reactFiberFor(element) {
    if (!element) return null;
    const key = Object.keys(element).find((candidate) =>
      candidate.startsWith("__reactFiber$") || candidate.startsWith("__reactInternalInstance$")
    );
    return key ? element[key] : null;
  }

  function candidateFibers() {
    const elements = document.querySelectorAll('[data-name="scroll_holder"], [class*="v_list_scroller"]');
    const fibers = [];
    for (const element of elements) {
      let fiber = reactFiberFor(element);
      let depth = 0;
      while (fiber && depth < 100) {
        fibers.push(fiber);
        fiber = fiber.return;
        depth += 1;
      }
    }
    return fibers;
  }

  function navigateVirtualTarget(payload) {
    const virtualKeys = Array.isArray(payload?.virtualKeys) ? payload.virtualKeys.filter(Boolean) : [];
    if (typeof payload?.messageId === "string" && payload.messageId) {
      virtualKeys.push(`block_${payload.messageId}`, payload.messageId);
    }
    if (virtualKeys.length === 0) return false;

    for (const fiber of candidateFibers()) {
      const instance = fiber?.stateNode;
      const positionMap = instance?.state?.positionMap ?? instance?.positionMap;
      if (typeof instance?.scrollToRow === "function" && typeof positionMap?.getIndexPathByKey === "function") {
        for (const key of virtualKeys) {
          const indexPath = positionMap.getIndexPathByKey(key);
          if (!indexPath) continue;
          instance.scrollToRow({ indexPath: { ...indexPath, key }, key, offset: 0, align: "start", smooth: false });
          return true;
        }
      }

      const props = fiber?.memoizedProps;
      const scroller = props?.scrollerRef?.current ?? props?.virtualListRef?.current;
      if (typeof scroller?.scrollIntoItemsById !== "function" || !Array.isArray(props?.dataList)) continue;
      const knownIds = new Set(props.dataList.map((item) => item?.id ?? item?.key).filter(Boolean));
      const key = virtualKeys.find((candidate) => knownIds.has(candidate));
      if (!key) continue;
      scroller.scrollIntoItemsById(key);
      return true;
    }
    return false;
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
      post("navigate-result", {
        requestId: data.payload.requestId,
        accepted: navigateVirtualTarget(data.payload)
      });
    }
  });
})();
