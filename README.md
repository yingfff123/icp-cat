# ICP 备案资产提取器

一个基于 Chrome Manifest V3 的浏览器扩展，用于在工信部备案查询页面自动拦截接口响应，并提取其中的域名与 IP 地址。

当前实现通过页面脚本注入的方式拦截 `fetch` / `XMLHttpRequest` 请求，不依赖 `chrome.debugger`。

## 功能特性

- 监听工信部备案查询页面的接口响应
- 自动提取域名与 IPv4 地址
- 支持直接字段提取，也支持从嵌套对象和普通字符串中递归识别
- 自动去重并累计多次查询结果
- 支持复制当前标签页结果
- 支持一键清空结果
- 支持多 frame 注入，兼容请求发生在 iframe 中的场景
- 提供最小调试日志，便于排查“无法提取”的问题

## 适用页面与目标接口

页面：

- `https://beian.miit.gov.cn/`

当前重点监听的接口：

```text
POST /icpproject_query/api/icpAbbreviateInfo/queryByCondition
Host: hlwicpfwc.miit.gov.cn
```

以及详情接口：

```text
POST /icpproject_query/api/icpAbbreviateInfo/queryDetailByAppAndMiniId
Host: hlwicpfwc.miit.gov.cn
```

## 工作原理

扩展由 4 个主要部分组成：

- `manifest.json`
  - 定义扩展权限、注入规则和弹窗入口
- `content.js`
  - 注入页面脚本 `injected.js`
  - 接收页面通过 `window.postMessage` 发出的数据
  - 将响应数据转发到后台
- `injected.js`
  - 运行在页面上下文中
  - 重写 `window.fetch` 与 `XMLHttpRequest`，拦截目标接口响应
- `background.js`
  - 接收响应数据
  - 提取域名/IP
  - 去重后写入 `chrome.storage.local`

## 安装方式

1. 打开 Chrome 扩展管理页面：`chrome://extensions/`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前目录 `Domain-buff`
5. 加载完成后，固定该扩展到工具栏便于使用

## 使用方法

1. 打开 `https://beian.miit.gov.cn/`
2. 点击扩展图标打开弹窗
3. 打开“监听”开关
4. 在备案页面执行查询
5. 查看弹窗中的提取结果
6. 如有多次查询或分页结果，扩展会自动累计并去重
7. 可使用“复制”按钮导出当前标签页内容，或使用“清空”按钮重置结果

## 当前提取规则

扩展会优先从接口返回内容中识别：

- 形如 `example.com` 的域名
- 形如 `1.2.3.4` 的 IPv4 地址
- URL 中携带的主机名
- 带端口的主机，如 `example.com:443` 或 `1.2.3.4:8080`

同时会对 `payload.params` 进行递归扫描，因此即使字段名变化，也不再局限于固定字段如：

- `domain`
- `host`
- `website`
- `url`
- `serviceUrl`

## 调试方法

如果出现“一个域名或 IP 都提取不到”，优先检查调试日志。

### 页面控制台日志

在备案页面 DevTools Console 中，可看到类似日志：

```text
[ICP Extractor][content] 注入脚本已加载
[ICP Extractor][injected] 注入成功
[ICP Extractor][injected] 捕获 fetch 列表请求
[ICP Extractor][injected] 列表响应已解析
[ICP Extractor][content] 收到页面消息
```

这说明：

- 内容脚本已注入
- 页面脚本已注入
- 目标请求已被拦截
- 响应已成功传回内容脚本

### 后台日志

在扩展的 Service Worker 控制台中，可看到类似日志：

```text
[ICP Extractor][background] 收到响应消息
[ICP Extractor][background] 提取完成
[ICP Extractor][background] 合并后结果
```

这说明：

- 后台已收到响应
- 已完成提取
- 已成功写入存储

## 排查思路

### 1. 页面有请求，但扩展没抓到

通常是以下原因之一：

- 请求发生在 iframe 中
- 页面脚本未成功注入
- 页面改用了不同的请求上下文

当前版本已启用多 frame 注入，可优先观察页面控制台是否出现注入成功日志。

### 2. 抓到了响应，但结果为空

可能原因：

- 响应结构变化
- 数据被包在更深层对象中
- 值不是标准 host，而是混合文本

当前版本已使用递归扫描与正则识别，兼容性较旧版本更强。

### 3. 开启监听前已经发起了查询

扩展只会处理监听开启之后捕获到的响应。

如果先查询、后开启监听，之前的请求结果不会自动补抓。

## 项目文件说明

- `manifest.json`：扩展清单
- `background.js`：后台状态管理与提取逻辑
- `content.js`：内容脚本，负责消息桥接
- `injected.js`：页面上下文拦截脚本
- `popup.html`：弹窗结构
- `popup.css`：弹窗样式
- `popup.js`：弹窗交互逻辑

## 已知说明

- 当前主要针对工信部备案查询相关接口
- 提取结果依赖页面真实返回数据
- 如果目标站点更换接口路径、请求方式或页面结构，可能需要同步调整拦截逻辑

## 建议使用流程

1. 重载扩展
2. 刷新备案页面
3. 开启监听
4. 再执行查询
5. 若结果异常，先查看页面控制台和扩展后台日志

## 后续可扩展方向

- 在弹窗中直接显示最近一次调试状态
- 显示最近一次拦截到的接口摘要
- 导出全部结果为 TXT / CSV
- 针对更多备案接口增加适配
