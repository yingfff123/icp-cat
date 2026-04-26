const captureToggle = document.getElementById("captureToggle");
const statusText = document.getElementById("statusText");
const totalCountEl = document.getElementById("totalCount");
const capturedCountEl = document.getElementById("capturedCount");
const updatedAt = document.getElementById("updatedAt");
const domainList = document.getElementById("domainList");
const domainCount = document.getElementById("domainCount");
const ipList = document.getElementById("ipList");
const ipCount = document.getElementById("ipCount");
const errorText = document.getElementById("errorText");
const copyButton = document.getElementById("copyButton");
const clearButton = document.getElementById("clearButton");

let activeTab = "domains";

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".result-list").forEach((list) => {
      list.classList.toggle("hidden", list.dataset.tab !== activeTab);
    });
  });
});

captureToggle.addEventListener("change", async () => {
  setError("");
  const response = await chrome.runtime.sendMessage({
    type: "toggle-capture",
    enabled: captureToggle.checked
  });
  if (!response?.ok) {
    captureToggle.checked = !captureToggle.checked;
    setError("操作失败");
    return;
  }
  await render();
});

copyButton.addEventListener("click", async () => {
  const keyMap = { domains: "domains", ips: "ips" };
  const key = keyMap[activeTab];
  const data = await chrome.storage.local.get([key]);
  const items = data[key] || [];
  if (!items.length) {
    setError("当前列表没有可复制的数据");
    return;
  }
  await navigator.clipboard.writeText(items.join("\n"));
  setError(`已复制 ${items.length} 条到剪贴板`);
});

clearButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-data" });
  await render();
});

chrome.storage.onChanged.addListener(() => {
  render().catch((e) => setError(e.message));
});

render().catch((e) => setError(e.message));

async function render() {
  const resp = await chrome.runtime.sendMessage({ type: "get-state" });
  const state = resp?.state || {};
  const domains = state.domains || [];
  const ips = state.ips || [];

  captureToggle.checked = Boolean(state.captureEnabled);
  statusText.textContent = state.captureEnabled ? "监听中" : "未开启";
  statusText.className = `status ${state.captureEnabled ? "active" : "idle"}`;
  updatedAt.textContent = state.lastUpdated ? formatDate(state.lastUpdated) : "-";

  totalCountEl.textContent = state.totalCount > 0 ? String(state.totalCount) : "-";
  capturedCountEl.textContent = `${domains.length} 域名 / ${ips.length} IP`;

  domainCount.textContent = String(domains.length);
  ipCount.textContent = String(ips.length);

  renderList(domainList, domains, "开启监听后在备案页面发起查询");
  renderList(ipList, ips, "暂无 IP 数据");

  setError(state.errorMessage || "");
}

function renderList(container, items, emptyText) {
  container.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    container.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    container.appendChild(li);
  }
}

function formatDate(isoText) {
  return new Date(isoText).toLocaleString("zh-CN", { hour12: false });
}

function setError(message) {
  errorText.textContent = message;
}
