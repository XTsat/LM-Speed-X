/* LM Speed X — Service Worker
 * 提供离线能力:PWA 应用壳(页面 HTML)与静态资源缓存。
 * 策略:
 *  - 导航请求:网络优先(network-first),断网时回退到已缓存的页面
 *  - 静态资源(JS/CSS/字体/图片):stale-while-revalidate,先取缓存再后台更新
 *  - API / RSC / Next Image 请求:永不拦截,始终走网络(避免过期数据)
 */
const CACHE_NAME = 'lm-speed-x-v1'
const APP_SHELL = [
  '/',
  '/en',
  '/zh-CN',
  '/manifest.json',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
]

/* 安装:预缓存应用壳(页面 HTML 与图标) */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

/* 激活:清理旧版本缓存,立即接管页面 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 仅处理同源 GET 请求
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // API 请求:始终走网络,绝不缓存(测速 / 模型列表等需实时数据)
  if (url.pathname.startsWith('/api/')) return

  // App Router 数据请求(RSC 预取载荷)与 Next 图片优化端点:放行
  if (url.searchParams.has('_rsc') || url.pathname.startsWith('/_next/image')) return

  // 页面导航:网络优先,断网回退到缓存的壳页面
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => offlineShell(request)),
    )
    return
  }

  // 静态资源:先取缓存,后台用网络更新
  if (isStaticAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(request))
  }
  // 其余请求不拦截,直接走网络
})

function isStaticAsset(request, url) {
  const destination = request.destination
  return (
    destination === 'script' ||
    destination === 'style' ||
    destination === 'font' ||
    destination === 'image' ||
    url.pathname.startsWith('/_next/static/')
  )
}

/* 断网回退:先匹配同 URL 缓存,再回退到根页面(经 middleware 会重定向到默认语言) */
async function offlineShell(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const root = await caches.match('/')
  if (root) return root
  return fetch(request)
}

/* stale-while-revalidate:优先返回缓存,同时后台请求网络更新缓存 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone()
        cache.put(request, copy)
      }
      return response
    })
    .catch(() => cached)
  return cached || network
}
