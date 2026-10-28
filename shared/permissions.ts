/** 权限清单与页面权限，前端与服务端共用 */

export interface PermissionDef {
  key: string;
  name: string;
  group: string;
  /** 勾选时自动带上的前置权限 */
  requires?: string[];
}

export const PERMISSIONS: PermissionDef[] = [
  { key: 'ledger.view', name: '查看明细', group: '记账' },
  { key: 'ledger.edit', name: '记账（新增 / 修改 / 删除）', group: '记账', requires: ['ledger.view'] },
  { key: 'stats.view', name: '查看统计', group: '记账' },
  { key: 'bill.import', name: '导入支付宝 / 微信账单', group: '记账', requires: ['ledger.edit'] },
  { key: 'category.manage', name: '分类管理', group: '设置' },
  { key: 'backup.export', name: '导出备份', group: '设置' },
  { key: 'backup.import', name: '导入备份 / 清空流水', group: '设置', requires: ['ledger.edit'] },
  { key: 'admin.users', name: '用户管理', group: '系统管理' },
  { key: 'admin.roles', name: '角色与权限', group: '系统管理' },
];

/** 全部权限（仅预置的管理员角色使用） */
export const ALL = '*';
export const ADMIN_ROLE_ID = 1;
export const MEMBER_ROLE_ID = 2;

const KNOWN = new Map(PERMISSIONS.map((p) => [p.key, p]));

export function can(perms: readonly string[] | undefined, key: string): boolean {
  return !!perms && (perms.includes(ALL) || perms.includes(key));
}

export function canAny(perms: readonly string[] | undefined, keys: readonly string[]): boolean {
  return keys.length === 0 || keys.some((k) => can(perms, k));
}

/** 去掉未知项和 '*'，补齐前置权限，按清单顺序排列 */
export function normalize(perms: readonly unknown[]): string[] {
  const set = new Set<string>();
  const add = (k: string) => {
    const def = KNOWN.get(k);
    if (!def || set.has(k)) return;
    set.add(k);
    def.requires?.forEach(add);
  };
  perms.forEach((p) => typeof p === 'string' && add(p));
  return PERMISSIONS.map((p) => p.key).filter((k) => set.has(k));
}

/** 路由需要的权限（满足任一即可）；未列出的路由所有登录用户可访问 */
export const ROUTE_PERMISSIONS: Record<string, string[]> = {
  '/': ['ledger.view'],
  '/add': ['ledger.edit'],
  '/edit': ['ledger.edit'],
  '/stats': ['stats.view'],
  '/tx': ['ledger.view'],
  '/list': ['ledger.view'],
  '/categories': ['category.manage'],
  '/backup': ['backup.export', 'backup.import'],
  '/import': ['bill.import'],
  '/admin/users': ['admin.users'],
  '/admin/roles': ['admin.roles'],
};

export function routePermissions(path: string): string[] {
  if (ROUTE_PERMISSIONS[path]) return ROUTE_PERMISSIONS[path];
  const prefix = Object.keys(ROUTE_PERMISSIONS).find((p) => p !== '/' && path.startsWith(p + '/'));
  return prefix ? ROUTE_PERMISSIONS[prefix] : [];
}

/** 同步实体需要的写权限（满足任一即可） */
export const PUSH_PERMISSIONS: Record<string, string[]> = {
  transactions: ['ledger.edit'],
  accounts: ['ledger.edit'],
  budgets: ['ledger.edit'],
  categories: ['category.manage', 'ledger.edit'],
  rules: ['bill.import', 'category.manage'],
};

export const PULL_PERMISSIONS = ['ledger.view', 'stats.view'];
