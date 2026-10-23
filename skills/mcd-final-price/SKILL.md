---
name: mcd-final-price
description: 比较麦当劳中国外送到手价与附近门店到店自取价，逐方案调用 calculate-price 真算，给出可解释推荐。用户说“外送还是到店”“哪家店便宜”“这顿怎么点最划算”“帮我比价麦当劳”时使用；只读，不下单、不领券。
---

# 麦麦到手价

## 目标

回答一个具体问题：同一份麦当劳，现在外送还是到店自取更划算？输出到手价、时间、推荐和依据。

## 适用与不适用

适用：

- 用户给出想吃的餐品，以及城市/位置或外送地址。
- 用户想比较附近门店、外送、用券后的实际支付。
- 用户想知道“省几块钱值不值得多走几步”。

不适用：

- 只想领券、只想下单、想查订单、想玩游戏。
- 没有明确餐品且不愿意补充信息。

## 必填信息

1. 想吃什么：尽量具体到套餐或单品。
2. 到店位置：城市 + 关键词，例如“上海 + 人民广场”。
3. 可选：外送地址 ID、数量、时间价值（元/小时）。

缺少城市或关键词时先问用户，不要猜位置。

## 只读工具白名单

只允许调用：

- `now-time-info`
- `query-nearby-stores`
- `delivery-query-addresses`
- `delivery-query-stores`
- `query-meals`
- `query-meal-detail`
- `query-store-coupons`
- `calculate-price`

禁止调用任何写操作，包括但不限于 `create-order`、`cancel-order`、`auto-bind-coupons`、`mall-create-order`、`draw-lottery`、`party-order-create`。

`query-my-coupons` 只用于展示，不作为算价依据：真机实测它返回 Markdown 且不含 `couponId`。当前门店可用的券以 `query-store-coupons` 为准。

## 流程

### 1. 找门店

到店自取：

```json
{
  "name": "query-nearby-stores",
  "arguments": { "searchType": 2, "beType": 1, "city": "上海", "keyword": "人民广场" }
}
```

取最近 3 家。不要推荐已打烊或明显不可用的门店。

外送（可选）：

```json
{ "name": "delivery-query-addresses", "arguments": {} }
```

有地址再调用：

```json
{
  "name": "delivery-query-stores",
  "arguments": { "addressId": "<addressId>", "beType": 2 }
}
```

最多取 2 家可配送门店。没有地址就明确说“本次只比到店”，不要伪造地址。

### 2. 逐店查菜单与券

自取：

```json
{ "storeCode": "<storeCode>", "orderType": 1, "beType": 1 }
```

外送：

```json
{ "storeCode": "<storeCode>", "orderType": 2, "beType": 2, "beCode": "<beCode>" }
```

同时调用 `query-meals` 和 `query-store-coupons`，参数相同。

### 3. 匹配餐品

- 只使用菜单里真实存在的名称和 `productCode`。
- 精确匹配优先，其次名称包含匹配。
- 有歧义时先问用户。例如“双层吉士堡”同时有单点和套餐，不要默认选套餐。
- 套餐使用 `query-meals` 返回的顶层 `productCode`。需要查看套餐组成时用 `query-meal-detail`，但不要自行拆解套餐。

### 4. 生成候选

每家店生成：

1. 标准价候选。
2. 每个适用券一个候选；券的 `products[].productCode` 不包含目标商品时跳过。
3. 可选“差几元触发满减”的凑单候选，但必须真实算价，不能只做估算。

每家店候选数控制在 5 个以内，避免无意义的接口调用。

### 5. 真算价格

逐个调用 `calculate-price`：

```json
{
  "storeCode": "<storeCode>",
  "orderType": 1,
  "beType": 1,
  "items": [
    { "productCode": "<productCode>", "quantity": 1, "couponId": "<couponId>" }
  ],
  "needTableware": false
}
```

规则：

- 券 ID/码放在 `items[]` 里，不要放顶层。
- 外送必须传 `beType: 2` 和 `beCode`。
- 金额单位是**分**；展示时除以 100。
- 以返回的 `data.price` 为应付总额，不要用菜单价相加代替。
- 某个候选算价失败就淘汰它，不要猜价格。

### 6. 排序与时间

- 每家店只保留到手价最低的方案，再按到手价排序。
- 接口返回 ETA 就用，标“预计”。
- 自取只有距离时，按 `距离 / 80 米/分钟 + 5 分钟` 估算，标“估算”。
- 没有 ETA 也没有距离就写“时间未知”，不要编造。

### 7. 时间价值（可选）

用户给出时薪时：

```text
时间成本 = 占用分钟 / 60 × 时薪
外送占用时间按 1 分钟交接计算，等待时间不计入
```

同时展示“按钱排序”和“按时间价值排序”，不要替用户做价值判断。

### 8. 输出

必须包含：

1. 一张对比表：门店、取餐方式、商品、优惠、配送/包装、到手价、时间。
2. 一句推荐：最便宜是谁；比外送省多少，或比自取多花多少。
3. 数据时间。
4. 提示：无外送地址、某店算价失败、某券不可用等。
5. 免责声明：价格、券与营业状态以麦当劳官方渠道为准。

示例：

```text
推荐：南京东路店（到店自取），到手 ¥27.50，是当前最便宜的方案。
比外送省 ¥9.00；最快的是人民广场店，约 8 分钟。
```

## 安全与边界

- 只读：不创建订单、不领券、不取消订单、不碰支付。
- 不输出 Token；不把原始响应中的地址、电话、联系人写进报告。
- 不编造价格、券、营业状态、ETA；接口失败就说“算不出来”。
- 本项目是参赛作品，非麦当劳官方产品。

## 资源

- `MCP_INTEGRATION.md`：真实工具入参、返回结构和调用顺序。
- `README.md`：项目介绍、安装、示例。
- `npm run demo`：不需要 Token 的离线演示。
- `npm run compare -- --intent "巨无霸" --city 上海 --keyword 人民广场`：确定性 CLI 版本。
