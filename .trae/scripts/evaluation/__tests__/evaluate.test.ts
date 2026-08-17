import { describe, it, expect, spyOn, afterAll } from 'bun:test';
import * as hithink from '../../hithink/hithink.ts';

// ======== 以 spyOn 拦截 hithink.ts 导出（替代 mock.module）========
// 说明：bun:test 的 mock.module 为进程级全局替换，会污染同进程内其他测试文件
// （如 screen.test.ts import 的 getIndicatorsRaw 会因 mock 模块缺少该导出而报错）。
// 改为 spyOn 单函数拦截 + afterAll restore，测试文件间互不影响。
const mockHithink = {
  searchTicker: spyOn(hithink, 'searchTicker').mockImplementation(async () => []),
  getSnapshot: spyOn(hithink, 'getSnapshot').mockImplementation(async () => [
    {
      last_price: 168.88,
      turnover: 5_0000_0000,
    },
  ]),
  getValuations: spyOn(hithink, 'getValuations').mockImplementation(async (_code?: string) => [
    {
      pe_ttm: 22.5,
      pb_mrq: 5.2,
      ps_ttm: 8.1,
      pcf_ttm: 18.3,
    },
  ]),
  getKline: spyOn(hithink, 'getKline').mockImplementation(async () => []),
  getIncomeStatements: spyOn(hithink, 'getIncomeStatements').mockImplementation(async () => [
    {
      fiscal_period: 'FY',
      fiscal_year: 2025,
      operating_income: 1200_0000_0000,
      net_profit: 300_0000_0000,
      parent_holder_net_profit: 280_0000_0000,
      basic_eps: 22.28,
      interest_expenses: 10_0000_0000,
    },
  ]),
  getBalanceSheets: spyOn(hithink, 'getBalanceSheets').mockImplementation(async () => [
    {
      assets_total: 2000_0000_0000,
      holder_equity_total: 1200_0000_0000,
      total_debt: 300_0000_0000,
      cash: 400_0000_0000,
      accounts_receivable: 200_0000_0000,
    },
    {
      assets_total: 1800_0000_0000,
      holder_equity_total: 1000_0000_0000,
      total_debt: 250_0000_0000,
      cash: 300_0000_0000,
      accounts_receivable: 160_0000_0000,
    },
  ]),
  getCashFlows: spyOn(hithink, 'getCashFlows').mockImplementation(async () => [
    {
      act_cash_flow_net: 350_0000_0000,
    },
  ]),
  getIndicators: spyOn(hithink, 'getIndicators').mockImplementation(async () => [
    {
      roe: 0.18,
      gross_profit_ratio: 0.45,
      net_profit_ratio: 0.25,
      asset_liability_ratio: 0.4,
      yoy_operating_income: 0.15,
      yoy_net_profit: 0.2,
    },
  ]),
  getMarketCapFromEastmoney: spyOn(hithink, 'getMarketCapFromEastmoney').mockImplementation(
    async () => [{ market_cap: 1200_0000_0000 }],
  ),
};

// 测试结束后恢复真实实现，避免残留 mock 影响同进程其他测试文件
afterAll(() => {
  for (const spy of Object.values(mockHithink)) spy.mockRestore();
});

// 动态导入被测模块
const { generateFramework, toThsCode, fmtWan, fmtPct, fmtDate } =
  await import('../evaluate');

// ======== 辅助函数测试 ========
describe('toThsCode', () => {
  it('adds .SH for codes starting with 6', () => {
    expect(toThsCode('600519')).toBe('600519.SH');
  });
  it('adds .SZ for codes not starting with 6', () => {
    expect(toThsCode('000858')).toBe('000858.SZ');
    expect(toThsCode('300001')).toBe('300001.SZ');
  });
  it('returns as-is if already contains dot', () => {
    expect(toThsCode('600519.SH')).toBe('600519.SH');
    expect(toThsCode('000858.SZ')).toBe('000858.SZ');
  });
});

