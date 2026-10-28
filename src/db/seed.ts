import type { Category, CategoryType } from '@/domain/types';
import { db } from './schema';
import { markRemote } from './tracking';

export const DEFAULT_ACCOUNT_ID = 'default';

/**
 * 预置分类使用固定 id，这样多台设备、备份合并时不会产生重复分类。
 * [id, 类型, 名称, 图标, 颜色, 排序, 上级 id]
 */
type Preset = [string, CategoryType, string, string, string, number, string?];

const TOP: Preset[] = [
  ['exp-food', 'expense', '餐饮', '🍜', '#ff976a', 0],
  ['exp-traffic', 'expense', '交通', '🚇', '#1989fa', 1],
  ['exp-shopping', 'expense', '购物', '🛍️', '#ee0a24', 2],
  ['exp-housing', 'expense', '居住', '🏠', '#7232dd', 3],
  ['exp-fun', 'expense', '娱乐', '🎮', '#ff5fa2', 4],
  ['exp-medical', 'expense', '医疗', '💊', '#07c160', 5],
  ['exp-study', 'expense', '学习', '📚', '#00a0e9', 6],
  ['exp-gift', 'expense', '人情', '🎁', '#f2826a', 7],
  ['exp-phone', 'expense', '通讯', '📱', '#576b95', 8],
  // v1.4 新增的一级分类排在「其他」之前
  ['exp-insurance', 'expense', '保险', '🛡️', '#3f8cff', 8.1],
  ['exp-pet', 'expense', '宠物', '🐱', '#ffb300', 8.2],
  ['exp-beauty', 'expense', '美容美发', '💇', '#e46ccf', 8.3],
  ['exp-other', 'expense', '其他', '📦', '#969799', 9],
  ['inc-salary', 'income', '工资', '💰', '#07c160', 10],
  ['inc-bonus', 'income', '奖金', '🏆', '#ff976a', 11],
  ['inc-invest', 'income', '理财', '📈', '#1989fa', 12],
  ['inc-redpacket', 'income', '红包', '🧧', '#ee0a24', 13],
  ['inc-refund', 'income', '退款', '↩️', '#00a0e9', 13.5],
  ['inc-other', 'income', '其他', '📦', '#969799', 14],
];

/** 子分类：[父 id, 英文后缀, 名称, 图标] */
const SUB: [string, string, string, string][] = [
  ['exp-food', 'breakfast', '早餐', '🥟'],
  ['exp-food', 'meal', '正餐', '🍱'],
  ['exp-food', 'takeout', '外卖', '🛵'],
  ['exp-food', 'drink', '饮品咖啡', '☕'],
  ['exp-food', 'snack', '零食水果', '🍎'],
  ['exp-food', 'grocery', '买菜', '🥬'],
  ['exp-traffic', 'taxi', '打车', '🚕'],
  ['exp-traffic', 'transit', '地铁公交', '🚌'],
  ['exp-traffic', 'train', '火车飞机', '🚄'],
  ['exp-traffic', 'fuel', '加油', '⛽'],
  ['exp-traffic', 'charge', '充电', '🔌'],
  ['exp-traffic', 'parking', '停车过路', '🅿️'],
  ['exp-traffic', 'car', '养车维修', '🔧'],
  ['exp-shopping', 'daily', '日用百货', '🧻'],
  ['exp-shopping', 'digital', '数码电器', '💻'],
  ['exp-shopping', 'clothes', '服饰鞋包', '👕'],
  ['exp-shopping', 'cosmetics', '美妆个护', '💄'],
  ['exp-shopping', 'home', '家居家装', '🛋️'],
  ['exp-housing', 'rent', '房租房贷', '🔑'],
  ['exp-housing', 'property', '物业', '🏢'],
  ['exp-housing', 'utility', '水电燃气', '💡'],
  ['exp-housing', 'broadband', '宽带', '🌐'],
  ['exp-phone', 'bill', '话费流量', '📶'],
  ['exp-fun', 'movie', '电影演出', '🎬'],
  ['exp-fun', 'game', '游戏', '🕹️'],
  ['exp-fun', 'member', '会员订阅', '🎫'],
  ['exp-fun', 'sport', '运动健身', '🏋️'],
  ['exp-fun', 'travel', '旅行', '🏖️'],
  ['exp-medical', 'clinic', '看病', '🏥'],
  ['exp-medical', 'drug', '买药', '💊'],
  ['exp-medical', 'checkup', '体检', '🩺'],
  ['exp-study', 'book', '书籍', '📖'],
  ['exp-study', 'course', '课程', '🎓'],
  ['exp-study', 'exam', '考试', '📝'],
  ['exp-gift', 'redpacket', '红包', '🧧'],
  ['exp-gift', 'transfer', '转账', '💸'],
  ['exp-gift', 'present', '礼物', '🎀'],
  ['exp-gift', 'treat', '请客', '🍻'],
  ['exp-insurance', 'accident', '意外险', '🦺'],
  ['exp-insurance', 'health', '医疗险', '🏥'],
  ['exp-insurance', 'car', '车险', '🚗'],
  ['exp-insurance', 'life', '寿险', '🛡️'],
  ['exp-pet', 'supplies', '宠物用品', '🦴'],
  ['exp-pet', 'vet', '宠物医疗', '💉'],
];

const PRESET: Preset[] = [
  ...TOP,
  ...SUB.map(([parent, key, name, icon], i): Preset => {
    const p = TOP.find((t) => t[0] === parent)!;
    return [`${parent}-${key}`, p[1], name, icon, p[4], i, parent];
  }),
];

export const PALETTE = [
  '#ff976a', '#1989fa', '#ee0a24', '#7232dd', '#ff5fa2',
  '#07c160', '#00a0e9', '#f2826a', '#576b95', '#ffb300',
];

export function presetCategories(): Category[] {
  return PRESET.map(([id, type, name, icon, color, sort, parentId]) => ({
    id, type, name, icon, color, sort, hidden: false,
    ...(parentId ? { parentId } : {}),
    // updatedAt = 0：新设备推送预置项时不会覆盖云端已修改过的版本
    updatedAt: 0,
  }));
}

/**
 * 按 id 补齐缺失的预置分类和默认账户（老用户升级后也能拿到新分类），已存在的不覆盖。
 * 预置数据不标记为待同步（各设备自行生成），用户修改后才上传；云端已有的版本会在拉取时覆盖它们。
 */
export async function ensureSeed(): Promise<void> {
  await db.transaction('rw', db.categories, db.accounts, async (tx) => {
    markRemote(tx);
    const presets = presetCategories();
    const existing = await db.categories.bulkGet(presets.map((c) => c.id));
    const missing = presets.filter((_, i) => !existing[i]);
    if (missing.length) await db.categories.bulkAdd(missing);
    if (!(await db.accounts.get(DEFAULT_ACCOUNT_ID))) {
      await db.accounts.add({
        id: DEFAULT_ACCOUNT_ID, name: '默认账户', kind: 'cash', initialBalance: 0, sort: 0, hidden: false, updatedAt: 0,
      });
    }
  });
}
