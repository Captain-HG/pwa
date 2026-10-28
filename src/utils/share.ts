/**
 * 手机上调起系统分享面板（可存到「文件」/ iCloud 云盘），桌面浏览器直接下载。
 * 返回 false 表示用户取消了分享。
 */
export async function shareOrDownload(blob: Blob, filename: string): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type });
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false;
      // 分享失败时回退到下载
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
