// ========== 暗盘数据类型 ==========

export interface DarkTradeItem {
  '3': number;
  '4': string;
  '5': number;
  '6': number;
  '7': number;
  '8': number;
  '9': number;
  '10': number;
  '11': number;
  '12': number;
  '13': number;
  '14': number;
  '15': string;
  '16': string;
  '17': string;
  '18': string;
  '19': number;
  '20': string;
  '21': number;
}

export interface DarkTradeResponse {
  errid: number;
  errmsg: string;
  '1': number;
  '2': number;
  data: DarkTradeItem[];
}

// ========== 排序相关 ==========

export type SortKey = 'code' | 'name' | 'darkFund' | 'brightFund' | 'mainNet' | 'activity' | 'price' | 'change';
export type SortDir = 'asc' | 'desc';

export const SORT_KEY_MAP: Record<SortKey, keyof DarkTradeItem> = {
  code: '4',
  name: '16',
  darkFund: '6',
  brightFund: '7',
  mainNet: '8',
  activity: '11',
  price: '13',
  change: '14',
};

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

// ========== 统计摘要 ==========

export interface DarkTradeStats {
  total: number;
  inflowCount: number;
  outflowCount: number;
  inflowAmount: number;
  outflowAmount: number;
}
