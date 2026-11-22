import { accessSync, constants } from "node:fs";

export function resolveGpuMode() {
	const raw = (process.env.AEROCHARTS_E2E_GPU ?? "auto").trim().toLowerCase();
	if (raw === "vulkan" || raw === "swiftshader") {
		return raw;
	}
	if (raw !== "auto") {
		throw new Error(
			`Invalid AEROCHARTS_E2E_GPU="${raw}". Expected "auto", "vulkan", or "swiftshader".`,
		);
	}
	try {
		accessSync("/dev/dri/renderD128", constants.R_OK | constants.W_OK);
		return "vulkan";
	} catch {
		return "swiftshader";
	}
}

export function getChromiumLaunchArgs(mode = resolveGpuMode()) {
	if (mode !== "vulkan" && mode !== "swiftshader") {
		throw new Error(
			`Invalid GPU mode "${mode}". Expected "vulkan" or "swiftshader".`,
		);
	}
	return mode === "vulkan"
		? [
				"--use-gl=angle",
				"--use-angle=vulkan",
				"--enable-features=Vulkan",
				"--enable-webgl",
				"--enable-webgl2",
				"--ignore-gpu-blocklist",
			]
		: [
				"--use-gl=angle",
				"--use-angle=swiftshader",
				"--enable-webgl",
				"--enable-webgl2",
				"--ignore-gpu-blocklist",
			];
}

export async function waitForMapCanvasPixels(page, timeoutMs = 45000) {
	await page.waitForSelector("canvas.maplibregl-canvas", {
		timeout: timeoutMs,
	});
	await page.waitForFunction(
		() => {
			const canvas = document.querySelector("canvas.maplibregl-canvas");
			if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
			const probe = document.createElement("canvas");
			probe.width = 16;
			probe.height = 16;
			const ctx = probe.getContext("2d");
			if (!ctx) return false;
			ctx.drawImage(canvas, 0, 0, 16, 16);
			const { data } = ctx.getImageData(0, 0, 16, 16);
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] > 0) return true;
			}
			return false;
		},
		null,
		{ timeout: timeoutMs, polling: 150 },
	);
}
