export type BillSource = 'alipay' | 'wechat';

export const SOURCE_NAME: Record<BillSource, string> = { alipay: '支付宝', wechat: '微信' };

/** 解析后的标准行（详细设计 §4） */
export interface BillRow {
  source: BillSource;
  orderNo: string;
  time: number;
  direction: 'expense' | 'income' | 'neutral';
  /** 账单原始金额（分） */
  amountFen: number;
  /** 扣除退款后的金额（分） */
  netFen: number;
  counterparty: string;
  goods: string;
  /** 微信「交易类型」 */
  txType: string;
  /** 支付宝「交易分类」 */
  billCategory: string;
  status: string;
  /** 支付方式 / 收付款方式 */
  method: string;
  /** 商户单号 / 商家订单号 */
  merchantOrderNo: string;
  /** 已退款金额（分），仅原交易 */
  refundedFen: number;
  /** 退款行：是否在本文件中找到原交易 */
  refund?: 'matched' | 'unmatched';
  /** 解析阶段即可确定的跳过原因 */
  skip?: string;
}

export interface ParsedBill {
  source: BillSource;
  rows: BillRow[];
  start?: number;
  end?: number;
}

export class ImportError extends Error {}
