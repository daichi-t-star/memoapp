import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "memo-offline-shell",
      apply: "build",
      generateBundle(_, bundle) {
        const assets = [
          ...Object.keys(bundle)
            .filter((name) => name !== "sw.js")
            .map((name) => `/memoapp/${name}`),
          "/memoapp/",
          "/memoapp/icon.svg",
          "/memoapp/manifest.json",
        ];
        const version = `memoapp-shell-${Date.now()}`;
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `const CACHE=${JSON.stringify(version)};const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('memoapp-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;const path=event.request.mode==='navigate'&&url.pathname==='/memoapp/'?'/memoapp/':url.pathname;if(!ASSETS.includes(path))return;event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(path))||fetch(event.request)));});`,
        });
      },
    },
  ],
  base: "/memoapp/",
});
