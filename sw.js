// Ao publicar uma nova versão, aumente ASSET_VERSION aqui e o ?v= em index.html.
const ASSET_VERSION = "17";
const CACHE = "advogatix-v" + ASSET_VERSION;
const SHELL = [
  "./", "./index.html",
  "./styles.css?v=" + ASSET_VERSION, "./admin.js?v=" + ASSET_VERSION, "./team.js?v=" + ASSET_VERSION, "./app.js?v=" + ASSET_VERSION, "./organizer.js?v=" + ASSET_VERSION, "./features.js?v=" + ASSET_VERSION, "./deadline-calc.js?v=" + ASSET_VERSION,
  "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Rede primeiro para os arquivos do próprio site; o cache só entra quando estiver offline.
// Supabase e CDN (outras origens) nunca passam pelo cache.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    // no-cache: sempre revalida com o servidor, evitando misturar arquivos de versões diferentes.
    // Requisições de navegação não aceitam opções extras, por isso são recriadas pela URL.
    fetch(request.mode === "navigate" ? new Request(request.url, { cache: "no-cache" }) : new Request(request, { cache: "no-cache" }))
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
        if (cached) return cached;
        if (request.mode === "navigate") return (await caches.match("./index.html")) || Response.error();
        return Response.error();
      })
  );
});
