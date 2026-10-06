(() => {
  const INSTALL_KEY = "__turnmapKimiObserverInstalled";
  if (window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;

  const SOURCE = "turnmap-kimi-observer";
  const COMMAND_SOURCE = "turnmap-kimi-observer-command";
  const LIST_MESSAGES_PATH = "/apiv2/kimi.gateway.chat.v1.ChatService/ListMessages";
  const MESSAGE_ID_ATTRIBUTE = "data-turnmap-kimi-message-id";
  const MAX_BUFFERED = 64;
  const MAX_HISTORY_PAGES = 50;
  const captures = new Map();
  let captureSequence = 0;

  function post(type, payload) {
    window.postMessage({ source: SOURCE, type, payload }, window.location.origin);
  }

  function publish(id) {
    const capture = captures.get(id);
    if (capture) post("capture", capture);
  }

  function captureBody(conversationId, pageToken, body) {
    if (!conversationId || typeof body !== "string" || body.length === 0) return;
    const id = `${Date.now()}:${++captureSequence}`;
    captures.set(id, { id, conversationId, pageToken: pageToken || "", body });
    while (captures.size > MAX_BUFFERED) captures.delete(captures.keys().next().value);
    publish(id);
  }

  function listMessagesUrl(input) {
    try {
      const raw = typeof input === "string" || input instanceof URL ? input : input?.url;
      const url = new URL(String(raw || ""), window.location.href);
      return url.pathname === LIST_MESSAGES_PATH ? url : null;
    } catch {
      return null;
    }
  }

  function requestBodyText(input, init) {
    if (typeof init?.body === "string") return Promise.resolve(init.body);
    try {
      if (typeof Request === "function" && input instanceof Request) return input.clone().text();
    } catch {}
    return Promise.resolve("");
  }

  function parseRequestBody(body) {
    try {
      const parsed = JSON.parse(body);
      return {
        conversationId: String(parsed?.chat_id || parsed?.chatId || ""),
        pageToken: String(parsed?.page_token || parsed?.pageToken || ""),
        pageSize: Number(parsed?.page_size || parsed?.pageSize || 100) || 100,
        raw: parsed
      };
    } catch {
      return null;
    }
  }

  function nextPageToken(body) {
    try {
      const parsed = JSON.parse(body);
      return String(parsed?.next_page_token || parsed?.nextPageToken || "");
    } catch {
      return "";
    }
  }

  function requestForPage(url, input, init, requestTemplate, details, pageToken) {
    const body = JSON.stringify({
      ...details.raw,
      chat_id: details.conversationId,
      page_size: details.pageSize,
      page_token: pageToken
    });
    if (requestTemplate) return new Request(requestTemplate.clone(), { body });
    return new Request(url.href, { ...(init || {}), method: "POST", body });
  }

  const nativeFetch = window.fetch;

  async function fetchRemainingPages(url, input, init, requestTemplate, details, firstBody) {
    const seen = new Set([details.pageToken || ""]);
    let token = nextPageToken(firstBody);
    let pageCount = 1;
    while (token && !seen.has(token) && pageCount < MAX_HISTORY_PAGES) {
      seen.add(token);
      pageCount += 1;
      let request;
      try {
        request = requestForPage(url, input, init, requestTemplate, details, token);
      } catch {
        return;
      }
      let response;
      try {
        response = await nativeFetch.call(window, request);
      } catch {
        return;
      }
      if (!response?.ok || typeof response.clone !== "function") return;
      let body;
      try {
        body = await response.clone().text();
      } catch {
        return;
      }
      captureBody(details.conversationId, token, body);
      token = nextPageToken(body);
    }
  }

  window.fetch = function turnMapKimiFetch(input, init) {
    const url = listMessagesUrl(input);
    let requestTemplate = null;
    if (url) {
      try {
        if (typeof Request === "function" && input instanceof Request) requestTemplate = input.clone();
      } catch {}
    }
    const requestBodyPromise = url ? requestBodyText(input, init) : null;
    const responsePromise = nativeFetch.apply(this, arguments);
    if (url && requestBodyPromise) {
      responsePromise.then(async response => {
        if (!response || typeof response.clone !== "function") return;
        const details = parseRequestBody(await requestBodyPromise);
        if (!details) return;
        const body = await response.clone().text();
        captureBody(details.conversationId, details.pageToken, body);
        if (!details.pageToken) {
          void fetchRemainingPages(url, input, init, requestTemplate, details, body);
        }
      }).catch(() => {});
    }
    return responsePromise;
  };

  function unwrap(value) {
    if (value && typeof value === "object" && "value" in value) return value.value;
    return value;
  }

  function vueInstanceFor(element) {
    return element?.__vueParentComponent || null;
  }

  function segmentFromInstance(instance) {
    let current = instance;
    let depth = 0;
    while (current && depth < 12) {
      const segment = unwrap(current.props?.segment) || unwrap(current.setupState?.segment);
      if (segment && typeof segment === "object" && segment.id) return segment;
      current = current.parent;
      depth += 1;
    }
    return null;
  }

  function annotateMountedSegments() {
    for (const element of document.querySelectorAll(".segment")) {
      const segment = segmentFromInstance(vueInstanceFor(element));
      if (!segment?.id) continue;
      const messageId = String(segment.id);
      if (element.getAttribute(MESSAGE_ID_ATTRIBUTE) !== messageId) {
        element.setAttribute(MESSAGE_ID_ATTRIBUTE, messageId);
      }
    }
  }

  function escapedId(messageId) {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(String(messageId))
      : String(messageId).replace(/["\\]/g, "\\$&");
  }

  function findMountedMessage(messageId) {
    return document.querySelector(`[${MESSAGE_ID_ATTRIBUTE}="${escapedId(messageId)}"]`);
  }

  function findHistoryController() {
    for (const element of document.querySelectorAll(".segment")) {
      let current = vueInstanceFor(element);
      let depth = 0;
      while (current && depth < 80) {
        const state = current.setupState || {};
        const fetchPrevSegments = unwrap(state.fetchPrevSegments);
        const segmentMap = state.segmentMap;
        if (typeof fetchPrevSegments === "function" && segmentMap) {
          return { fetchPrevSegments, segmentMap };
        }
        current = current.parent;
        depth += 1;
      }
    }
    return null;
  }

  function controllerHasMessage(controller, messageId) {
    const map = unwrap(controller?.segmentMap);
    if (map instanceof Map) return map.has(messageId);
    return Boolean(map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, messageId));
  }

  function controllerMessageCount(controller) {
    const map = unwrap(controller?.segmentMap);
    if (map instanceof Map) return map.size;
    return map && typeof map === "object" ? Object.keys(map).length : 0;
  }

  function afterRender() {
    return new Promise(resolve => window.setTimeout(resolve, 0));
  }

  async function activateNativeTarget(messageId) {
    annotateMountedSegments();
    if (findMountedMessage(messageId)) return true;
    const controller = findHistoryController();
    if (!controller) return false;
    let unchangedPages = 0;
    for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
      if (controllerHasMessage(controller, messageId)) {
        await afterRender();
        annotateMountedSegments();
        return Boolean(findMountedMessage(messageId));
      }
      const before = controllerMessageCount(controller);
      try {
        await controller.fetchPrevSegments();
      } catch {
        return false;
      }
      await afterRender();
      annotateMountedSegments();
      if (findMountedMessage(messageId)) return true;
      const after = controllerMessageCount(controller);
      unchangedPages = after <= before ? unchangedPages + 1 : 0;
      if (unchangedPages >= 2) return false;
    }
    return false;
  }

  const mountedObserver = new MutationObserver(annotateMountedSegments);
  const startAnnotation = () => {
    if (!document.body) return;
    annotateMountedSegments();
    mountedObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) startAnnotation();
  else document.addEventListener("DOMContentLoaded", startAnnotation, { once: true });

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== COMMAND_SOURCE) return;
    if (data.type === "flush") {
      captures.forEach((_capture, id) => publish(id));
      annotateMountedSegments();
      return;
    }
    if (data.type === "ack" && typeof data.payload?.id === "string") {
      captures.delete(data.payload.id);
      return;
    }
    if (data.type === "navigate" && typeof data.payload?.requestId === "string") {
      const messageId = String(data.payload?.messageId || "");
      void activateNativeTarget(messageId).then(accepted => {
        post("navigate-result", { requestId: data.payload.requestId, accepted: accepted === true });
      }).catch(() => {
        post("navigate-result", { requestId: data.payload.requestId, accepted: false });
      });
    }
  });
})();
