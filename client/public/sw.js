const CACHE_NAME = "avmvt-cache-v1";

self.addEventListener("install", (event) => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	// Intercept requests to faa-geo tilesets to prevent 404 console errors
	if (
		url.hostname === "r2dassonville.github.io" &&
		url.pathname.startsWith("/faa-geo/")
	) {
		event.respondWith(
			fetch(event.request)
				.then((response) => {
					if (response.status === 404) {
						// Return a 204 No Content instead of a 404 so MapLibre doesn't log a parsing error
						// Note: for image tiles 204 is fine, for vector tiles it's also fine
						return new Response(null, {
							status: 204,
							statusText: "No Content",
							headers: new Headers({
								// We don't know if it's pbf, png, or webp, so omitting content-type or returning generic
								"Access-Control-Allow-Origin": "*",
							}),
						});
					}
					return response;
				})
				.catch(() => {
					// If fetch fails entirely (e.g. offline fallback), also graceful fallback
					return new Response(null, { status: 204, statusText: "No Content" });
				}),
		);
		return;
	}
});
