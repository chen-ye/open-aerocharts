import {
	amber,
	blueDark,
	brown,
	crimson,
	gray,
	grayDark,
	indigo,
	plum,
	purple,
	teal,
} from "@radix-ui/colors";
import { Box, Flex, Separator, Slider, Switch, Text } from "@radix-ui/themes";
import type React from "react";
import { grayColor } from "../../App.tsx";
import type { AeronauticalLayerState } from "../../types/AeronauticalLayerState";

interface AeronauticalSettingsProps {
	layers: AeronauticalLayerState;
	setLayers: React.Dispatch<React.SetStateAction<AeronauticalLayerState>>;
}

const LegendBadge = ({
	label,
	color,
	textColor = gray.gray1,
}: {
	label: string;
	color: string;
	textColor?: string;
}) => (
	<Flex
		width="1em"
		height="1em"
		align="center"
		justify="center"
		style={{
			backgroundColor: color,
			borderRadius: "var(--radius-1)",
			flexShrink: 0,
		}}
	>
		<Text size="1" weight="bold" style={{ color: textColor }} trim="both">
			{label}
		</Text>
	</Flex>
);

const IconBadge = ({ icon, color }: { icon: string; color: string }) => (
	<Box
		width="1em"
		height="1em"
		style={{
			backgroundColor: color,
			WebkitMask: `url("${icon}") no-repeat center / contain`,
			mask: `url("${icon}") no-repeat center / contain`,
			display: "block",
			flexShrink: 0,
		}}
	/>
);

const CircleSwatch = ({
	color,
	dashArray,
	dashOffset,
	innerBand = false,
}: {
	color: string;
	dashArray?: string;
	dashOffset?: string | number;
	innerBand?: boolean;
}) => (
	<svg
		width="1em"
		height="1em"
		viewBox="0 0 16 16"
		aria-hidden="true"
		style={{ display: "block", flexShrink: 0, overflow: "visible" }}
	>
		{innerBand && (
			<circle
				cx="8"
				cy="8"
				r="5.5"
				fill="none"
				stroke={color}
				strokeOpacity={0.3}
				strokeWidth="2.5"
			/>
		)}
		<circle
			cx="8"
			cy="8"
			r="7.25"
			fill="none"
			stroke={color}
			strokeWidth="1.5"
			strokeDasharray={dashArray}
			strokeDashoffset={dashOffset}
		/>
	</svg>
);

const LineSwatch = ({
	color,
	dashArray,
	strokeWidth = 2,
	innerBand = false,
}: {
	color: string;
	dashArray?: string;
	strokeWidth?: number;
	innerBand?: boolean;
}) => (
	<svg
		width="22"
		height="14"
		viewBox="0 0 22 14"
		aria-hidden="true"
		style={{ display: "block", flexShrink: 0 }}
	>
		{innerBand && (
			<line
				x1="1"
				y1="9.2"
				x2="21"
				y2="9.2"
				stroke={color}
				strokeOpacity={0.28}
				strokeWidth={3.2}
			/>
		)}
		<line
			x1="1"
			y1={innerBand ? "6.2" : "7"}
			x2="21"
			y2={innerBand ? "6.2" : "7"}
			stroke={color}
			strokeWidth={strokeWidth}
			strokeDasharray={dashArray}
		/>
	</svg>
);

const WindFarmSwatch = ({ color }: { color: string }) => (
	<svg
		width="1em"
		height="1em"
		viewBox="0 0 16 16"
		aria-hidden="true"
		style={{ display: "block", flexShrink: 0 }}
	>
		<rect
			x="1"
			y="1"
			width="14"
			height="14"
			rx="2.5"
			fill={color}
			fillOpacity={0.18}
			stroke={color}
			strokeWidth="1.4"
		/>
		<line
			x1="3"
			y1="13"
			x2="13"
			y2="3"
			stroke={color}
			strokeWidth="1"
			strokeOpacity={0.65}
		/>
		<circle cx="5.2" cy="5.2" r="1.2" fill={color} />
		<circle cx="10.8" cy="10.8" r="1.2" fill={color} />
	</svg>
);