describe('fmtWan', () => {
  it('returns — for null/undefined', () => {
    expect(fmtWan(null)).toBe('—');
    expect(fmtWan(undefined)).toBe('—');
  });
  it('formats as 亿 when >= 1e8', () => {
    expect(fmtWan(1_0000_0000)).toBe('1.00 亿');
    expect(fmtWan(12_5000_0000)).toBe('12.50 亿');
  });
  it('formats as 万 when >= 1e4 and < 1e8', () => {
    expect(fmtWan(1_0000)).toBe('1.00 万');
    expect(fmtWan(500_0000)).toBe('500.00 万');
  });
  it('formats raw number when < 1e4', () => {
    expect(fmtWan(1234)).toBe('1234.00');
    expect(fmtWan(0)).toBe('0.00');
  });
});

describe('fmtPct', () => {
  it('returns — for null/undefined', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
  });
  it('formats percentage with 2 decimals', () => {
    expect(fmtPct(0.1523)).toBe('15.23%');
    expect(fmtPct(0)).toBe('0.00%');
    expect(fmtPct(1)).toBe('100.00%');
  });
});

describe('fmtDate', () => {
  it('formats timestamp to YYYY-MM-DD', () => {
    expect(fmtDate(new Date('2026-08-04T12:00:00Z').getTime())).toBe(
      '2026-08-04',
    );
  });
});

