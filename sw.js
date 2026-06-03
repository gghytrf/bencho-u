/* ============================================================
   東洋医学 弁証支援アプリ  Service Worker
   オフライン対応＋バージョン連動。
   バージョンは version.json で一元管理し、アプリからの指示で更新する。
   ※ 通常は version.json を書き換えるだけでよく、このファイルの編集は不要。
   ============================================================ */

// オフラインで動かすために保存しておくファイル
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

// 現在のキャッシュ名を version.json から決める
async function currentCacheName(){
  try{
    const res = await fetch('./version.json', {cache:'no-store'});
    const data = await res.json();
    return 'bensho-' + (data.version || 'unknown');
  }catch(e){
    return 'bensho-fallback';
  }
}

// インストール時：最新バージョン名でキャッシュを作成
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const name = await currentCacheName();
    const cache = await caches.open(name);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

// 有効化時：現行バージョン以外の古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const name = await currentCacheName();
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== name).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 取得時：version.json は常に最新を取りに行く。その他はキャッシュ優先＋裏で更新。
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // バージョン確認は必ずネットワーク優先（更新検知のため）
  if (url.pathname.endsWith('version.json')) {
    event.respondWith(
      fetch(req, {cache:'no-store'}).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const fetched = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          currentCacheName().then(name =>
            caches.open(name).then(cache => cache.put(req, copy))
          );
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

// アプリからの指示で、最新ファイルを取り直してキャッシュを入れ替える
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'UPDATE_NOW') {
    event.waitUntil((async () => {
      const name = await currentCacheName();
      // いったん全キャッシュを削除して取り残しを防ぐ
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      // 新しいキャッシュを作り、キャッシュバスター付きでネットから取り直す
      const cache = await caches.open(name);
      const bust = '?_=' + Date.now();
      await Promise.all(PRECACHE.map(async u => {
        try{
          const res = await fetch(u + bust, {cache:'no-store'});
          if (res && res.status === 200) {
            // 保存キーはバスター無しのURLにする（通常アクセスで引けるように）
            await cache.put(u, res.clone());
          }
        }catch(e){}
      }));
      // 完了をアプリに通知
      const clients = await self.clients.matchAll();
      clients.forEach(c => c.postMessage({type:'UPDATED'}));
    })());
  }
});
