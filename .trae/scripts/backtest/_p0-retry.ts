#!/usr/bin/env bun
/**
 * 重试 diag3：验证 clist 端点是否稳定可用
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchClist(fs: string) {
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&fid=f12&fs=${encodeURIComponent(fs)}&fields=f12,f13,f14,f100`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://quote.eastmoney.com/', 'Accept': '*/*' },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { data?: { total?: number; diff?: Record<string, any> | any[] } };
      const diffObj = j.data?.diff ?? {};
      const rows = Array.isArray(diffObj) ? diffObj : Object.values(diffObj);
      return { rows, total: j.data?.total ?? 0 };
    } catch (e) {
      console.log(`  attempt ${attempt + 1} 失败: ${e}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return { rows: [], total: 0 };
}

async function main() {
  const groups = ['m:1+t:2', 'm:1+t:23', 'm:0+t:6', 'm:0+t:80', 'm:0+t:81'];
  for (const g of groups) {
    console.log(`\n[${g}]`);
    const r = await fetchClist(g);
    console.log(`  total=${r.total}, rows=${r.rows.length}`);
    if (r.rows.length > 0) {
      console.log(`  first: ${JSON.stringify(r.rows[0])}`);
    }
  }
}

main().catch(console.error);
