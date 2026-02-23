import {
	Box,
	Card,
	Flex,
	Heading,
	IconButton,
	Select,
	Slider,
	Switch,
	Text,
} from "@radix-ui/themes";
import { Layers, X } from "lucide-react";
import React, { useState } from "react";
import { grayColor } from "../../App.tsx";
import type { AeronauticalLayerState } from "../../types/AeronauticalLayerState";
import { AeronauticalSettings } from "./AeronauticalSettings";

interface SettingsPanelProps {
	basemap: string;
	setBasemap: (url: string) => void;
	showTerrain: boolean;
	setShowTerrain: (show: boolean) => void;
	aeronauticalLayers: AeronauticalLayerState;
	setAeronauticalLayers: React.Dispatch<
		React.SetStateAction<AeronauticalLayerState>
	>;
	basemapBrightness: number;
	setBasemapBrightness: (val: number) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
	basemap,
	setBasemap,
	showTerrain,
	setShowTerrain,
	aeronauticalLayers,
	setAeronauticalLayers,
	basemapBrightness,
	setBasemapBrightness,
}) => {
	const [isOpen, setIsOpen] = useState(true);

	return (
		<Box className="settings-panel-container">
			{!isOpen ? (
				<IconButton
					size="3"
					variant="surface"
					color={grayColor}
					onClick={() => setIsOpen(true)}
					title="Open Settings"
					style={{
						backgroundColor: "var(--glass-bg)",
						backdropFilter: "blur(var(--glass-blur))",
						boxShadow: "0 0 0 1px var(--glass-border)",
					}}
				>
					<Layers size={20} />
				</IconButton>
			) : (
				<Card
					className="settings-card"
					size="2"
					variant="surface"
					style={{
						backgroundColor: "var(--glass-bg)",
						backdropFilter: "blur(var(--glass-blur))",
						boxShadow: "0 0 0 1px var(--glass-border)",
					}}
				>
					<Flex
						direction="column"
						gap="4"
						style={{ height: "100%", minHeight: 0 }}
					>
						<Flex align="center" justify="between" px="4" pt="4">
							<Heading size="3" as="h2">
								Map Settings
							</Heading>
							<IconButton
								size="2"
								variant="ghost"
								onClick={() => setIsOpen(false)}
								title="Close Settings"
							>
								<X size={18} />
							</IconButton>
						</Flex>

						<Box className="settings-card-body">
							<Flex direction="column" gap="4" px="4">
								<Flex direction="column" gap="2">
									<Text
										size="2"
										weight="bold"
										color={grayColor}
										style={{ textTransform: "uppercase" }}
									>
										Basemap
									</Text>
									<Text size="2">Basemap Style</Text>
									<Select.Root value={basemap} onValueChange={setBasemap}>
										<Select.Trigger />
										<Select.Content>
											<Select.Group>
												<Select.Label>Vector Basemaps</Select.Label>
												<Select.Item value="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json">
													CartoCDN Voyager
												</Select.Item>
												<Select.Item value="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json">
													CartoCDN Positron (Light)
												</Select.Item>
												<Select.Item value="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json">
													CartoCDN Dark Matter
												</Select.Item>
												<Select.Item value="https://api.maptiler.com/maps/outdoor-v4-dark/style.json?key=e5LIPC3PNWM1DYcxpSLL">
													MapTiler Outdoor Dark
												</Select.Item>
												<Select.Item value="https://api.maptiler.com/maps/outdoor-v4/style.json?key=e5LIPC3PNWM1DYcxpSLL">
													MapTiler Outdoor Light
												</Select.Item>
												<Select.Item value="https://api.maptiler.com/maps/dataviz-v4-dark/style.json?key=e5LIPC3PNWM1DYcxpSLL">
													MapTiler Dataviz Dark
												</Select.Item>
												<Select.Item value="https://api.maptiler.com/maps/dataviz-v4-light/style.json?key=e5LIPC3PNWM1DYcxpSLL">
													MapTiler Dataviz Light
												</Select.Item>
											</Select.Group>
											<Select.Separator />
											<Select.Group>
												<Select.Label>FAA Raster Maps</Select.Label>
												<Select.Item value="faa-sectional">
													VFR Sectional
												</Select.Item>
												<Select.Item value="faa-enroute">
													IFR High Enroute
												</Select.Item>
												<Select.Item value="faa-ifrlo">
													IFR Low Enroute
												</Select.Item>
											</Select.Group>
										</Select.Content>
									</Select.Root>
								</Flex>

								<Flex direction="column" gap="2">
									<Text as="label" size="2">
										Basemap Brightness
									</Text>
									<Slider
										value={[basemapBrightness]}
										onValueChange={(val: number[]) =>
											setBasemapBrightness(val[0])
										}
										max={100}
										step={1}
									/>
								</Flex>

								<Flex align="center" justify="between">
									<Text
										as="label"
										size="2"
										weight="bold"
										color={grayColor}
										style={{ textTransform: "uppercase" }}
									>
										Terrain/Hillshade
									</Text>
									<Switch
										id="terrain-toggle"
										checked={showTerrain}
										onCheckedChange={(c: boolean) => setShowTerrain(c)}
									/>
								</Flex>

								<AeronauticalSettings
									layers={aeronauticalLayers}
									setLayers={setAeronauticalLayers}
								/>
							</Flex>
						</Box>
					</Flex>
				</Card>
			)}
		</Box>
	);
};