import heliportIcon from "../../assets/icons/carbon/apt-helipad.svg?url";
import aptCivilIcon from "../../assets/icons/carbon/apt-ifr-civil.svg?url";
import privateIcon from "../../assets/icons/carbon/apt-private.svg?url";
import ultralightIcon from "../../assets/icons/carbon/apt-ultralight.svg?url";
import navaidIcon from "../../assets/icons/carbon/nav-vor.svg?url";
import obstacleIcon from "../../assets/icons/carbon/obs-major.svg?url";
import mountainPassIcon from "../../assets/icons/carbon/pass-mountain.svg?url";
import waypointIcon from "../../assets/icons/carbon/wpt-rnav-solid.svg?url";
import vfrWaypointIcon from "../../assets/icons/carbon/wpt-vfr-checkpoint.svg?url";

export const AeronauticalSettings: React.FC<AeronauticalSettingsProps> = ({
	layers,
	setLayers,
}) => {
	const updateLayer = <K extends keyof AeronauticalLayerState>(
		key: K,
		value: AeronauticalLayerState[K],
	) => {
		setLayers((prev: AeronauticalLayerState) => ({ ...prev, [key]: value }));
	};

	const updateMasterGroup = (
		masterKey: keyof AeronauticalLayerState,
		value: boolean,
	) => {
		setLayers((prev: AeronauticalLayerState) => {
			if (
				masterKey === "showWaypointsMaster" &&
				value &&
				!prev.navaids &&
				!prev.waypoints &&
				!prev.vfrWaypoints
			) {
				return {
					...prev,
					showWaypointsMaster: true,
					navaids: true,
					waypoints: true,
					vfrWaypoints: true,
				};
			}
			if (
				masterKey === "showVfrMaster" &&
				value &&
				!prev.mtrs &&
				!prev.mountainPasses &&
				!prev.windFarms &&
				!prev.powerlines
			) {
				return {
					...prev,
					showVfrMaster: true,
					mtrs: true,
					mountainPasses: true,
					windFarms: true,
				};
			}
			return {
				...prev,
				[masterKey]: value,
			};
		});
	};

	return (
		<Flex direction="column" gap="4">
			{/* Master Toggle */}
			<Flex align="center" justify="between">
				<Text
					size="2"
					weight="bold"
					color={grayColor}
					style={{ textTransform: "uppercase" }}
				>
					Aeronautical Data
				</Text>
				<Switch
					checked={layers.showAll}
					onCheckedChange={(c: boolean) => updateLayer("showAll", c)}
				/>
			</Flex>

			{layers.showAll && (
				<Flex direction="column" gap="4">
					{/* Map Density */}
					<Box>
						<Flex align="center" justify="between" mb="2">
							<Text size="2" weight="bold">
								Map Density
							</Text>
							<Text size="1" color={grayColor}>
								{layers.declutterLevel === -2
									? "Low"
									: layers.declutterLevel === 0
										? "Standard"
										: layers.declutterLevel === 2
											? "High"
											: "Max"}
							</Text>
						</Flex>
						<Slider
							min={1}
							max={4}
							step={1}
							// Map slider [1, 2, 3, 4] -> offset [-2, 0, 2, 10]
							value={[
								layers.declutterLevel === -2
									? 1
									: layers.declutterLevel === 0
										? 2
										: layers.declutterLevel === 2
											? 3
											: 4,
							]}
							onValueChange={([val]) => {
								const offset =
									val === 1 ? -2 : val === 2 ? 0 : val === 3 ? 2 : 10;
								updateLayer("declutterLevel", offset);
							}}
						/>
					</Box>
					<Separator size="4" />

					{/* Airports */}
					<Box>
						<Flex align="center" justify="between" mb="2">
							<Text size="2" weight="bold">
								Airports
							</Text>
							<Switch
								size="1"
								checked={layers.showAirportsMaster}
								onCheckedChange={(c: boolean) =>
									updateMasterGroup("showAirportsMaster", c)
								}
							/>
						</Flex>
						<Flex direction="column" gap="2">
							<ToggleRow
								label="Public Airports"
								legend={
									<IconBadge icon={aptCivilIcon} color={crimson.crimson9} />
								}
								checked={layers.publicAirports}
								disabled={!layers.showAirportsMaster}
								onChange={(c: boolean) => updateLayer("publicAirports", c)}
							/>
							<ToggleRow
								label="Heliports"
								legend={
									<IconBadge icon={heliportIcon} color={crimson.crimson9} />
								}
								checked={layers.heliports}
								disabled={!layers.showAirportsMaster}
								onChange={(c: boolean) => updateLayer("heliports", c)}
							/>
							<ToggleRow
								label="Private Airports"
								legend={
									<IconBadge icon={privateIcon} color={crimson.crimson9} />
								}
								checked={layers.privateAirports}
								disabled={!layers.showAirportsMaster}
								onChange={(c: boolean) => updateLayer("privateAirports", c)}
							/>
							<ToggleRow
								label="Other Fields"
								legend={
									<IconBadge icon={ultralightIcon} color={crimson.crimson9} />
								}
								checked={layers.otherAirports}
								disabled={!layers.showAirportsMaster}
								onChange={(c: boolean) => updateLayer("otherAirports", c)}
							/>
						</Flex>
					</Box>
					<Separator size="4" />

					{/* Airspace */}
					<Box>
						<Flex align="center" justify="between" mb="2">
							<Text size="2" weight="bold">
								Airspace
							</Text>
							<Switch
								size="1"
								checked={layers.showAirspaceMaster}
								onCheckedChange={(c: boolean) =>
									updateMasterGroup("showAirspaceMaster", c)
								}
							/>
						</Flex>
						<Flex direction="column" gap="2">
							<ToggleRow
								label="Controlled"
								legend={
									<Flex gap="1">
										<LegendBadge label="B" color="var(--airspace-b-color)" />
										<LegendBadge label="C" color="var(--airspace-c-color)" />
										<LegendBadge label="D" color="var(--airspace-d-color)" />
									</Flex>
								}
								checked={layers.controlledAirspace}
								disabled={!layers.showAirspaceMaster}
								onChange={(c: boolean) => updateLayer("controlledAirspace", c)}
							/>
							<ToggleRow
								label="SUA / MOA"
								legend={
									<LegendBadge
										label="S"
										color="var(--airspace-sua-color)"
										textColor={grayDark.gray1}
									/>
								}
								checked={layers.suaMoa}
								disabled={!layers.showAirspaceMaster}
								onChange={(c: boolean) => updateLayer("suaMoa", c)}
							/>
							<ToggleRow
								label="TRSA"
								legend={
									<LegendBadge
										label="T"
										color="var(--airspace-trsa-color)"
										textColor={grayDark.gray1}
									/>
								}
								checked={layers.trsa}
								disabled={!layers.showAirspaceMaster}
								onChange={(c: boolean) => updateLayer("trsa", c)}
							/>
							<ToggleRow
								label="Class E"
								legend={
									<LegendBadge
										label="E"
										color="var(--airspace-e-color)"
										textColor={grayDark.gray1}
									/>
								}
								checked={layers.classE}
								disabled={!layers.showAirspaceMaster}
								onChange={(c: boolean) => updateLayer("classE", c)}
							/>
							<ToggleRow
								label="Parachute Area"
								legend={
									<CircleSwatch
										color="var(--airspace-parachute-color)"
										innerBand={true}
										dashArray="3.2 2.5"
										dashOffset={1.6}
									/>
								}
								checked={layers.parachuteArea}
								disabled={!layers.showAirspaceMaster}
								onChange={(c: boolean) => updateLayer("parachuteArea", c)}
							/>
							<ToggleRow
								label="Mode C"
								legend={<CircleSwatch color="var(--airspace-mode-c-color)" />}
								checked={layers.modeC}
								disabled={!layers.showAirspaceMaster}
								onChange={(c: boolean) => updateLayer("modeC", c)}
							/>
						</Flex>
					</Box>
					<Separator size="4" />

					{/* Airways */}
					<Box>
						<Flex align="center" justify="between" mb="2">
							<Text size="2" weight="bold">
								Airways
							</Text>
							<Switch
								size="1"
								checked={layers.showAirwaysMaster}
								onCheckedChange={(c: boolean) =>
									updateMasterGroup("showAirwaysMaster", c)
								}
							/>
						</Flex>
						<Flex direction="column" gap="2">
							<ToggleRow
								label="Enroute High"
								legend={
									<Flex gap="1">
										<LegendBadge
											label="Q"
											color={blueDark.blue8}
											textColor={gray.gray1}
										/>
										<LegendBadge
											label="J"
											color={gray.gray9}
											textColor={grayDark.gray1}
										/>
									</Flex>
								}
								checked={layers.enrouteHigh}
								disabled={!layers.showAirwaysMaster}
								onChange={(c: boolean) => updateLayer("enrouteHigh", c)}
							/>
							<ToggleRow
								label="Enroute Low"
								legend={
									<Flex gap="1">
										<LegendBadge
											label="T"
											color={blueDark.blue8}
											textColor={gray.gray1}
										/>
										<LegendBadge
											label="V"
											color={gray.gray9}
											textColor={grayDark.gray1}
										/>
									</Flex>
								}
								checked={layers.enrouteLow}
								disabled={!layers.showAirwaysMaster}
								onChange={(c: boolean) => updateLayer("enrouteLow", c)}
							/>
						</Flex>
					</Box>
					<Separator size="4" />

					{/* Waypoints */}
					<Box>
						<Flex align="center" justify="between" mb="2">
							<Text size="2" weight="bold">
								Waypoints
							</Text>
							<Switch
								size="1"
								checked={layers.showWaypointsMaster}
								onCheckedChange={(c: boolean) =>
									updateMasterGroup("showWaypointsMaster", c)
								}
							/>
						</Flex>
						<Flex direction="column" gap="2">
							<ToggleRow
								label="Navaids"
								legend={<IconBadge icon={navaidIcon} color={indigo.indigo9} />}
								checked={layers.navaids}
								disabled={!layers.showWaypointsMaster}
								onChange={(c: boolean) => updateLayer("navaids", c)}
							/>
							<ToggleRow
								label="IFR Waypoints"
								legend={
									<IconBadge icon={waypointIcon} color={indigo.indigo9} />
								}
								checked={layers.waypoints}
								disabled={!layers.showWaypointsMaster}
								onChange={(c: boolean) => updateLayer("waypoints", c)}
							/>
							<ToggleRow
								label="VFR Waypoints"
								legend={
									<IconBadge icon={vfrWaypointIcon} color={crimson.crimson9} />
								}
								checked={layers.vfrWaypoints}
								disabled={!layers.showWaypointsMaster}
								onChange={(c: boolean) => updateLayer("vfrWaypoints", c)}
							/>
						</Flex>
					</Box>
					<Separator size="4" />

					{/* VFR Elements */}
					<Box>
						<Flex align="center" justify="between" mb="2">
							<Text size="2" weight="bold">
								VFR Elements
							</Text>
							<Switch
								size="1"
								checked={layers.showVfrMaster}
								onCheckedChange={(c: boolean) =>
									updateMasterGroup("showVfrMaster", c)
								}
							/>
						</Flex>
						<Flex direction="column" gap="2">
							<ToggleRow
								label="Military Training Routes"
								legend={
									<LineSwatch
										color={indigo.indigo9}
										dashArray="6 3"
										innerBand={true}
									/>
								}
								checked={layers.mtrs}
								disabled={!layers.showVfrMaster}
								onChange={(c: boolean) => updateLayer("mtrs", c)}
							/>
							<ToggleRow
								label="Mountain Passes"
								legend={
									<IconBadge icon={mountainPassIcon} color={brown.brown9} />
								}
								checked={layers.mountainPasses}
								disabled={!layers.showVfrMaster}
								onChange={(c: boolean) => updateLayer("mountainPasses", c)}
							/>
							<ToggleRow
								label="Wind Farms"
								legend={<WindFarmSwatch color={purple.purple9} />}
								checked={layers.windFarms}
								disabled={!layers.showVfrMaster}
								onChange={(c: boolean) => updateLayer("windFarms", c)}
							/>
							<ToggleRow
								label="Power Transmission Lines"
								legend={<LineSwatch color={amber.amber9} dashArray="4 3" />}
								checked={layers.powerlines}
								disabled={!layers.showVfrMaster}
								onChange={(c: boolean) => updateLayer("powerlines", c)}
							/>
						</Flex>
					</Box>
					<Separator size="4" />

					{/* Boundaries (ARTCC/FIR/CTA/Special Rules) */}
					<Box>
						<Flex align="center" justify="between" mb="2">
							<Text size="2" weight="bold">
								Boundaries
							</Text>
							<Switch
								size="1"
								checked={layers.showArtccMaster}
								onCheckedChange={(c: boolean) =>
									updateMasterGroup("showArtccMaster", c)
								}
							/>
						</Flex>
						<Flex direction="column" gap="2">
							<ToggleRow
								label="ARTCC / FIRs"
								legend={
									<LineSwatch
										color="var(--airspace-artcc-color)"
										dashArray="8 4"
									/>
								}
								checked={layers.artccFirs}
								disabled={!layers.showArtccMaster}
								onChange={(c: boolean) => updateLayer("artccFirs", c)}
							/>
							<ToggleRow
								label="CTA / ACC"
								legend={
									<LineSwatch
										color="var(--airspace-cta-color)"
										dashArray="4 4"
									/>
								}
								checked={layers.ctaAcc}
								disabled={!layers.showArtccMaster}
								onChange={(c: boolean) => updateLayer("ctaAcc", c)}
							/>
							<ToggleRow
								label="Special Rules / ADIZ"
								legend={
									<LineSwatch
										color="var(--airspace-special-rules-color)"
										dashArray="6.5 2.5 2 2.5 6.5"
										strokeWidth={2}
										innerBand={true}
									/>
								}
								checked={layers.specialRules}
								disabled={!layers.showArtccMaster}
								onChange={(c: boolean) => updateLayer("specialRules", c)}
							/>
						</Flex>
					</Box>
					<Separator size="4" />

					{/* Standalone */}
					<Box>
						<Flex direction="column" gap="2">
							<ToggleRow
								label="Obstacles (DOF)"
								legend={<IconBadge icon={obstacleIcon} color={plum.plum9} />}
								checked={layers.obstacles}
								onChange={(c: boolean) => updateLayer("obstacles", c)}
							/>
							<ToggleRow
								label="Grid MORA"
								legend={<LegendBadge label="23" color={teal.teal9} />}
								checked={layers.gridMora}
								onChange={(c: boolean) => updateLayer("gridMora", c)}
							/>
						</Flex>
					</Box>
				</Flex>
			)}
		</Flex>
	);
};

const ToggleRow = ({
	label,
	checked,
	disabled,
	onChange,
	legend,
}: {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (c: boolean) => void;
	legend?: React.ReactNode;
}) => (
	<Flex align="center" justify="between" gap="2">
		<Flex align="center" gap="2" style={{ minWidth: 0, flexShrink: 1 }}>
			<Text
				size="2"
				color={disabled ? grayColor : undefined}
				style={{
					opacity: disabled ? 0.5 : 1,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{label}
			</Text>
		</Flex>
		<Flex align="center" gap="2">
			{legend}
			<Switch
				size="1"
				checked={checked}
				disabled={disabled}
				onCheckedChange={onChange}
			/>
		</Flex>
	</Flex>
);
