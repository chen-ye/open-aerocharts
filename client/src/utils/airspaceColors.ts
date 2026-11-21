import {
	amber,
	amberDark,
	crimson,
	crimsonDark,
	indigo,
	indigoDark,
	orange,
	orangeDark,
	purple,
	purpleDark,
	slate,
	slateDark,
	teal,
	tealDark,
	violet,
	violetDark,
} from "@radix-ui/colors";

export const AIRSPACE_COLORS = {
	B: {
		main: violet.violet9,
		text: {
			light: violet.violet11,
			dark: violetDark.violet11,
		},
	},
	C: {
		main: crimson.crimson9,
		text: {
			light: crimson.crimson11,
			dark: crimsonDark.crimson11,
		},
	},
	D: {
		main: indigo.indigo9,
		text: {
			light: indigo.indigo11,
			dark: indigoDark.indigo11,
		},
	},
	E: {
		main: crimson.crimson9,
		text: {
			light: crimson.crimson11,
			dark: crimsonDark.crimson11,
		},
	},
	SUA: {
		main: slateDark.slate8,
		text: {
			light: slate.slate11,
			dark: slateDark.slate11,
		},
	},
	TRSA: {
		main: slateDark.slate8,
		text: {
			light: slate.slate11,
			dark: slateDark.slate11,
		},
	},
	ARTCC: {
		main: teal.teal9,
		text: {
			light: teal.teal11,
			dark: tealDark.teal11,
		},
	},
	CTA: {
		main: amber.amber9,
		text: {
			light: amber.amber11,
			dark: amberDark.amber11,
		},
	},
	SPECIAL_RULES: {
		main: orange.orange9,
		text: {
			light: orange.orange11,
			dark: orangeDark.orange11,
		},
	},
	PARACHUTE: {
		main: purple.purple9,
		text: {
			light: purple.purple11,
			dark: purpleDark.purple11,
		},
	},
	MODE_C: {
		main: crimson.crimson9,
		text: {
			light: crimson.crimson11,
			dark: crimsonDark.crimson11,
		},
	},
} as const;

export type AirspaceType = keyof typeof AIRSPACE_COLORS;

/**
 * Gets the primary color for an airspace type
 */
export const getAirspaceColor = (type: string, isSua = false): string => {
	if (isSua) return AIRSPACE_COLORS.SUA.main;
	const t = type as AirspaceType;
	return AIRSPACE_COLORS[t]?.main || "#969696";
};

/**
 * Gets the text color for an airspace type, respecting map brightness (dark/light mode)
 */
export const getAirspaceTextColor = (
	type: string,
	isSua = false,
	isDarkMap = true,
): string => {
	const colors = isSua
		? AIRSPACE_COLORS.SUA
		: AIRSPACE_COLORS[type as AirspaceType];
	if (!colors) return isDarkMap ? "#ffffff" : "#000000";
	return isDarkMap ? colors.text.dark : colors.text.light;
};

/**
 * Helper to convert hex to [r, g, b]
 */
export const hexToRgb = (hex: string): [number, number, number] => {
	const c = hex.substring(1);
	const r = parseInt(c.substring(0, 2), 16);
	const g = parseInt(c.substring(2, 4), 16);
	const b = parseInt(c.substring(4, 6), 16);
	return [r, g, b];
};

/**
 * Gets the primary color as an [R, G, B] array for deck.gl
 */
export const getAirspaceColorRgb = (
	type: string,
	isSua = false,
): [number, number, number] => {
	return hexToRgb(getAirspaceColor(type, isSua));
};
