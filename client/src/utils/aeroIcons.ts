import { brown, crimson, cyan, indigo, plum, teal } from "@radix-ui/colors";
import type { Map as Maplibre } from "maplibre-gl";

const iconGlob = import.meta.glob<string>("../assets/icons/carbon/*.svg", {
	query: "?raw",
	import: "default",
	eager: true,
});

const colorMap = {
	"apt-ifr-civil": crimson.crimson9,
	"apt-ifr-military": crimson.crimson9,
	"apt-ifr-military-civil": crimson.crimson9,
	"apt-ifr-heliport": crimson.crimson9,
	"apt-seaplane": crimson.crimson9,
	"apt-ultralight": crimson.crimson9,
	"apt-civil-unpaved": crimson.crimson9,
	"apt-gliderport": crimson.crimson9,
	"apt-balloonport": crimson.crimson9,
	"apt-private": crimson.crimson9,
	"apt-helipad": crimson.crimson9,
	"fix-compulsory": indigo.indigo9,
	"fix-non-compulsory": indigo.indigo9,
	"wpt-rnav-open": indigo.indigo9,
	"wpt-rnav-solid": crimson.crimson9,
	"wpt-vfr-checkpoint": crimson.crimson9,
	"pass-mountain": brown.brown9,
	"nav-vor": indigo.indigo9,
	"nav-vortac": indigo.indigo9,
	"nav-vordme": indigo.indigo9,
	"nav-tacan": teal.teal9,
	"nav-dme": teal.teal9,
	"nav-ndb-dme": brown.brown9,
	"nav-ndb": brown.brown9,
	"nav-vhfor": indigo.indigo9,
	"obs-major": plum.plum9,
	"obs-minor": plum.plum9,
	"obs-wind-turbine": plum.plum9,
	"obs-major-lit": plum.plum9,
	"obs-minor-lit": plum.plum9,
};

type CachedIcon = {
	id: string;
	image: ImageData | HTMLImageElement;
};

const decodedIconCache = new Map<string, Promise<CachedIcon[]>>();

const loadImageElement = (svg: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const img = new Image(32, 32);
		const blob = new Blob([svg], {
			type: "image/svg+xml;charset=utf-8",
		});
		const url = URL.createObjectURL(blob);
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = (err) => {
			URL.revokeObjectURL(url);
			reject(err);
		};
		img.src = url;
	});

const rasterizeIcon = async (
	svg: string,
): Promise<ImageData | HTMLImageElement> => {
	const img = await loadImageElement(svg);
	if (typeof document === "undefined") return img;
	const canvas = document.createElement("canvas");
	canvas.width = 32;
	canvas.height = 32;
	const ctx = canvas.getContext("2d");
	if (!ctx) return img;
	ctx.drawImage(img, 0, 0, 32, 32);
	return ctx.getImageData(0, 0, 32, 32);
};

const CYAN_ICON_IDS = new Set([
	"fix-compulsory",
	"fix-non-compulsory",
	"wpt-rnav-solid",
	"wpt-vfr-checkpoint",
	"nav-vor",
	"nav-vortac",
	"nav-vordme",
	"nav-tacan",
	"nav-dme",
	"nav-ndb-dme",
	"nav-ndb",
	"apt-ifr-civil",
	"apt-civil-paved-small",
]);

function buildIconsForTheme(
	haloColor: string,
	haloOpacity: number,
): Promise<CachedIcon[]> {
	const tasks: Promise<CachedIcon | null>[] = [];

	const enqueue = (id: string, svg: string) => {
		tasks.push(
			rasterizeIcon(svg)
				.then((image) => ({ id, image }))
				.catch(() => null),
		);
	};

	for (const [path, svgContent] of Object.entries(iconGlob)) {
		const id = path.split("/").pop()?.replace(".svg", "");
		if (!id || typeof svgContent !== "string") continue;

		// Inject the halo filter into the SVG content
		let finalSvg = svgContent;
		const svgMatch = svgContent.match(/<svg[^>]*>/);
		if (svgMatch) {
			const svgStart = svgMatch[0];
			const svgTagEnd = svgContent.indexOf(svgStart) + svgStart.length;

			const filterDef = `
        <defs>
          <filter id="icon-halo" x="-50%" y="-50%" width="200%" height="200%">
            <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="dilated"/>
            <feFlood flood-color="${haloColor}" flood-opacity="${haloOpacity}" result="haloColor"/>
            <feComposite in="haloColor" in2="dilated" operator="in" result="halo"/>
            <feMerge>
              <feMergeNode in="halo"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#icon-halo)">
      `;
			finalSvg =
				svgContent.slice(0, svgTagEnd) +
				filterDef +
				svgContent.slice(svgTagEnd).replace(/<\/svg>\s*$/, "</g></svg>");
		}
		const color = colorMap[id as keyof typeof colorMap] ?? indigo.indigo9;
		const finalColoredSvg = finalSvg
			.replace(/fill="currentColor"/g, `fill="${color}"`)
			.replace(/stroke="currentColor"/g, `stroke="${color}"`);

		enqueue(id, finalColoredSvg);

		// Generate Cyan Variant for Flight Plan
		if (CYAN_ICON_IDS.has(id)) {
			const hex = cyan.cyan9;
			const cyanSvg = finalSvg
				.replace(/stroke="[^"]*"/g, `stroke="${hex}"`)
				.replace(/fill="[^"]*"/g, `fill="${hex}"`)
				.replace(/fill="currentColor"/g, `fill="${hex}"`)
				.replace(/stroke="currentColor"/g, `stroke="${hex}"`);

			enqueue(`${id}-cyan`, cyanSvg);
		}
	}

	const expectedCount = tasks.length;
	return Promise.all(tasks).then((results) => {
		const loaded = results.filter((item): item is CachedIcon => item !== null);
		if (loaded.length < expectedCount) {
			console.warn(
				`Loaded ${loaded.length}/${expectedCount} aeronautical icons for ${haloColor}; skipping permanent cache`,
			);
			decodedIconCache.delete(`${haloColor}:${haloOpacity}`);
		}
		return loaded;
	});
}

/**
 * Load all aeronautical SVG icons into the map with a halo outline effect.
 * @param map - MapLibre map instance
 * @param haloColor - CSS color for the halo outline (e.g. '#ffffff' for light maps, '#1a1a2e' for dark maps)
 * @param haloOpacity - Opacity of the halo (0-1)
 */
export const addAeroIcons = (
	map: Maplibre,
	haloColor = "#ffffff",
	haloOpacity = 0.95,
	shouldApply?: () => boolean,
) => {
	const cacheKey = `${haloColor}:${haloOpacity}`;
	let promise = decodedIconCache.get(cacheKey);
	if (!promise) {
		const expectedTasksPromise = buildIconsForTheme(haloColor, haloOpacity);
		promise = expectedTasksPromise.then((icons) => {
			if (icons.length === 0) {
				decodedIconCache.delete(cacheKey);
			}
			return icons;
		});
		decodedIconCache.set(cacheKey, promise);
	}

	promise
		.then((icons) => {
			if (shouldApply && !shouldApply()) return;
			if (!map.getStyle()) return;
			for (const { id, image } of icons) {
				if (map.hasImage(id)) {
					map.removeImage(id);
				}
				map.addImage(id, image);
			}
		})
		.catch((err) => {
			decodedIconCache.delete(cacheKey);
			console.warn("Failed to load aeronautical icons", err);
		});
};
