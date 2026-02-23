import maplibregl from "maplibre-gl";

export const sources = {
	"faa-sectional": {
		type: "raster",
		tiles: [
			"https://r2dassonville.github.io/faa-geo/tiles/current/sectional/{z}/{x}/{y}.webp",
		],
		tileSize: 256,
		scheme: "tms",
		minzoom: 0,
		maxzoom: 11,
	},
	"faa-enroute": {
		type: "raster",
		tiles: [
			"https://r2dassonville.github.io/faa-geo/tiles/current/enroute/{z}/{x}/{y}.webp",
		],
		tileSize: 256,
		scheme: "tms",
		minzoom: 0,
		maxzoom: 11,
	},
	"faa-ifrlo": {
		type: "raster",
		tiles: [
			"https://r2dassonville.github.io/faa-geo/tiles/current/ifrlo/{z}/{x}/{y}.webp",
		],
		tileSize: 256,
		scheme: "tms",
		minzoom: 0,
		maxzoom: 11,
	},
} satisfies Record<string, maplibregl.RasterSourceSpecification>;

export default {
	"faa-sectional": {
		version: 8,
		sources: {
			"faa-sectional": sources["faa-sectional"],
		},
		layers: [
			{
				id: "faa-sectional",
				type: "raster",
				source: "faa-sectional",
			},
		],
	},
	"faa-enroute": {
		version: 8,
		sources: {
			"faa-enroute": sources["faa-enroute"],
		},
		layers: [
			{
				id: "faa-enroute",
				type: "raster",
				source: "faa-enroute",
			},
		],
	},
	"faa-ifrlo": {
		version: 8,
		sources: {
			"faa-ifrlo": sources["faa-ifrlo"],
		},
		layers: [
			{
				id: "faa-ifrlo",
				type: "raster",
				source: "faa-ifrlo",
			},
		],
	},
} satisfies Record<string, maplibregl.StyleSpecification>;
