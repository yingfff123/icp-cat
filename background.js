chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    domains: [],
    ips: [],
    totalCount: 0,
    lastUpdated: null,
    captureEnabled: false,
    errorMessage: ""
  });
});

const DEBUG_PREFIX = "[ICP Extractor][background]";
let payloadQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "fetch-error") {
    console.debug(DEBUG_PREFIX, "收到错误消息", {
      message: message.message,
      tabId: sender.tab?.id,
      frameId: sender.frameId,
      url: sender.url
    });
    chrome.storage.local.set({ errorMessage: message.message || "自动翻页出错" });
    return false;
  }

  if (message?.type === "intercepted-response") {
    console.debug(DEBUG_PREFIX, "收到响应消息", {
      tabId: sender.tab?.id,
      frameId: sender.frameId,
      senderUrl: sender.url,
      pageHref: message.meta?.href,
      isTop: message.meta?.isTop,
      total: message.payload?.params?.total,
      listSize: Array.isArray(message.payload?.params?.list) ? message.payload.params.list.length : 0
    });
    enqueuePayload(message.payload).catch((err) => {
      chrome.storage.local.set({ errorMessage: err.message });
    });
    return false;
  }

  if (message?.type === "toggle-capture") {
    chrome.storage.local.set(
      {
        captureEnabled: message.enabled,
        errorMessage: "",
        ...(message.enabled
          ? { domains: [], ips: [], totalCount: 0, lastUpdated: null }
          : {})
      },
      () => sendResponse({ ok: true })
    );
    return true;
  }

  if (message?.type === "clear-data") {
    chrome.storage.local.set(
      { domains: [], ips: [], totalCount: 0, lastUpdated: null, errorMessage: "" },
      () => sendResponse({ ok: true })
    );
    return true;
  }

  if (message?.type === "get-state") {
    chrome.storage.local.get(
      ["domains", "ips", "totalCount", "lastUpdated", "captureEnabled", "errorMessage"],
      (result) => sendResponse({ ok: true, state: result })
    );
    return true;
  }

  return false;
});

async function enqueuePayload(payload) {
  payloadQueue = payloadQueue
    .catch((err) => {
      console.debug(DEBUG_PREFIX, "上一个 payload 处理失败，继续处理队列", { message: err?.message || String(err) });
    })
    .then(() => handlePayload(payload));
  return payloadQueue;
}

async function handlePayload(payload) {
  if (!payload) return;

  const captureEnabled = await new Promise((resolve) => {
    chrome.storage.local.get(["captureEnabled"], (r) => resolve(Boolean(r.captureEnabled)));
  });
  if (!captureEnabled) {
    console.debug(DEBUG_PREFIX, "监听未开启，忽略响应");
    return;
  }

  const { domains, ips, totalCount } = extractAssets(payload);
  console.debug(DEBUG_PREFIX, "提取完成", {
    domains: domains.length,
    ips: ips.length,
    totalCount
  });

  const prev = await chrome.storage.local.get(["domains", "ips", "totalCount"]);
  const mergedDomains = dedupeArray([...(prev.domains || []), ...domains]);
  const mergedIps = dedupeArray([...(prev.ips || []), ...ips]);
  const mergedTotalCount = Math.max(Number(prev.totalCount) || 0, totalCount || 0, mergedDomains.length + mergedIps.length);

  console.debug(DEBUG_PREFIX, "合并后结果", {
    beforeDomains: (prev.domains || []).length,
    beforeIps: (prev.ips || []).length,
    addedDomains: domains.length,
    addedIps: ips.length,
    domains: mergedDomains.length,
    ips: mergedIps.length,
    totalCount: mergedTotalCount
  });

  await chrome.storage.local.set({
    domains: mergedDomains,
    ips: mergedIps,
    totalCount: mergedTotalCount,
    lastUpdated: new Date().toISOString(),
    errorMessage:
      mergedDomains.length || mergedIps.length
        ? ""
        : "未在响应中识别到域名或IP"
  });
}

function extractAssets(payload) {
  const domains = [];
  const ips = [];
  let totalCount = 0;

  const params = payload?.params;
  if (!params) return { domains, ips, totalCount };

  if (typeof params.total === "number") totalCount = params.total;
  else if (typeof params.total === "string") totalCount = parseInt(params.total, 10) || 0;

  collectKnownAssetFields(params, domains, ips);
  collectAssetsDeep(params, domains, ips);

  return {
    domains: dedupeArray(domains),
    ips: dedupeArray(ips),
    totalCount
  };
}

