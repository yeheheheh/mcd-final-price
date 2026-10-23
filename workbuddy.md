# 在 WorkBuddy 中使用「麦麦到手价」

「麦麦到手价」是一个只读的麦当劳比价 Skill：同一份餐，比较外送到手价和附近门店自取价，逐个调用 `calculate-price` 真算，最后给出可解释的推荐。

## 1. 安装

### 1.1 放入 Skill

把本仓库的 `skills/mcd-final-price/` 整个目录复制到 WorkBuddy 的 Skills 目录（具体路径以你的 WorkBuddy 版本为准）。

```text
<WorkBuddy Skills 目录>/
└── mcd-final-price/
    └── SKILL.md
```

### 1.2 配置 MCP

在 WorkBuddy 的 MCP 配置中加入：

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": {
        "Authorization": "Bearer ${MCD_MCP_TOKEN}"
      }
    }
  }
}
```

Token 在 [open.mcd.cn/mcp](https://open.mcd.cn/mcp) 获取。把 `MCD_MCP_TOKEN` 配到 WorkBuddy 的环境变量里，不要把真实 Token 写进仓库或截图。

### 1.3 重载

重启 WorkBuddy 或重载 Skills/MCP，确认能看到 `mcd-final-price` 和 `mcd-mcp`。

## 2. 怎么用

直接用自然语言：

```text
我在上海人民广场，想吃巨无霸，帮我看看现在外送和到店哪个划算。
```

```text
我在公司，想吃双层吉士堡套餐，预算 35，帮我比一下附近门店和外送。
```

```text
按我时薪 60 元算，哪个方案更值？
```

如果账号里没有保存外送地址，Skill 会明确告诉你“本次只比到店”，不会伪造地址。需要外送比价时，先在麦当劳 App/小程序保存地址，或在 CLI 里传 `--address-id`。

## 3. 它会输出什么

- 一张对比表：门店、取餐方式、商品、优惠、配送/包装、到手价、时间。
- 一句推荐：最便宜是谁、比外送省多少、比自取多花多少。
- 数据时间与提示：无外送地址、某店算价失败、某券不可用等。
- 免责声明：价格、券与营业状态以麦当劳官方渠道为准。

示例：

```text
推荐：麦当劳上海黄浦华旭国际大厦餐厅（到店自取），到手 ¥25.50。
最快的是福州路餐厅，约 8 分钟。
提示：账号下没有可用的外送地址；本次只比较到店自取。
```

## 4. 它不会做什么

- 不创建订单，不取消订单。
- 不领券，不碰支付。
- 不编造价格、券、营业时间或 ETA。
- 不把 Token、地址、电话写进报告。

## 5. 常见问题

### 401 / 未授权

- 检查 `MCD_MCP_TOKEN` 是否配置在 WorkBuddy 的环境变量里。
- 确认 Token 未过期；重新在 open.mcd.cn/mcp 获取。
- 不要把 Token 直接写进 `mcp-config.example.json`。

### 没有外送地址

当前账号 `delivery-query-addresses` 返回空数组。先在麦当劳 App/小程序保存地址；本项目不会自动创建地址。

### 某家店算价失败

可能是个别商品/券在该店不可用，或接口临时繁忙。Skill 会跳过该候选并继续其他方案；如果全部失败，会明确说“算不出来”。

### 想自己验证接口

在仓库里运行：

```bash
npm run probe
npm run probe -- --full   # 查看完整入参 schema
```

### 想不依赖 WorkBuddy 跑一遍

```bash
npm install
npm run demo             # 不需要 Token
npm run compare -- --intent "巨无霸" --city "上海" --keyword "人民广场"
```

## 6. 开发说明

本项目使用 WorkBuddy 完成需求拆解、MCP 接口探测、Skill 调试与文档整理；比价核心是确定性 TypeScript 引擎，不依赖模型做算术。

- `npm test`：53 项单元/集成测试。
- `npm run typecheck`：TypeScript 类型检查。
- `npm run probe`：只读 schema 探测。
- `npm run demo`：离线演示。
- `npm run compare`：真实 MCP 比价。

## 7. 安全提醒

- `.env` 不要提交；仓库只保留 `.env.example`。
- 截图或录屏时，避开地址、电话、Token。
- 本项目是参赛作品，非麦当劳官方产品；价格以官方结算页为准。
