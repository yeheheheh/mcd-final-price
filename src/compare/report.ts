import type { ComparisonResult, Offer } from '../domain/types.js';

export function formatCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function modeLabel(offer: Offer): string {
  return offer.mode === 'pickup' ? '到店自取' : '麦乐送';
}

function timeLabel(offer: Offer): string {
  if (offer.etaMinutes === undefined) return '时间未知';
  const prefix = offer.mode === 'delivery' ? '预计' : '约';
  const suffix = offer.etaSource === 'estimated' ? '（估算）' : '';
  return `${prefix} ${offer.etaMinutes} 分钟${suffix}`;
}

function itemsLabel(offer: Offer): string {
  return offer.items.map((item) => `${item.name} ×${item.quantity}`).join(' + ');
}

function couponLabel(offer: Offer): string {
  if (!offer.coupon) return '无';
  const discount = offer.coupon.discountCents ?? offer.quote.discountCents;
  return discount === undefined
    ? offer.coupon.name
    : `-${formatCents(discount)}（${offer.coupon.name}）`;
}

function feesLabel(offer: Offer): string {
  const delivery = offer.quote.deliveryFeeCents;
  const packaging = offer.quote.packagingFeeCents;
  if (delivery === undefined && packaging === undefined) return '—';
  return formatCents((delivery ?? 0) + (packaging ?? 0));
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function tableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function recommendationText(result: ComparisonResult): string {
  const { winner, cheapest, fastest } = result;
  const parts: string[] = [];

  if (winner.id === cheapest.id) {
    parts.push(
      `推荐 ${winner.store.storeName}（${modeLabel(winner)}），到手 ${formatCents(winner.quote.totalCents)}，是当前最便宜的方案。`,
    );
  } else {
    parts.push(
      `按时间价值折算，${winner.store.storeName}（${modeLabel(winner)}）胜出：到手 ${formatCents(winner.quote.totalCents)} + 时间成本 ${formatCents(winner.timeCostCents)} = ${formatCents(winner.adjustedTotalCents)}。`,
    );
    parts.push(
      `单看价格最低的是 ${cheapest.store.storeName}，到手 ${formatCents(cheapest.quote.totalCents)}。`,
    );
  }

  const delivery = result.offers.find((offer) => offer.mode === 'delivery');
  const pickup = result.offers.find((offer) => offer.mode === 'pickup');

  if (winner.mode === 'pickup' && delivery && delivery.id !== winner.id) {
    const diff = delivery.quote.totalCents - winner.quote.totalCents;
    if (diff > 0) parts.push(`比外送省 ${formatCents(diff)}。`);
  }

  if (winner.mode === 'delivery' && pickup) {
    const diff = winner.quote.totalCents - pickup.quote.totalCents;
    if (diff > 0) parts.push(`比最便宜的自取方案多花 ${formatCents(diff)}。`);
  }

  if (fastest && fastest.id !== winner.id && fastest.etaMinutes !== undefined) {
    parts.push(`最快的是 ${fastest.store.storeName}，约 ${fastest.etaMinutes} 分钟。`);
  }

  if (result.query.hourlyWageCents !== undefined) {
    parts.push('时间价值按“占用时间”折算；外送等待时间不计入。');
  }

  return parts.join('');
}

export function renderMarkdown(result: ComparisonResult): string {
  const rows = result.offers
    .map((offer) => {
      const price = `**${formatCents(offer.quote.totalCents)}**`;
      return `| ${tableCell(offer.store.storeName)} | ${modeLabel(offer)} | ${tableCell(itemsLabel(offer))} | ${tableCell(couponLabel(offer))} | ${feesLabel(offer)} | ${price} | ${tableCell(timeLabel(offer))} |`;
    })
    .join('\n');

  const warningBlock =
    result.warnings.length === 0
      ? ''
      : `\n## 提示\n\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}\n`;

  return `# 麦麦到手价

> 同一顿麦当劳，外送到手 vs 下楼自取，差多少钱、差多少时间。

**查询**：${result.query.intent} ×${result.query.quantity}
**生成时间**：${formatTimestamp(result.generatedAt)}
**数据来源**：${result.dataSource === 'demo' ? '演示数据（非真实价格）' : 'MCP 实时查询'}

## 结论

${recommendationText(result)}

| 门店 | 取餐方式 | 商品 | 优惠 | 配送/包装 | 到手价 | 时间 |
|---|---|---|---:|---:|---:|---:|
${rows}
${warningBlock}
> 价格、券与营业状态以麦当劳官方渠道为准。本项目为参赛作品，非麦当劳官方产品。
`;
}

export function renderJson(result: ComparisonResult): string {
  return JSON.stringify(result, null, 2);
}

function renderOfferCard(offer: Offer, index: number, winnerId: string): string {
  const isWinner = offer.id === winnerId;
  const labelTag =
    offer.label === '标准价'
      ? ''
      : `<span class="tag tag-muted">${escapeHtml(offer.label)}</span>`;

  return `<article class="offer${isWinner ? ' is-winner' : ''}">
    <div class="offer-top">
      <span class="rank">#${index + 1}</span>
      <div class="tags">${isWinner ? '<span class="tag">推荐</span>' : ''}${labelTag}</div>
    </div>
    <h3>${escapeHtml(offer.store.storeName)}</h3>
    <p class="mode">${modeLabel(offer)} · ${escapeHtml(timeLabel(offer))}</p>
    <div class="price">${formatCents(offer.quote.totalCents)}</div>
    <dl>
      <div><dt>商品</dt><dd>${escapeHtml(itemsLabel(offer))}</dd></div>
      <div><dt>优惠</dt><dd>${escapeHtml(couponLabel(offer))}</dd></div>
      <div><dt>配送/包装</dt><dd>${escapeHtml(feesLabel(offer))}</dd></div>
      ${
        offer.timeCostCents > 0
          ? `<div><dt>时间成本</dt><dd>${formatCents(offer.timeCostCents)}</dd></div>
             <div><dt>折算后</dt><dd>${formatCents(offer.adjustedTotalCents)}</dd></div>`
          : ''
      }
    </dl>
  </article>`;
}

export function renderHtml(result: ComparisonResult): string {
  const sourceLabel = result.dataSource === 'demo' ? '演示数据' : '实时查询';
  const warningBlock =
    result.warnings.length === 0
      ? ''
      : `<section class="notes"><h2>提示</h2><ul>${result.warnings
          .map((warning) => `<li>${escapeHtml(warning)}</li>`)
          .join('')}</ul></section>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>麦麦到手价 · ${escapeHtml(result.query.intent)}</title>
<style>
  :root {
    --bg: #f3eee5;
    --paper: #fffdf8;
    --ink: #211a16;
    --muted: #776b60;
    --line: #e6dccd;
    --red: #c8102e;
    --gold: #ffc72c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background:
      radial-gradient(circle at 12% 0%, rgba(255, 199, 44, .22), transparent 34rem),
      radial-gradient(circle at 88% 18%, rgba(200, 16, 46, .10), transparent 28rem),
      var(--bg);
    color: var(--ink);
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
    line-height: 1.6;
  }
  .page { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 36px; }
  .eyebrow {
    color: var(--red);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .18em;
    text-transform: uppercase;
  }
  h1 { margin: 8px 0 10px; font-size: clamp(38px, 7vw, 68px); line-height: 1; letter-spacing: -.04em; }
  .tagline { margin: 0; max-width: 640px; color: var(--muted); font-size: 18px; }
  .meta { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-top: 20px; color: var(--muted); font-size: 13px; }
  .pill { background: var(--red); color: #fff; border-radius: 999px; padding: 3px 10px; font-weight: 700; }
  .meta .source-live { background: #1f7a4d; }
  .winner-card {
    margin-top: 30px;
    padding: 28px;
    border-radius: 26px;
    color: #fff;
    background:
      radial-gradient(circle at 88% 0%, rgba(255, 199, 44, .34), transparent 22rem),
      var(--ink);
    box-shadow: 0 22px 50px rgba(33, 26, 22, .18);
  }
  .winner-kicker { color: var(--gold); font-size: 12px; font-weight: 800; letter-spacing: .16em; }
  .winner-main { display: flex; justify-content: space-between; gap: 20px; align-items: flex-end; margin-top: 10px; }
  .winner-main h2 { margin: 0; font-size: clamp(24px, 4vw, 38px); }
  .winner-main p { margin: 6px 0 0; color: rgba(255,255,255,.72); }
  .winner-price { color: var(--gold); font-size: clamp(34px, 6vw, 56px); font-weight: 800; letter-spacing: -.04em; white-space: nowrap; }
  .winner-reason { margin: 18px 0 0; color: rgba(255,255,255,.86); }
  .offers { margin-top: 34px; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
  .section-head h2 { margin: 0 0 12px; font-size: 20px; }
  .section-head span { color: var(--muted); font-size: 13px; }
  .offer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; }
  .offer {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 20px;
    box-shadow: 0 10px 24px rgba(33, 26, 22, .05);
  }
  .offer.is-winner { border-color: var(--red); box-shadow: 0 14px 30px rgba(200, 16, 46, .12); }
  .offer-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .rank { color: var(--muted); font-size: 12px; font-weight: 700; }
  .tags { display: flex; gap: 6px; }
  .tag { background: var(--red); color: #fff; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
  .tag-muted { background: #f0e8db; color: var(--muted); }
  .offer h3 { margin: 12px 0 2px; font-size: 18px; }
  .mode { margin: 0; color: var(--muted); font-size: 13px; }
  .price { margin: 14px 0 12px; font-size: 30px; font-weight: 800; letter-spacing: -.03em; }
  dl { margin: 0; display: grid; gap: 8px; }
  dl > div { display: flex; justify-content: space-between; gap: 14px; border-top: 1px dashed var(--line); padding-top: 8px; }
  dt { color: var(--muted); font-size: 12px; }
  dd { margin: 0; text-align: right; font-size: 13px; }
  .notes { margin-top: 26px; background: rgba(255, 253, 248, .72); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px; }
  .notes h2 { margin: 0 0 8px; font-size: 16px; }
  .notes ul { margin: 0; padding-left: 20px; color: var(--muted); font-size: 13px; }
  footer { margin-top: 28px; color: var(--muted); font-size: 12px; }
  @media (max-width: 560px) {
    .page { padding-top: 28px; }
    .winner-main { display: block; }
    .winner-price { margin-top: 12px; }
  }
</style>
</head>
<body>
<main class="page">
  <header>
    <div class="eyebrow">MCD FINAL PRICE · 外送 vs 到店</div>
    <h1>麦麦到手价</h1>
    <p class="tagline">同一顿麦当劳，外送到手 vs 下楼自取，差多少钱、差多少时间。</p>
    <div class="meta">
      <span class="pill${result.dataSource === 'live' ? ' source-live' : ''}">${sourceLabel}</span>
      <span>查询：${escapeHtml(result.query.intent)} ×${result.query.quantity}</span>
      <span>生成：${escapeHtml(formatTimestamp(result.generatedAt))}</span>
    </div>
  </header>

  <section class="winner-card">
    <div class="winner-kicker">本次推荐</div>
    <div class="winner-main">
      <div>
        <h2>${escapeHtml(result.winner.store.storeName)}</h2>
        <p>${modeLabel(result.winner)} · ${escapeHtml(timeLabel(result.winner))}</p>
      </div>
      <div class="winner-price">${formatCents(result.winner.quote.totalCents)}</div>
    </div>
    <p class="winner-reason">${escapeHtml(recommendationText(result))}</p>
  </section>

  <section class="offers">
    <div class="section-head"><h2>全部方案</h2><span>${result.offers.length} 个方案</span></div>
    <div class="offer-grid">
      ${result.offers.map((offer, index) => renderOfferCard(offer, index, result.winner.id)).join('\n      ')}
    </div>
  </section>

  ${warningBlock}

  <footer>
    价格、券与营业状态以麦当劳官方渠道为准。本项目为参赛作品，非麦当劳官方产品。
  </footer>
</main>
</body>
</html>
`;
}
