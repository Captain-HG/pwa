"""创建或重置登录账号。

用法：
  python scripts/create_user.py --remote        # 写入云端 D1（npm run user:create）
  python scripts/create_user.py --dev           # 写入本地开发库 .dev-data/ledger.sqlite
  加 --admin 设为管理员（新用户默认为普通成员）。日常增加用户请用应用内的「用户管理」页面。

密码在本机计算 PBKDF2 哈希后写入，原文不落盘、不出现在命令行参数中。
同一用户名再次执行即重置密码，并让该用户所有设备下线。
"""
from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_NAME = "ledger"
DEV_DB = ROOT / ".dev-data" / "ledger.sqlite"
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")
MIN_PASSWORD = 8


def hash_password(password: str, iterations: int) -> str:
    """与 server/crypto.ts 的 hashPassword 格式一致"""
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
    return f"pbkdf2_sha256${iterations}${b64(salt)}${b64(digest)}"


def read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\r\n")
    while True:
        p1 = getpass.getpass("密码（输入时不显示）：")
        if len(p1) < MIN_PASSWORD:
            print(f"密码至少 {MIN_PASSWORD} 位，建议 12 位以上")
            continue
        if p1 != getpass.getpass("再次输入密码："):
            print("两次输入不一致，请重新输入")
            continue
        return p1


ADMIN_ROLE_ID = 1
MEMBER_ROLE_ID = 2


def build_statements(username: str, password_hash: str, now: int, admin: bool) -> list[tuple[str, tuple]]:
    role_id = ADMIN_ROLE_ID if admin else MEMBER_ROLE_ID
    # 已存在的用户：重置密码并启用；只有指定 --admin 时才改变角色
    on_conflict_role = ", role_id = excluded.role_id" if admin else ""
    return [
        (
            "INSERT INTO users (username, password_hash, role_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, "
            f"updated_at = excluded.updated_at, disabled = 0{on_conflict_role}",
            (username, password_hash, role_id, now, now),
        ),
        ("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)", (username,)),
        ("DELETE FROM login_attempts WHERE key = ?", (f"user:{username.lower()}",)),
    ]


def write_dev(statements: list[tuple[str, tuple]]) -> None:
    if not DEV_DB.exists():
        sys.exit(f"未找到 {DEV_DB}，请先运行 npm run dev 初始化本地开发库")
    conn = sqlite3.connect(DEV_DB)
    try:
        with conn:  # 事务：失败自动回滚
            for sql, params in statements:
                conn.execute(sql, params)
    finally:
        conn.close()


def sql_literal(v) -> str:
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def write_wrangler(statements: list[tuple[str, tuple]], remote: bool) -> None:
    # wrangler d1 execute 只接受 SQL 文本；参数已校验（用户名白名单、哈希为 base64），这里安全地内联
    lines = []
    for sql, params in statements:
        for p in params:
            sql = sql.replace("?", sql_literal(p), 1)
        lines.append(sql + ";")
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        sys.exit("找不到 npx，请确认已安装 Node.js")
    fd, tmp = tempfile.mkstemp(suffix=".sql")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        cmd = [npx, "wrangler", "d1", "execute", DB_NAME, "--remote" if remote else "--local", "--file", tmp]
        result = subprocess.run(cmd, cwd=ROOT)
        if result.returncode != 0:
            sys.exit("写入失败，请检查 wrangler 是否已登录（npm run cf:whoami）以及是否已建表（npm run db:migrate:remote）")
    finally:
        os.remove(tmp)


def main() -> None:
    ap = argparse.ArgumentParser(description="创建或重置记账应用的登录账号")
    target = ap.add_mutually_exclusive_group()
    target.add_argument("--remote", action="store_true", help="写入云端 D1（默认）")
    target.add_argument("--local", action="store_true", help="写入 wrangler 本地 D1")
    target.add_argument("--dev", action="store_true", help="写入 npm run dev 使用的本地开发库")
    ap.add_argument("--username")
    ap.add_argument("--admin", action="store_true", help="设为管理员（新用户默认为普通成员；已有用户加此参数会提升为管理员）")
    ap.add_argument("--password-stdin", action="store_true", help="从标准输入读取密码（自动化测试用）")
    ap.add_argument("--iterations", type=int, default=100_000, help="PBKDF2 迭代次数，默认 100000（Workers 上限）")
    args = ap.parse_args()

    if not 1_000 <= args.iterations <= 100_000:
        sys.exit("迭代次数需在 1000–100000 之间")

    username = args.username or input("用户名（字母、数字、_ . -）：").strip()
    if not USERNAME_RE.match(username):
        sys.exit("用户名只能包含字母、数字、_ . -，长度 1–32")
    password = read_password(args.password_stdin)
    if len(password) < MIN_PASSWORD:
        sys.exit(f"密码至少 {MIN_PASSWORD} 位")

    statements = build_statements(username, hash_password(password, args.iterations), int(time.time() * 1000), args.admin)
    if args.dev:
        write_dev(statements)
        where = "本地开发库"
    else:
        write_wrangler(statements, remote=not args.local)
        where = "本地 D1" if args.local else "云端 D1"
    role = "管理员" if args.admin else "普通成员（已有用户保持原角色）"
    print(f"已在{where}中创建 / 重置账号：{username}，角色：{role}（该账号已登录的设备均已下线）")


if __name__ == "__main__":
    main()
