(function () {
  const DEBUG_PREFIX = "[ICP Extractor][injected]";
  const LIST_URL_PART = "/icpproject_query/api/icpAbbreviateInfo/queryByCondition";
  const DETAIL_URL_PART = "/icpproject_query/api/icpAbbreviateInfo/queryDetailByAppAndMiniId";
  const DETAIL_URL = "https://hlwicpfwc.miit.gov.cn/icpproject_query/api/icpAbbreviateInfo/queryDetailByAppAndMiniId";
  const originalFetch = window.fetch;
  const fetchedDetailKeys = new Set();

  console.debug(DEBUG_PREFIX, "注入成功", { href: location.href, isTop: window === window.top });

  window.fetch = async function (...args) {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === "string" ? input : input?.url || "";

    const response = await originalFetch.apply(this, args);

    if (url.includes(LIST_URL_PART)) {
      console.debug(DEBUG_PREFIX, "捕获 fetch 列表请求", { url, status: response.status });
      handleListResponse(response, init).catch((err) => {
        postError(`列表响应处理失败: ${err?.message || err}`);
      });
      return response;
    }

    if (url.includes(DETAIL_URL_PART)) {
      console.debug(DEBUG_PREFIX, "捕获 fetch 详情请求", { url, status: response.status });
      handleDetailResponse(response).catch((err) => {
        postError(`详情响应处理失败: ${err?.message || err}`);
      });
      return response;
    }

    return response;
  };

  async function handleListResponse(response, init) {
    const data = await response.clone().json();
    console.debug(DEBUG_PREFIX, "列表响应已解析", {
      total: data?.params?.total,
      listSize: Array.isArray(data?.params?.list) ? data.params.list.length : 0
    });
    postPage(data);

    const list = data?.params?.list;
    if (!Array.isArray(list) || !list.length) return;

    const detailTargets = list
      .filter((item) => item && item.dataId && (item.serviceType === 6 || item.serviceType === 7))
      .map((item) => ({ dataId: item.dataId, serviceType: item.serviceType }));

    if (!detailTargets.length) return;

    const headers = headersToObject(init.headers);
    for (const target of detailTargets) {
      const key = `${target.serviceType}:${target.dataId}`;
      if (fetchedDetailKeys.has(key)) continue;
      fetchedDetailKeys.add(key);

      try {
        const detailResp = await originalFetch(DETAIL_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(target),
          credentials: init.credentials,
          mode: init.mode,
          cache: init.cache,
          redirect: init.redirect
        });

        if (!detailResp.ok) {
          postError(`详情请求失败: ${target.dataId}, HTTP ${detailResp.status}`);
          continue;
        }

        const detailData = await detailResp.json();
        console.debug(DEBUG_PREFIX, "详情响应已解析", {
          dataId: target.dataId,
          serviceType: target.serviceType
        });
        postPage(detailData);
      } catch (err) {
        postError(`详情请求出错: ${target.dataId}, ${err?.message || err}`);
      }
    }
  }

  async function handleDetailResponse(response) {
    const data = await response.clone().json();
    console.debug(DEBUG_PREFIX, "直接捕获详情响应", {
      hasParams: Boolean(data?.params)
    });
    postPage(data);
  }

  function headersToObject(headers) {
    const obj = {};
    if (!headers) return obj;
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        obj[key] = value;
      });
    } else if (typeof headers === "object") {
      Object.assign(obj, headers);
    }
    return obj;
  }

  function postPage(payload) {
    console.debug(DEBUG_PREFIX, "向内容脚本发送 payload", {
      hasParams: Boolean(payload?.params),
      total: payload?.params?.total
    });
    window.postMessage({ __icpExtract: true, payload }, "*");
  }

  function postError(message) {
    console.debug(DEBUG_PREFIX, "向内容脚本发送 error", { message });
    window.postMessage({ __icpExtract: true, payload: null, error: message }, "*");
  }

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__interceptUrl = url || "";
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (
      this.__interceptUrl &&
      (this.__interceptUrl.includes(LIST_URL_PART) || this.__interceptUrl.includes(DETAIL_URL_PART))
    ) {
      console.debug(DEBUG_PREFIX, "捕获 XHR 请求", { url: this.__interceptUrl });
      this.addEventListener("load", function () {
        try {
          const data = JSON.parse(this.responseText);
          console.debug(DEBUG_PREFIX, "XHR 响应已解析", {
            url: this.__interceptUrl,
            total: data?.params?.total,
            listSize: Array.isArray(data?.params?.list) ? data.params.list.length : 0
          });
          postPage(data);
        } catch (err) {
          postError(`XHR响应解析失败: ${err?.message || err}`);
        }
      });
    }
    return originalXhrSend.apply(this, args);
  };
})();
