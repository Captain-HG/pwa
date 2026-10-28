import { rootId } from '@/domain/category';
import type { Category } from '@/domain/types';
import type { BillRow } from './types';

/** 用户分类规则（同步实体 rules） */
export interface Rule {
  id: string;
  keyword: string;
  categoryId: string;
  updatedAt?: number;
  dirty?: 0 | 1;
}

/** 支付宝「交易分类」→ 本应用分类（可能是一级或子分类） */
const ALIPAY_CATEGORY: Record<string, string> = {
  餐饮美食: 'exp-food',
  交通出行: 'exp-traffic',
  爱车养车: 'exp-traffic-car',
  日用百货: 'exp-shopping-daily',
  数码电器: 'exp-shopping-digital',
  家居家装: 'exp-shopping-home',
  服饰装扮: 'exp-shopping-clothes',
  母婴亲子: 'exp-shopping',
  运动户外: 'exp-fun-sport',
  美容美发: 'exp-beauty',
  宠物: 'exp-pet',
  保险: 'exp-insurance',
  医疗健康: 'exp-medical',
  住房物业: 'exp-housing',
  生活服务: 'exp-housing',
  充值缴费: 'exp-phone',
  通讯: 'exp-phone',
  文化休闲: 'exp-fun',
  娱乐: 'exp-fun',
  酒店旅游: 'exp-fun-travel',
  教育培训: 'exp-study',
  转账红包: 'exp-gift',
  亲友代付: 'exp-gift',
};

/**
 * 内置关键词 → 分类（尽量到子分类）。匹配时取命中关键词最长的一条，
 * 例如「猫眼」（电影）优先于「猫」（宠物），「美团外卖」优先于「美团」。
 */
const KEYWORDS: [string, string[]][] = [
  ['exp-food-takeout', ['外卖', '饿了么', '美团外卖']],
  ['exp-food-drink', ['咖啡', '瑞幸', '星巴克', '奶茶', '蜜雪', '喜茶', '茶百道', '库迪', '茶饮']],
  ['exp-food-breakfast', ['早餐', '早点', '包子']],
  ['exp-food-grocery', ['买菜', '菜市场', '生鲜', '叮咚', '朴朴']],
  ['exp-food-snack', ['零食', '水果', '烘焙', '面包']],
  ['exp-food-meal', ['肯德基', '麦当劳', '餐厅', '饭店', '餐饮', '快餐', '火锅', '面馆', '粉店', '米粉', '炒饭']],
  ['exp-food', ['美团', '大众点评']],
  ['exp-traffic-charge', ['充电', '特来电', '新电途', '享充', '星星充电', '快电', '电桩', '桩小哥']],
  ['exp-traffic-taxi', ['滴滴', '高德打车', '打车', '曹操出行', 'T3出行', '出租车']],
  ['exp-traffic-transit', ['地铁', '公交', '乘车码', '轨道交通']],
  ['exp-traffic-train', ['铁路', '12306', '航空', '机票', '高铁']],
  ['exp-traffic-fuel', ['加油', '中国石化', '中国石油', '中石化', '中石油']],
  ['exp-traffic-parking', ['停车', 'ETC', '高速', '过路费']],
  ['exp-traffic-car', ['洗车', '保养', '汽车维修', '汽修', '轮胎']],
  ['exp-insurance-accident', ['意外险', '综合意外', '意外']],
  ['exp-insurance-health', ['医疗险', '百万医疗', '健康险', '重疾']],
  ['exp-insurance-car', ['车险', '交强险']],
  ['exp-insurance-life', ['寿险']],
  ['exp-insurance', ['保险', '保费']],
  ['exp-medical-drug', ['药房', '药店', '大药', '医药']],
  ['exp-medical-clinic', ['医院', '诊所', '门诊', '卫生院']],
  ['exp-medical-checkup', ['体检']],
  ['exp-fun-movie', ['电影', '猫眼', '淘票票', '演出', '影城']],
  ['exp-fun-game', ['游戏', 'steam', '网易游戏', '腾讯游戏']],
  ['exp-fun-member', ['会员', '爱奇艺', '优酷', '腾讯视频', '哔哩哔哩', 'bilibili', '网盘', 'QQ音乐', '网易云音乐']],
  ['exp-fun-sport', ['健身', '运动', '球馆', '游泳']],
  ['exp-fun-travel', ['酒店', '景区', '门票', '旅行', '携程', '飞猪']],
  ['exp-pet-vet', ['宠物医院', '动物医院']],
  ['exp-pet-supplies', ['宠物', '猫粮', '狗粮', '猫砂']],
  ['exp-beauty', ['美发', '理发', '美容', '美甲', '发型']],
  ['exp-shopping-digital', ['数码', '电器', '手机', '耳机', '电脑']],
  ['exp-shopping-cosmetics', ['美妆', '个护', '化妆品', '面膜']],
  ['exp-shopping-clothes', ['服饰', '服装', '鞋', '女装', '男装']],
  ['exp-shopping-home', ['家居', '家装', '家具', '五金']],
  ['exp-shopping-daily', ['超市', '便利店', '盒马', '商行', '百货', '日用', '小卖部']],
  ['exp-shopping', ['淘宝', '天猫', '京东', '拼多多', '唯品会']],
  ['exp-housing-utility', ['电费', '水费', '燃气', '国家电网', '自来水']],
  ['exp-housing-property', ['物业']],
  ['exp-housing-rent', ['房租', '租金', '房贷']],
  ['exp-housing-broadband', ['宽带']],
  ['exp-phone-bill', ['中国移动', '中国联通', '中国电信', '话费', '流量']],
  ['exp-study-book', ['书店', '图书', '当当']],
  ['exp-study-course', ['课程', '培训', '网课']],
];