function collectKnownAssetFields(value, domains, ips, visited = new WeakSet()) {
  if (value == null || typeof value !== "object") return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectKnownAssetFields(item, domains, ips, visited);
    }
    return;
  }

  const domainFieldNames = new Set([
    "domain",
    "domainName",
    "domainNames",
    "domainUrl",
    "domains",
    "homeUrl",
    "host",
    "mainDomain",
    "mainLicence",
    "serviceLicence",
    "siteDomain",
    "siteName",
    "unitUrl",
    "url",
    "webDomain",
    "webUrl",
    "website",
    "websiteDomain",
    "websiteUrl"
  ]);
  const ipFieldNames = new Set(["ip", "ips", "ipAddress", "ipAddresses", "serverIp", "serverIps"]);

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
    const isDomainField = [...domainFieldNames].some((name) => normalizedKey === name.toLowerCase());
    const isIpField = [...ipFieldNames].some((name) => normalizedKey === name.toLowerCase());

    if (typeof nestedValue === "string" || typeof nestedValue === "number") {
      const text = String(nestedValue);
      if (isDomainField) collectDomainCandidates(text, domains);
      if (isIpField) collectIpCandidates(text, ips);
    }

    collectKnownAssetFields(nestedValue, domains, ips, visited);
  }
}

function collectDomainCandidates(text, domains) {
  splitCandidates(text).forEach((part) => {
    const host = extractHost(part);
    if (host && looksLikeDomain(host)) domains.push(host);
  });
}

function collectIpCandidates(text, ips) {
  splitCandidates(text).forEach((part) => {
    const host = extractHost(part);
    if (host && isIpLike(host)) ips.push(host);
  });
}

function splitCandidates(text) {
  return String(text)
    .split(/[\s,，;；、|｜]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectAssetsDeep(value, domains, ips, visited = new WeakSet()) {
  if (value == null) return;

  if (typeof value === "string") {
    collectFromString(value, domains, ips);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAssetsDeep(item, domains, ips, visited);
    }
    return;
  }

  if (typeof value !== "object") return;
  if (visited.has(value)) return;
  visited.add(value);

  for (const nestedValue of Object.values(value)) {
    collectAssetsDeep(nestedValue, domains, ips, visited);
  }
}

function collectFromString(input, domains, ips) {
  const text = input.trim();
  if (!text) return;

  const normalizedHost = extractHost(text);
  if (normalizedHost) {
    if (isIpLike(normalizedHost)) {
      ips.push(normalizedHost);
    } else if (looksLikeDomain(normalizedHost)) {
      domains.push(normalizedHost);
    }
  }

  const domainMatches = text.match(/(?:^|[^a-zA-Z0-9-])((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(?=$|[^a-zA-Z0-9-])/g) || [];
  for (const match of domainMatches) {
    const candidate = match.replace(/^[^a-zA-Z0-9]+/, "").toLowerCase();
    if (looksLikeDomain(candidate)) {
      domains.push(candidate);
    }
  }

  const ipMatches = text.match(/(?:^|[^\d])((?:\d{1,3}\.){3}\d{1,3})(?=$|[^\d])/g) || [];
  for (const match of ipMatches) {
    const candidate = match.replace(/^[^\d]+/, "");
    if (isIpLike(candidate)) {
      ips.push(candidate);
    }
  }
}

function extractHost(str) {
  const normalized = str.trim();
  if (!normalized) return "";

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(normalized)
    ? normalized
    : `http://${normalized}`;

  try {
    const url = new URL(withProtocol);
    return normalizeHost(url.hostname);
  } catch {
    return normalizeHost(normalized);
  }
}

function looksLikeDomain(str) {
  return /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(normalizeHost(str));
}

function normalizeHost(str) {
  return str
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^wss?:\/\//i, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/^[.*]+/, "")
    .replace(/\.+$/, "")
    .toLowerCase();
}

function isIpLike(str) {
  const normalized = normalizeHost(str);
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(normalized)) return false;
  return normalized.split(".").every((part) => {
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function dedupeArray(arr) {
  return [...new Set(arr)];
}

