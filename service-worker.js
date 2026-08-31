// Service Worker de Almacén A+B
// Objetivo: que la app abra y siga mostrando el último dato conocido aunque el PDA
// se quede sin cobertura WiFi en alguna zona del almacén (algo habitual en naves grandes).
//
// Estrategia:
//  - "App shell" (HTML, manifest, iconos): cache-first, con actualización en segundo plano.
//  - Almacen_A.csv: network-first (siempre se intenta descargar el dato más fresco),
//    y si falla la red, se sirve la última copia cacheada con un aviso en cabecera.
//
// Para publicar una nueva versión de la app, sube la constante CACHE_VERSION:
// eso invalida la caché antigua y fuerza a los PDA a descargar los archivos nuevos.

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'almacen-ab-' + CACHE_VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

const CSV_FILENAME = 'Almacen_A.csv';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (name) { return name.indexOf('almacen-ab-') === 0 && name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isCsvRequest(url) {
  return url.pathname.indexOf(CSV_FILENAME) !== -1;
}

// Network-first: intenta red, si falla sirve caché (ignorando el parámetro anticaché ?v=...)
function networkFirst(request) {
  return fetch(request).then(function (response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(request.url.split('?')[0], copy);
      });
    }
    return response;
  }).catch(function () {
    return caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return new Response('Sin conexión y sin datos en caché todavía.', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    });
  });
}

// Cache-first con refresco en segundo plano para el shell de la app
function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    var networkFetch = fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () { return cached; });
    return cached || networkFetch;
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // no tocamos peticiones a otros orígenes

  if (isCsvRequest(url)) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});
