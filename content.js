(function () {
  const DEBUG_PREFIX = "[ICP Extractor][content]";
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.onload = function () {
    console.debug(DEBUG_PREFIX, "注入脚本已加载", { href: location.href, isTop: window === window.top });
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data?.__icpExtract) return;

    console.debug(DEBUG_PREFIX, "收到页面消息", {
      href: location.href,
      isTop: window === window.top,
      hasPayload: Boolean(event.data.payload),
      hasError: Boolean(event.data.error)
    });

    if (event.data.error) {
      chrome.runtime.sendMessage({
        type: "fetch-error",
        message: event.data.error
      });
      return;
    }

    if (event.data.payload) {
      chrome.runtime.sendMessage({
        type: "intercepted-response",
        payload: event.data.payload,
        meta: {
          href: location.href,
          isTop: window === window.top
        }
      });
    }
  });
})();
