const scope = self.registration.scope;
const prefix = `coreading:${scope}:`;
const shellVersion = 'r26';
const shellCache = prefix + 'shell-v01-' + shellVersion;
const dataCache = prefix + 'live-v1';
const avatarCache = prefix + 'family-v1';
const memoryCache = prefix + 'memories-v1';
const url = (path) => new URL(path,scope).href;
const avatarPrefix = url('./family/');
const memoryPrefix = url('./memories/');
const memoryIndex = url('./memories.json');
const legacyAvatarPrefix = url('./assets/celebration-avatars/');
const shell = new Set([
  './','./index.html','./style.css','./app.js',
  './themes/starmap/theme.css','./themes/starmap/theme.json','./themes/starmap/assets/Inter-Variable.ttf','./assets/icon-192.png',
].map(url));
const pages = new Set([url('./'),url('./index.html')]);
const live = new Set([url('./live.json'),url('./sample/live.json')]);
const copy = url('./content.json');

self.addEventListener('install',(event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellCache);
    await cache.addAll([...shell].map((address) => new Request(address,{cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',(event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // r22 had no controllerchange handler for shell updates.
    const legacyWindows = shellVersion === 'r23' && keys.includes(prefix + 'shell-v01-r22')
      ? (await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter((client) => {
          const address = new URL(client.url);
          address.search = '';
          address.hash = '';
          return pages.has(address.href);
        }) : [];
    await Promise.all(keys.filter((key) => key.startsWith(prefix) &&
      ![shellCache,dataCache,avatarCache,memoryCache].includes(key)).map((key) => caches.delete(key)));
    const data = await caches.open(dataCache);
    const oldAvatars = (await data.keys()).filter((request) => request.url.startsWith(legacyAvatarPrefix) ||
      request.url === url('./assets/family.png') || request.url === url('./assets/reader.png'));
    await Promise.all(oldAvatars.map((request) => data.delete(request)));
    await self.clients.claim();
    for (const client of legacyWindows) void client.navigate(client.url).catch(() => {});
  })());
});

self.addEventListener('message',(event) => {
  if (event.data === 'coreading:shell-version') event.ports[0]?.postMessage(shellVersion);
});

function liveKey(address) {
  const key = new URL(address);
  key.searchParams.delete('t');
  return live.has(key.href) ? key.href : null;
}

async function networkFirst(request, cacheName = dataCache) {
  const cache = await caches.open(cacheName).catch(() => null);
  const address = new URL(request.url);
  if (cacheName === avatarCache) address.searchParams.delete('retry');
  const key = liveKey(request.url) || address.href;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(),[avatarCache,memoryCache].includes(cacheName) ? 12000 : 4500);
  try {
    const response = await fetch(request,{cache:'no-store',signal:abort.signal});
    if (!response.ok) throw new Error('Resource unavailable');
    if (request.url === copy || liveKey(request.url)) {
      const data = await response.clone().json();
      const valid = data?.schema_version === 1 && (request.url === copy
        ? data.site && data.defaults?.minor && data.defaults?.major && data.milestones && Array.isArray(data.conversions)
        : data.today && data.lifetime && data.streak && data.next && data.week && data.month && data.modules &&
          data.levels_by_year && Array.isArray(data.roadmap) && Array.isArray(data.milestones_reached) &&
          Array.isArray(data.cumulative_by_month));
      if (!valid) throw new Error('Invalid data');
    }
    await cache?.put(key,response.clone()).catch(() => {});
    return response;
  } catch {
    const saved = await cache?.match(key).catch(() => null);
    if (!saved) return new Response(null,{status:503});
    const headers = new Headers(saved.headers);
    headers.set('X-Coreading-Source','cache');
    return new Response(saved.body,{headers});
  } finally {
    clearTimeout(timer);
  }
}
async function versionedMemory(request, address) {
  const retry = address.searchParams.has('retry');
  address.searchParams.delete('retry');
  const key = address.href;
  const cache = await caches.open(memoryCache).catch(() => null);
  if (!retry) {
    const saved = await cache?.match(key).catch(() => null);
    if (saved) return saved;
  }
  try {
    const response = await fetch(request,{cache:'no-store'});
    if (!response.ok || response.status === 206) return response;
    // Cache.put resolves after the complete body is available.
    await cache?.put(key,response.clone()).catch(() => {});
    return response;
  } catch {
    return new Response(null,{status:503});
  }
}

self.addEventListener('fetch',(event) => {
  if (event.request.method !== 'GET') return;
  const address = new URL(event.request.url);
  if (!address.href.startsWith(scope)) return;
  if (event.request.mode === 'navigate') {
    address.search = '';
    address.hash = '';
  }
  if (shell.has(address.href)) {
    const key = event.request.mode === 'navigate' && pages.has(address.href) ? url('./') : address.href;
    event.respondWith((async () => (await (await caches.open(shellCache)).match(key)) || fetch(event.request))());
  } else if (address.href.startsWith(avatarPrefix)) {
    event.respondWith((async () => {
      if (address.searchParams.has('v') && !address.searchParams.has('retry')) {
        const cached = await caches.open(avatarCache).then((cache) => cache.match(address.href)).catch(() => null);
        if (cached) return cached;
      }
      return networkFirst(event.request,avatarCache);
    })());
  } else if (address.href.startsWith(memoryPrefix)) {
    event.respondWith(address.searchParams.has('v')
      ? versionedMemory(event.request,address)
      : networkFirst(event.request,memoryCache));
  } else if (liveKey(address.href) || address.href === copy || address.href === memoryIndex ||
    /^(themes\/|assets\/|manifest\.webmanifest$)/.test(address.href.slice(scope.length))) {
    event.respondWith(networkFirst(event.request));
  }
});
