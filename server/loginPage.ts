/** 登录页：独立的静态 HTML，未登录时不下发应用代码 */
export function loginPage(): Response {
  return new Response(HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    },
  });
}

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="记账" />
<meta name="theme-color" content="#f7f8fa" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<title>登录 · 我的记账</title>
<style>
  :root { --bg:#f7f8fa; --card:#fff; --text:#323233; --sub:#969799; --border:#ebedf0; --primary:#1989fa; --danger:#ee0a24; }
  @media (prefers-color-scheme: dark) { :root { --bg:#000; --card:#1c1c1e; --text:#f5f5f5; --sub:#8e8e93; --border:#2c2c2e; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--text);
         font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; padding:24px; }
  .box { width:100%; max-width:360px; }
  .logo { width:64px; height:64px; border-radius:16px; background:var(--primary); color:#fff; font-size:34px; font-weight:700;
          display:flex; align-items:center; justify-content:center; margin:0 auto 12px; }
  h1 { text-align:center; font-size:20px; margin:0 0 28px; }
  form { background:var(--card); border-radius:14px; padding:8px 16px 16px; }
  label { display:block; font-size:13px; color:var(--sub); margin:12px 0 6px; }
  input { width:100%; font-size:16px; padding:11px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); outline:none; }
  input:focus { border-color:var(--primary); }
  button { width:100%; margin-top:20px; padding:12px; border:0; border-radius:22px; background:var(--primary); color:#fff; font-size:16px; font-weight:600; }
  button:disabled { opacity:.6; }
  .err { color:var(--danger); font-size:13px; min-height:18px; margin-top:12px; text-align:center; }
</style>
</head>
<body>
<div class="box">
  <div class="logo">账</div>
  <h1>我的记账</h1>
  <form id="f">
    <label for="u">用户名</label>
    <input id="u" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required />
    <label for="p">密码</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required />
    <button id="b" type="submit">登录</button>
    <div class="err" id="e"></div>
  </form>
</div>
<script>
  const f = document.getElementById('f'), b = document.getElementById('b'), e = document.getElementById('e');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    b.disabled = true; b.textContent = '登录中…'; e.textContent = '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: f.username.value, password: f.password.value }),
      });
      if (res.ok) { location.replace('/'); return; }
      const data = await res.json().catch(() => ({}));
      e.textContent = data.error || '登录失败（' + res.status + '）';
    } catch {
      e.textContent = '网络连接失败，请稍后再试';
    }
    b.disabled = false; b.textContent = '登录';
  });
</script>
</body>
</html>`;