const OTHER = { expense: 'exp-other', income: 'inc-other' } as const;
export const OTHER_IDS = new Set<string>([OTHER.expense, OTHER.income]);

export function rowText(row: Pick<BillRow, 'counterparty' | 'goods'>): string {
  return `${row.counterparty} ${row.goods}`.toLowerCase();
}

/** 命中关键词最长的分类 */
function byKeyword(text: string, valid: (id?: string) => string | undefined): string | undefined {
  let best: { id: string; len: number } | undefined;
  for (const [id, words] of KEYWORDS) {
    if (!valid(id)) continue;
    for (const w of words) {
      if (w.length > (best?.len ?? 0) && text.includes(w.toLowerCase())) best = { id, len: w.length };
    }
  }
  return best?.id;
}

/**
 * 分类优先级：用户规则 → 关键词（细分到子分类）与支付宝自带分类 → 其他。
 * 支付宝自带分类给出一级分类时，关键词只能在同一个一级分类下细化，避免误判。
 */
export function classify(row: BillRow, rules: Rule[], categories: Map<string, Category>): string {
  const type = row.direction === 'income' ? 'income' : 'expense';
  const valid = (id?: string) => (id && categories.get(id)?.type === type ? id : undefined);
  const text = rowText(row);

  const rule = [...rules]
    .sort((a, b) => b.keyword.length - a.keyword.length)
    .find((r) => r.keyword && text.includes(r.keyword.toLowerCase()) && valid(r.categoryId));
  if (rule) return rule.categoryId;

  if (type === 'income') {
    if (row.refund) return valid('inc-refund') ?? OTHER.income;
    if (/红包|转账/.test(row.txType + row.billCategory)) return valid('inc-redpacket') ?? OTHER.income;
    return OTHER.income;
  }

  const keyword = byKeyword(text, valid);
  const bill = valid(ALIPAY_CATEGORY[row.billCategory]);
  if (bill) {
    const billIsTop = !categories.get(bill)?.parentId;
    const sameRoot = keyword && rootId(keyword, categories) === rootId(bill, categories);
    return billIsTop && sameRoot ? keyword! : bill;
  }
  if (keyword) return keyword;
  if (/转账/.test(row.txType)) return valid('exp-gift-transfer') ?? valid('exp-gift') ?? OTHER.expense;
  if (/微信红包/.test(row.txType)) return valid('exp-gift-redpacket') ?? valid('exp-gift') ?? OTHER.expense;
  return OTHER.expense;
}

/** 同一关键词在各设备上生成相同 id（FNV-1a），避免规则重复 */
export function ruleId(keyword: string): string {
  let h = 0x811c9dc5;
  for (const ch of keyword.toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `rule-${h.toString(16).padStart(8, '0')}`;
}