// ======== generateFramework 集成测试 ========
describe('generateFramework', () => {
  async function captureOutput(fn: () => Promise<void>): Promise<string> {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));
    try {
      await fn();
    } finally {
      console.log = orig;
    }
    return logs.join('\n');
  }

  it('outputs all required sections with valid data', async () => {
    const output = await captureOutput(() => generateFramework('600519.SH'));

    expect(output).toContain('四大师评估 + 财报精读框架');
    expect(output).toContain('Agent 裁定版');
    expect(output).toContain('估值与股价快照');
    expect(output).toContain('核心财务指标速览');
    expect(output).toContain('杜邦分析');
    expect(output).toContain('盈利质量信号');
    expect(output).toContain('财报精读 10 项检查清单');
    expect(output).toContain('四大师投资评估');

    // 评分卡应为占位符，不出现自动计算的具体分数
    expect(output).toContain('✩✩✩✩✩');
    expect(output).toContain('_/10');
    expect(output).not.toMatch(/\b\d+\.\d\/10\b/); // 不应有 "x.x/10" 自动评分

    // 财务数据应正确渲染（使用 mock 数据）
    expect(output).toContain('168.88'); // 股价
    expect(output).toContain('22.28'); // EPS
    expect(output).toContain('22.50'); // PE
    expect(output).toContain('45.00%'); // 毛利率
    expect(output).toContain('18.00%'); // ROE

    // 杜邦分析计算
    expect(output).toContain('25.00%'); // 净利润率 = 300/1200
    expect(output).toContain('0.60'); // 资产周转率 = 1200/2000
    expect(output).toContain('1.67'); // 权益乘数 = 2000/1200

    // 盈利质量信号
    expect(output).toContain('经营现金流 > 净利润');
    expect(output).toContain('资产负债率 < 70%');
    expect(output).toContain('ROE > 10%');
    expect(output).toContain('毛利率 > 20%');

    // 财报精读清单
    expect(output).toContain('ROE ≥ 12%');
    expect(output).toContain('经营现金流 ≥ 净利润 × 0.8');
    expect(output).toContain('资产负债率 ≤ 60%');
    expect(output).toContain('当期归母净利润为正');
    expect(output).toContain('毛利率 ≥ 25%');
  });

  it('估值升级：输出估值方法路由与倍数隐含假设反推', async () => {
    mockHithink.getSnapshot.mockImplementation(async () => [
      { last_price: 100, turnover: 1_0000_0000 },
    ]);
    mockHithink.getValuations.mockImplementation(async () => [
      { pe_ttm: 22.5, pb_mrq: 4, ps_ttm: 6, pcf_ttm: 15 },
    ]);
    mockHithink.getIncomeStatements.mockImplementation(async () => [
      {
        fiscal_period: 'FY',
        fiscal_year: 2025,
        operating_income: 100_0000_0000,
        net_profit: 200_0000_0000,
        parent_holder_net_profit: 180_0000_0000,
        basic_eps: 10,
      },
    ]);
    mockHithink.getBalanceSheets.mockImplementation(async () => [
      {
        assets_total: 1000_0000_0000,
        holder_equity_total: 600_0000_0000,
        total_debt: 200_0000_0000,
      },
    ]);
    mockHithink.getCashFlows.mockImplementation(async () => [
      { act_cash_flow_net: 250_0000_0000 },
    ]);
    mockHithink.getIndicators.mockImplementation(async () => [
      {
        roe: 0.2,
        gross_profit_ratio: 0.5,
        net_profit_ratio: 0.2,
        asset_liability_ratio: 0.3,
        yoy_operating_income: 0.1,
        yoy_net_profit: 0.15,
      },
    ]);

    const output = await captureOutput(() =>
      generateFramework('600519.SH', [], '周期'),
    );

    // 估值方法路由（企业类型匹配）
    expect(output).toContain('估值方法路由');
    expect(output).toContain('正常化 EPS');
    expect(output).toContain('金融（银行/保险'); // 匹配包含，不管加粗
    expect(output).toContain('周期（钢铁/化工/航运/大宗）'); // 当前选中会加粗
    expect(output).toContain('Agent 显式指定 `--type 周期`');
    // 倍数隐含假设反推（PEG = 22.5 ÷ 15 = 1.50）
    expect(output).toContain('倍数隐含假设反推');
    expect(output).toContain('PEG');
    expect(output).toContain('1.50');
    // 价值区间与安全边际指引
    expect(output).toContain('价值区间');
    expect(output).toContain('安全边际');
    expect(output).toContain('无护城河企业');
  });

  it('排雷数据生产端：输出利息覆盖/应收增速/货币资金占比（供 quality-screen 消费）', async () => {
    mockHithink.getSnapshot.mockImplementation(async () => [
      { last_price: 100, turnover: 1_0000_0000 },
    ]);
    mockHithink.getValuations.mockImplementation(async () => [
      { pe_ttm: 22.5, pb_mrq: 4, ps_ttm: 6, pcf_ttm: 15 },
    ]);
    mockHithink.getIncomeStatements.mockImplementation(async () => [
      {
        fiscal_period: 'FY',
        fiscal_year: 2025,
        operating_income: 1000_0000_0000,
        net_profit: 200_0000_0000,
        parent_holder_net_profit: 180_0000_0000,
        basic_eps: 10,
        interest_expenses: 25_0000_0000,
      },
    ]);
    mockHithink.getBalanceSheets.mockImplementation(async () => [
      {
        assets_total: 1000_0000_0000,
        holder_equity_total: 600_0000_0000,
        total_debt: 200_0000_0000,
        cash: 150_0000_0000,
        accounts_receivable: 110_0000_0000,
      },
      {
        assets_total: 900_0000_0000,
        holder_equity_total: 550_0000_0000,
        total_debt: 180_0000_0000,
        cash: 100_0000_0000,
        accounts_receivable: 100_0000_0000,
      },
    ]);
    mockHithink.getCashFlows.mockImplementation(async () => [
      { act_cash_flow_net: 50_0000_0000 },
    ]);
    mockHithink.getIndicators.mockImplementation(async () => [
      {
        roe: 0.2,
        gross_profit_ratio: 0.5,
        net_profit_ratio: 0.2,
        asset_liability_ratio: 0.3,
        yoy_operating_income: 0.1,
        yoy_net_profit: 0.15,
      },
    ]);

    const output = await captureOutput(() => generateFramework('600519.SH'));

    expect(output).toContain('排雷数据生产端输出');
    // 利息覆盖 = 50亿 OCF ÷ 25亿 利息 = 2.00
    expect(output).toContain('利息覆盖倍数 | 2.00');
    // 应收增速 = (110-100)/100 = 10.00%
    expect(output).toContain('应收增速 | 10.00%');
    // 货币资金/总资产 = 150/1000 = 15.00%
    expect(output).toContain('货币资金/总资产占比 | 15.00%');
  });

  it('排雷数据生产端：数据缺失时输出 N/A 不崩溃', async () => {
    mockHithink.getIncomeStatements.mockImplementation(async () => [
      {
        fiscal_period: 'FY',
        fiscal_year: 2025,
        operating_income: 1000_0000_0000,
        net_profit: 200_0000_0000,
        parent_holder_net_profit: 180_0000_0000,
        basic_eps: 10,
        // 无 interest_expenses
      },
    ]);
    mockHithink.getBalanceSheets.mockImplementation(async () => [
      {
        assets_total: 1000_0000_0000,
        holder_equity_total: 600_0000_0000,
        total_debt: 200_0000_0000,
      },
    ]);
    mockHithink.getCashFlows.mockImplementation(async () => [
      { act_cash_flow_net: 50_0000_0000 },
    ]);

    const output = await captureOutput(() => generateFramework('600519.SH'));

    expect(output).toContain('排雷数据生产端输出');
    expect(output).toContain('利息覆盖倍数 | N/A');
    expect(output).toContain('应收增速 | N/A');
    expect(output).toContain('货币资金/总资产占比 | N/A');
    expect(output).not.toContain('NaN');
    expect(output).not.toContain('undefined');
  });

  it('handles missing data gracefully without crashing', async () => {
    mockHithink.getSnapshot.mockReset?.();
    mockHithink.getValuations.mockReset?.();
    mockHithink.getIncomeStatements.mockReset?.();
    mockHithink.getBalanceSheets.mockReset?.();
    mockHithink.getCashFlows.mockReset?.();
    mockHithink.getIndicators.mockReset?.();

    mockHithink.getSnapshot.mockImplementation(async () => []);
    mockHithink.getValuations.mockImplementation(async () => []);
    mockHithink.getIncomeStatements.mockImplementation(async () => []);
    mockHithink.getBalanceSheets.mockImplementation(async () => []);
    mockHithink.getCashFlows.mockImplementation(async () => []);
    mockHithink.getIndicators.mockImplementation(async () => []);

    const output = await captureOutput(() => generateFramework('000001.SZ'));

    expect(output).toContain('四大师评估 + 财报精读框架');
    expect(output).toContain('Agent 裁定版');
    // 无数据时仍应输出结构，不出现 NaN/undefined
    expect(output).not.toContain('NaN');
    expect(output).not.toContain('undefined');
  });

  it('includes peer comparison when peers are provided', async () => {
    // restore mocks
    mockHithink.getSnapshot.mockImplementation(async () => [
      {
        last_price: 100,
        turnover: 1_0000_0000,
      },
    ]);
    mockHithink.getValuations.mockImplementation(async (code?: string) =>
      code === '600519.SH'
        ? [{ pe_ttm: 20, pb_mrq: 4, ps_ttm: 6, pcf_ttm: 15 }]
        : [{ pe_ttm: 25, pb_mrq: 5, ps_ttm: 7, pcf_ttm: 18 }],
    );
    mockHithink.getIncomeStatements.mockImplementation(async () => [
      {
        fiscal_period: 'FY',
        fiscal_year: 2025,
        operating_income: 100_0000_0000,
        net_profit: 200_0000_0000,
        parent_holder_net_profit: 180_0000_0000,
        basic_eps: 10,
      },
    ]);
    mockHithink.getBalanceSheets.mockImplementation(async () => [
      {
        assets_total: 1000_0000_0000,
        holder_equity_total: 600_0000_0000,
        total_debt: 200_0000_0000,
      },
    ]);
    mockHithink.getCashFlows.mockImplementation(async () => [
      { act_cash_flow_net: 250_0000_0000 },
    ]);
    mockHithink.getIndicators.mockImplementation(async () => [
      {
        roe: 0.2,
        gross_profit_ratio: 0.5,
        net_profit_ratio: 0.2,
        asset_liability_ratio: 0.3,
        yoy_operating_income: 0.1,
        yoy_net_profit: 0.15,
      },
    ]);

    const output = await captureOutput(() =>
      generateFramework('600519.SH', ['000858']),
    );

    expect(output).toContain('同业对比');
    expect(output).toContain('600519.SH');
    expect(output).toContain('000858.SZ');
  });

  it('同比数据异常（|同比|>500%）：输出存疑标注，Forward PE 不自动递推', async () => {
    mockHithink.getSnapshot.mockImplementation(async () => [
      { last_price: 100, turnover: 1_0000_0000 },
    ]);
    mockHithink.getValuations.mockImplementation(async () => [
      { pe_ttm: 22.5, pb_mrq: 4, ps_ttm: 6, pcf_ttm: 15 },
    ]);
    mockHithink.getIncomeStatements.mockImplementation(async () => [
      {
        fiscal_period: 'FY',
        fiscal_year: 2025,
        operating_income: 100_0000_0000,
        net_profit: 200_0000_0000,
        parent_holder_net_profit: 180_0000_0000,
        basic_eps: 10,
      },
    ]);
    mockHithink.getBalanceSheets.mockImplementation(async () => [
      {
        assets_total: 1000_0000_0000,
        holder_equity_total: 600_0000_0000,
        total_debt: 200_0000_0000,
      },
    ]);
    mockHithink.getCashFlows.mockImplementation(async () => [
      { act_cash_flow_net: 250_0000_0000 },
    ]);
    // 模拟极端/异常同比（映射修复后 getIndicators 已 ÷100 为比率，|同比|>5 仅出现在真实 >500% 极端增速或上游异常）
    // 用例目的：验证 evaluate.ts 对这类值的防御性守卫——不传播、不自动递推 Forward PE
    mockHithink.getIndicators.mockImplementation(async () => [
      {
        roe: 0.2,
        gross_profit_ratio: 0.5,
        net_profit_ratio: 0.2,
        asset_liability_ratio: 0.3,
        yoy_operating_income: 41.4962,
        yoy_net_profit: 91.9501,
      },
    ]);

    const output = await captureOutput(() => generateFramework('688049.SH'));

    // 速览区同比：极端/异常值拦截显示「存疑（以年报为准）」，不向报告透传未核对数值
    expect(output).toMatch(/净利同比 \| 存疑（接口异常，以年报为准） \|/);
    expect(output).toContain('接口同比异常，请以年报『主要会计数据』核对');
    expect(output).not.toContain('9195.01% ⚠️');
    // Forward PE 不自动递推（预测期净利为 —）
    expect(output).toContain('预测期净利（亿元） | — |');
    expect(output).toContain('| **Forward PE** | — |');
    // 显式 --forward-growth 时仍递推
    mockHithink.getIncomeStatements.mockImplementation(async () => [
      {
        fiscal_period: 'FY',
        fiscal_year: 2025,
        operating_income: 100_0000_0000,
        net_profit: 200_0000_0000,
        parent_holder_net_profit: 180_0000_0000,
        basic_eps: 10,
      },
    ]);
    const output2 = await captureOutput(() =>
      generateFramework('688049.SH', [], undefined, { forwardGrowth: 0.15 }),
    );
    expect(output2).toContain('预测期净利（亿元） | 61.3 |'); // 53.3亿 × 1.15
    expect(output2).toContain('| **Forward PE** | 19.6x |'); // 1200亿 ÷ 61.3亿
  });

  it('一次性损益疑似（净利同比 >300%）：PE-TTM 评价加失真警告', async () => {
    mockHithink.getSnapshot.mockImplementation(async () => [
      { last_price: 100, turnover: 1_0000_0000 },
    ]);
    mockHithink.getValuations.mockImplementation(async () => [
      { pe_ttm: 14.58, pb_mrq: 4, ps_ttm: 6, pcf_ttm: 15 },
    ]);
    mockHithink.getIncomeStatements.mockImplementation(async () => [
      {
        fiscal_period: 'FY',
        fiscal_year: 2025,
        operating_income: 100_0000_0000,
        net_profit: 200_0000_0000,
        parent_holder_net_profit: 180_0000_0000,
        basic_eps: 10,
      },
      {
        fiscal_period: 'FY',
        fiscal_year: 2024,
        operating_income: 60_0000_0000,
        net_profit: 20_0000_0000,
        parent_holder_net_profit: 18_0000_0000,
        basic_eps: 2,
      },
    ]);
    mockHithink.getBalanceSheets.mockImplementation(async () => [
      {
        assets_total: 1000_0000_0000,
        holder_equity_total: 600_0000_0000,
        total_debt: 200_0000_0000,
      },
    ]);
    mockHithink.getCashFlows.mockImplementation(async () => [
      { act_cash_flow_net: 250_0000_0000 },
    ]);
    // 三生国健 688336 类：净利同比 311.49%（真实），PE-TTM 14.58 实为一次性 BD 收入支撑
    mockHithink.getIndicators.mockImplementation(async () => [
      {
        roe: 0.41,
        gross_profit_ratio: 0.7,
        net_profit_ratio: 0.4,
        asset_liability_ratio: 0.3,
        yoy_operating_income: 2.5181,
        yoy_net_profit: 3.1149,
      },
    ]);

    const output = await captureOutput(() => generateFramework('688336.SH'));

    // PE-TTM 评价含一次性损益失真警告
    expect(output).toContain('疑似一次性损益，建议用正常化盈利');
    expect(output).toContain('净利可能含大额一次性收入');
    // PEG 行同样标注
    expect(output).toContain('PEG');
    expect(output).toContain('一次性收入');
  });

  it('正常数据：不出现存疑/一次性损益警告', async () => {
    mockHithink.getSnapshot.mockImplementation(async () => [
      { last_price: 100, turnover: 1_0000_0000 },
    ]);
    mockHithink.getValuations.mockImplementation(async () => [
      { pe_ttm: 22.5, pb_mrq: 4, ps_ttm: 6, pcf_ttm: 15 },
    ]);
    mockHithink.getIncomeStatements.mockImplementation(async () => [
      {
        fiscal_period: 'FY',
        fiscal_year: 2025,
        operating_income: 100_0000_0000,
        net_profit: 20_0000_0000,
        parent_holder_net_profit: 18_0000_0000,
        basic_eps: 10,
      },
      {
        fiscal_period: 'FY',
        fiscal_year: 2024,
        operating_income: 90_0000_0000,
        net_profit: 16_0000_0000,
        parent_holder_net_profit: 15_0000_0000,
        basic_eps: 9,
      },
    ]);
    mockHithink.getBalanceSheets.mockImplementation(async () => [
      {
        assets_total: 1000_0000_0000,
        holder_equity_total: 600_0000_0000,
        total_debt: 200_0000_0000,
      },
    ]);
    mockHithink.getCashFlows.mockImplementation(async () => [
      { act_cash_flow_net: 250_0000_0000 },
    ]);
    mockHithink.getIndicators.mockImplementation(async () => [
      {
        roe: 0.2,
        gross_profit_ratio: 0.5,
        net_profit_ratio: 0.2,
        asset_liability_ratio: 0.3,
        yoy_operating_income: 0.1,
        yoy_net_profit: 0.15,
      },
    ]);

    const output = await captureOutput(() => generateFramework('600519.SH'));

    expect(output).not.toContain('同比数据存疑');
    expect(output).not.toContain('一次性收入');
    // Forward PE 正常递推（TTM净利 53.3亿 × 1.15 = 61.3亿）
    expect(output).toContain('预测期净利（亿元） | 61.3 |');
  });
});
