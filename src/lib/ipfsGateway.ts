/**
 * IPFS 网关工具 — 支持自动重试切换
 *
 * 网关优先级：
 * 1. https://ipfs.io/ipfs/
 * 2. https://gateway.pinata.cloud/ipfs/
 * 3. https://cloudflare-ipfs.com/ipfs/
 *
 * 使用方式：
 *   const url = await resolveIpfsUrl(cid)        // 异步，返回第一个可达的 URL
 *   const data = await fetchJsonFromIpfs(cid)     // 自动重试切换网关
 *   const urls = getImageUrls(cid, path)          // 同步，返回所有网关 URL 数组（用于 img 标签 fallback）
 */

const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://gateway.pinata.cloud/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
];

/**
 * 尝试从多个网关获取 IPFS 数据，返回第一个成功的响应
 * 也兼容 w3s.link（旧数据）
 */
const FALLBACK_GATEWAYS = [...IPFS_GATEWAYS, "https://w3s.link/ipfs"];

/** 单个请求超时（毫秒） */
const FETCH_TIMEOUT = 10000;

/**
 * 带超时的 fetch 封装
 */
async function fetchWithTimeout(url: string, timeout = FETCH_TIMEOUT): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeout) });
}

/**
 * 从 IPFS 获取 JSON 数据（自动重试切换网关）
 *
 * 优化说明：
 * - 遍历网关时，对每个网关先尝试带 path 的 URL，若失败则尝试不带 path 的直接 CID 获取
 * - 如果某个网关的两次尝试都失败，才切换到下一个网关
 * - 避免了对同一个网关发起重复请求导致的重试效率低下
 */
export async function fetchJsonFromIpfs(
  cid: string,
  path?: string
): Promise<Record<string, unknown> | null> {
  const subpath = path ? `/${path}` : "/metadata.json";
  let lastError: string | null = null;

  for (const gateway of FALLBACK_GATEWAYS) {
    try {
      // 尝试带 path 的 URL
      const url = `${gateway}/${cid}${subpath}`;
      const res = await fetchWithTimeout(url);

      if (res.ok) {
        return await res.json();
      }

      // 如果带 path 失败（例如 404），尝试直接 CID 获取
      const fallbackUrl = `${gateway}/${cid}`;
      const fallbackRes = await fetchWithTimeout(fallbackUrl);
      if (fallbackRes.ok) {
        return await fallbackRes.json();
      }

      lastError = `HTTP ${res.status} (path: ${subpath}), fallback HTTP ${fallbackRes.status}`;
      continue; // 切换到下一个网关
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue; // 切换到下一个网关
    }
  }

  console.warn(`[IPFS] 所有网关均获取失败: ${cid} - ${lastError}`);
  return null;
}

/**
 * 解析 IPFS CID 为可访问的 URL（自动选择可用网关）
 * 异步：会尝试第一个网关，如果失败则依次切换
 * 返回一个可用的 URL 字符串
 */
export async function resolveIpfsUrl(cid: string, path?: string): Promise<string> {
  for (const gateway of FALLBACK_GATEWAYS) {
    try {
      const url = path
        ? `${gateway}/${cid}/${path}`
        : `${gateway}/${cid}`;
      const res = await fetchWithTimeout(url, 5000);
      if (res.ok || res.status === 404) {
        return url; // 404 也返回 URL，让调用方处理
      }
    } catch {
      continue; // 尝试下一个网关
    }
  }
  // 所有网关都失败，返回第一个网关作为兜底
  return IPFS_GATEWAYS[0] + (path ? `/${cid}/${path}` : `/${cid}`);
}

/**
 * 获取可用的图片 URL（带 fallback 列表）
 * 返回一个 url 数组，依次为各网关的图片地址
 * 用于 <img> 标签的 onError 切换
 */
export function getImageUrls(cid: string, path?: string): string[] {
  return FALLBACK_GATEWAYS.map((g) =>
    path ? `${g}/${cid}/${path}` : `${g}/${cid}`
  );
}

/**
 * 为 <img> 标签生成 onError 处理函数，实现网关自动 fallback
 *
 * 用法：
 *   <img
 *     src={getImageUrls(cid)[0]}
 *     onError={createImgFallback(getImageUrls(cid))}
 *   />
 *
 * 当图片加载失败时，会自动尝试下一个网关的 URL，
 * 直到所有网关都失败为止。
 */
export function createImgFallback(urls: string[]) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget;
    const currentSrc = target.currentSrc || target.src;
    const currentIndex = urls.findIndex((u) => {
      // 比對 URL 末尾是否相同（CID + 路径部分）
      const uPart = u.split('/ipfs/')[1] || u;
      return currentSrc.includes(uPart);
    });
    const nextIndex = currentIndex + 1;
    if (nextIndex < urls.length) {
      target.src = urls[nextIndex];
    } else {
      // 所有网关都失败，显示占位图
      target.style.display = 'none';
      const parent = target.parentElement;
      if (parent) {
        // 添加一个占位文字提示
        const placeholder = document.createElement('div');
        placeholder.className = 'flex items-center justify-center h-full text-[#c4a67a] text-xs p-4 text-center';
        placeholder.textContent = '🖼️ 图片加载失败';
        parent.appendChild(placeholder);
      }
    }
  };
}