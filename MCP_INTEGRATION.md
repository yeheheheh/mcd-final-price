# MCP 接入说明

本文记录「麦麦到手价」如何接入麦当劳中国 MCP、调用了哪些工具、真实返回结构是什么，以及哪些边界是刻意保留的。

## 1. 连接信息

| 项目 | 值 |
|---|---|
| 接入地址 | `https://mcp.mcd.cn` |
| 传输协议 | Streamable HTTP |
| 认证方式 | `Authorization: Bearer <MCD_MCP_TOKEN>` |
| Token 获取 | [open.mcd.cn/mcp](https://open.mcd.cn/mcp) |
| 官方频率限制 | 600 次/分钟 |
| 官方工具数 | 35 个（2026-10-23 探测） |

客户端配置示例见 [mcp-config.example.json](mcp-config.example.json)。示例只使用环境变量占位符，不包含真实 Token。

## 2. 只读边界

本项目只允许以下 10 个工具：

```text
now-time-info
query-nearby-stores
delivery-query-addresses
delivery-query-stores
query-meals
query-meal-detail
query-store-coupons
query-my-coupons
available-coupons
calculate-price
```

代码层在调用前强制校验白名单（`src/mcp/client.ts`）。以下工具一律拒绝：

- `create-order`、`cancel-order`、`party-order-create`
- `auto-bind-coupons`
- `mall-create-order`、`draw-lottery`
- 其他任何写操作

`calculate-price` 是**预览算价**，不会创建订单；本项目不调用下单接口，不接触支付。

## 3. 调用顺序

### 到店自取

```text
query-nearby-stores { searchType:2, beType:1, city, keyword }
  → query-meals { storeCode, orderType:1, beType:1 }
  → query-store-coupons { storeCode, orderType:1, beType:1 }
  → calculate-price { storeCode, orderType:1, beType:1, items, needTableware:false }
```

到店自取不传 `beCode`。

### 麦乐送（可选）

```text
delivery-query-addresses {}
  → delivery-query-stores { addressId, beType:2 }
  → query-meals { storeCode, orderType:2, beType:2, beCode }
  → query-store-coupons { storeCode, orderType:2, beType:2, beCode }
  → calculate-price { storeCode, orderType:2, beType:2, beCode, items, needTableware:false }
```

外送必须同时传 `beType: 2` 和 `beCode`；`beCode` 来自 `delivery-query-stores`。

## 4. 关键参数规则

| 参数 | 规则 |
|---|---|
| `orderType` | `1` 到店（含自取/得来速），`2` 外送（含麦乐送/团餐） |
| `beType` | `1` 到店自取，`2` 麦乐送，`5` 得来速，`6` 企业团餐 |
| `beCode` | 自取不传；外送必传，来自 `delivery-query-stores` |
| `storeCode` | 门店编码，必须是数字字符串 |
| `items[].productCode` | 必须来自 `query-meals`，不要猜 |
| `items[].quantity` | 大于等于 1 的整数 |
| 券 | `couponId` / `couponCode` 放在 `items[]` 内，不是顶层 |
| `needTableware` | 本项目固定 `false`，不产生餐具费 |
| 金额单位 | 分；展示时除以 100 |

## 5. 真机返回结构（2026-10-23 实测）

### 5.1 响应是 Markdown + JSON

MCP 工具返回的 `content[0].text` 通常先给字段说明，再在末尾附 JSON：

```text
## Response Structure
- **data.price**: ...
## Original Response

{"success":true,"code":200,"message":"请求成功","data":{...}}
```

因此不能直接 `JSON.parse` 整段文本。`src/compare/normalize.ts` 会：

1. 优先找 `{"success":` 标记；
2. 从该位置做括号配对（跳过字符串内的括号）；
3. 解析顶层 JSON；
4. 解析失败则保留原文，交给上层判断。

`query-my-coupons` 是例外：实测只返回 Markdown，没有 JSON、没有 `couponId`。所以它只用于展示，不作为算价依据。

### 5.2 `calculate-price` 实测返回

以「巨无霸」到店自取为例（已脱敏，保留结构）：

```json
{
  "success": true,
  "code": 200,
  "data": {
    "productOriginalPrice": 2550,
    "productPrice": 2550,
    "originalPrice": 2550,
    "discount": 0,
    "price": 2550,
    "productList": [
      {
        "productCode": "1100",
        "productName": "巨无霸",
        "quantity": 1,
        "originalSubtotal": 2550,
        "subtotal": 2550
      }
    ],
    "takeWayList": [
      { "code": "eat-in", "title": "堂食" },
      { "code": "locker-out", "title": "外带" }
    ]
  }
}
```

**应付总额取 `data.price`，单位是分。** `productPrice` 是商品小计，不是最终应付；配送费/包装费如有会单独返回。

### 5.3 `query-meals` 实测结构

```json
{
  "data": {
    "meals": {
      "1100": {
        "name": "巨无霸",
        "currentPrice": "25.5",
        "originalPrice": "25.5"
      }
    }
  }
}
```

- `data.meals` 是「商品编码 → 商品详情」的映射；key 就是 `productCode`。
- `currentPrice` 是**元字符串**，需要转成分。
- 菜单里还有 `categories`，只用于分类展示，不参与算价。

### 5.4 `query-store-coupons` 实测结构

```json
{
  "data": [
    {
      "title": "19.9元王牌炸鸡任选2",
      "couponId": "44928824D2D4273FE5ECA617BBF75483",
      "couponCode": "MCD6Q01000T160991S1XF",
      "products": [
        { "productName": "薄皮焦香V翅", "productCode": "520445" }
      ]
    }
  ]
}
```

- 这是**当前门店 + 当前取餐方式**可用的券，是算价的权威来源。
- `products[].productCode` 用于判断券是否适用于目标商品；不适用就跳过，不做猜测。
- 券的优惠金额不一定是结构化字段（例如固定价套餐券），最终优惠以 `calculate-price` 返回为准。

### 5.5 `delivery-query-addresses` 实测

```json
{ "data": { "addresses": [] } }
```

当前测试账号没有保存外送地址，因此实测只跑了到店链路；外送链路已通过单元测试（假 MCP）验证参数结构。要跑外送实测，需要先在麦当劳 App/小程序中保存一个配送地址，或传入有效的 `--address-id`。

## 6. 真机验证记录

| 项目 | 结果 |
|---|---|
| 日期 | 2026-10-23 |
| 位置 | 上海 · 人民广场 |
| 工具连接 | 成功，35 个工具 |
| 附近门店 | 5 家 |
| 实际算价门店 | 3 家 |
| 到店到手价 | ¥25.50 / ¥25.50 / ¥26.50 |
| 外送地址 | 0 个，已降级为只比到店 |
| 订单创建 | 未调用 |

复现：

```bash
cp .env.example .env
# 填入 MCD_MCP_TOKEN
npm install
npm run probe
npm run compare -- --intent "巨无霸" --city "上海" --keyword "人民广场"
```

## 7. 错误处理与降级

| 场景 | 行为 |
|---|---|
| 某门店菜单/券查询失败 | 跳过该门店，记录 warning |
| 某个候选券算价失败 | 淘汰该候选，不影响其他方案 |
| 所有候选都算价失败 | 报错，不输出假推荐 |
| 没有外送地址 | 只比到店，明确提示 |
| 接口超时/限流 | 当前实现重试为 0；建议减少门店数或稍后再试 |
| 响应结构变化 | `npm run probe -- --full` 查看最新 schema |

**不编造**：没有算价结果的方案不会进入结果；ETA 没有返回就写“时间未知”；自取时间只在有距离时按 80 米/分钟 + 5 分钟估算，并标注“估算”。

## 8. 频率与并发

- 最多 3 家自取 + 2 家外送门店。
- 每店最多 5 个候选方案。
- `calculate-price` 并发 3。
- 单次比价通常 10–25 次工具调用，远低于 600 次/分钟的官方限制。

## 9. 安全

- Token 只从 `MCD_MCP_TOKEN` 环境变量读取；`.env` 已被 `.gitignore` 忽略。
- 仓库不包含真实 Token、地址、电话、联系人。
- 报告只展示门店、商品、券名、金额；不展示原始响应中的个人信息。
- 只读白名单在代码层强制校验，不能通过提示词绕过。

## 10. 已知限制

- `query-my-coupons` 只有 Markdown，没有 `couponId`；本项目改用 `query-store-coupons`。
- 外送链路依赖账号已保存地址；当前验证账号没有地址，外送仅完成单元测试。
- 自取 ETA 是距离估算，不是官方承诺；外送 ETA 只有接口返回时才展示。
- 菜单价格是元字符串，`calculate-price` 是分；代码内部统一转分。
- 券的可叠加规则由官方算价接口决定，本项目不做规则猜测。
