export type TxType = 'expense' | 'income' | 'transfer';
export type CategoryType = 'expense' | 'income';

/** 流水。金额单位：分 */
export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  categoryId?: string;
  accountId: string;
  toAccountId?: string;
  occurredAt: number;
  note?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  /** 1 = 本地有未同步到云端的修改 */
  dirty?: 0 | 1;
  /** 账单导入：来源、交易单号、导入时的金额（用于判断用户是否改过金额） */
  source?: 'alipay' | 'wechat';
  sourceOrderNo?: string;
  importedAmount?: number;
  /** 账单导入的原始字段，用于详情页展示 */
  meta?: TxMeta;
}

export interface TxMeta {
  counterparty?: string;
  goods?: string;
  method?: string;
  status?: string;
  merchantOrderNo?: string;
  /** 微信「交易类型」或支付宝「交易分类」 */
  billType?: string;
  refundedFen?: number;
  /** 导入时自动分到的分类，用于判断用户之后是否改过分类 */
  autoCategoryId?: string;
}

/** 参与云同步的记录都带这两个字段，由 db/tracking.ts 自动维护 */
interface Synced {
  updatedAt?: number;
  dirty?: 0 | 1;
}

export interface Category extends Synced {
  id: string;
  type: CategoryType;
  name: string;
  icon: string;
  color: string;
  parentId?: string;
  sort: number;
  hidden: boolean;
}

export type AccountKind = 'cash' | 'debit' | 'credit' | 'wechat' | 'alipay' | 'other';

export interface Account extends Synced {
  id: string;
  name: string;
  kind: AccountKind;
  initialBalance: number;
  sort: number;
  hidden: boolean;
}

export interface Budget extends Synced {
  id: string;
  month: string;
  categoryId?: string;
  amount: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

/** v1.0 只开放收支，转账留待后续版本 */
export interface TxInput {
  type: CategoryType;
  amount: number;
  categoryId: string;
  occurredAt: number;
  note?: string;
  accountId?: string;
  /** 交易对方、商品；undefined 表示不修改，空字符串表示清除 */
  counterparty?: string;
  goods?: string;
}
