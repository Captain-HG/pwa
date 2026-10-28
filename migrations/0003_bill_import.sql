-- v1.3：账单导入权限。给「普通成员」角色追加 bill.import（已有则不重复添加）
UPDATE roles
   SET permissions = json_insert(permissions, '$[#]', 'bill.import'),
       updated_at  = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE id = 2
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'bill.import');
