import {
	Badge,
	Box,
	Button,
	Card,
	Flex,
	Heading,
	IconButton,
	Popover,
	ScrollArea,
	Table,
	Text,
	TextArea,
	VisuallyHidden,
} from "@radix-ui/themes";
import { CircleHelp, MessageSquare, Plane, Trash, X } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { grayColor } from "../../App.tsx";
import type { FlightPlan, SearchIndex } from "../../types/FlightPlan";
import { parseRoute } from "../../utils/routeParser";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "../ui/Accordion";

interface FlightPlanContentProps {
	onFlightPlanChange: (plan: FlightPlan | null) => void;
	routeString: string;
	onRouteStringChange: (route: string) => void;
	index: SearchIndex | null;
	loading: boolean;
	onRequestIndex?: () => void;
	style?: React.CSSProperties;
}

export const FlightPlanContent: React.FC<FlightPlanContentProps> = ({
	onFlightPlanChange,
	routeString,
	onRouteStringChange,
	index,
	loading,
	onRequestIndex,
	style,
}) => {
	const [activePlan, setActivePlan] = useState<FlightPlan | null>(null);
	const initialPlotDone = React.useRef(false);

	useEffect(() => {
		onRequestIndex?.();
	}, [onRequestIndex]);

	const handlePlot = useCallback(() => {
		if (!index) return;
		const plan = parseRoute(routeString, index);
		setActivePlan(plan);
		onFlightPlanChange(plan);
	}, [index, routeString, onFlightPlanChange]);

	useEffect(() => {
		if (index && routeString && !initialPlotDone.current) {
			initialPlotDone.current = true;
			// Use microtask to avoid synchronous setState warning
			queueMicrotask(() => {
				handlePlot();
			});
		}
	}, [index, routeString, handlePlot]);

	const handleClear = () => {
		onRouteStringChange("");
		setActivePlan(null);
		onFlightPlanChange(null);
	};

	return (
		<Flex direction="column" gap="3" style={{ height: "100%", ...style }}>
			<TextArea
				placeholder="KSJC TECKY4.VLREE EBAYE KLAX"
				value={routeString}
				onChange={(e) => onRouteStringChange(e.target.value)}
				rows={3}
				style={{ fontFamily: "monospace" }}
			/>

			<Flex gap="3">
				<Button
					onClick={handlePlot}
					disabled={loading || !index}
					style={{ flex: 1 }}
				>
					{loading ? "Loading Data..." : "Plot Route"}
				</Button>

				<Popover.Root>
					<Popover.Trigger>
						<IconButton variant="soft" color="gray" title="Syntax Help">
							<CircleHelp size={18} />
						</IconButton>
					</Popover.Trigger>
					<Popover.Content width="200px">
						<Box p="1">
							<Text as="div" size="1" weight="bold" mb="1">
								Supported Formats
							</Text>
							<Text as="div" size="1">
								Fixes: KSJC, SJC, WPT
							</Text>
							<Text as="div" size="1">
								Airways: V68, J1, T200
							</Text>
							<Text as="div" size="1">
								Procedures: TECKY4.VLREE
							</Text>
							<Text as="div" size="1">
								Coords: 37.25/-122.5
							</Text>
							<Text as="div" size="1">
								DMS: 3715N12230W
							</Text>
						</Box>
					</Popover.Content>
				</Popover.Root>

				<IconButton
					onClick={handleClear}
					variant="soft"
					color="crimson"
					title="Clear Route"
				>
					<Trash size={18} />
				</IconButton>
			</Flex>

			{activePlan && (
				<Accordion type="single" collapsible defaultValue="waypoints">
					<AccordionItem value="waypoints">
						<AccordionTrigger>
							Fixes ({activePlan.points.length})
						</AccordionTrigger>
						<AccordionContent>
							<ScrollArea
								type="auto"
								scrollbars="vertical"
								style={{ maxHeight: 200 }}
							>
								<Table.Root style={{ backgroundColor: "transparent" }}>
									<Table.Body>
										{activePlan.points.map((pt, i) => (
											<Table.Row key={i}>
												<Table.Cell py="2">
													<Flex direction="column">
														<Text weight="bold" size="2">
															{pt.id}
														</Text>
														{pt.name && (
															<Text size="1" color="gray">
																{pt.name}
															</Text>
														)}
													</Flex>
												</Table.Cell>
												<Table.Cell py="2" align="right">
													<Badge
														color={
															pt.type === "airport"
																? "blue"
																: pt.type === "navaid"
																	? "plum"
																	: "gray"
														}
													>
														{pt.type}
													</Badge>
												</Table.Cell>
											</Table.Row>
										))}
									</Table.Body>
								</Table.Root>
							</ScrollArea>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			)}

			{index && !activePlan && (
				<Text size="1" color="gray">
					Database loaded ({Object.keys(index.fixes).length} points)
				</Text>
			)}
		</Flex>
	);
};

interface FlightPlanPanelProps {
	onFlightPlanChange: (plan: FlightPlan | null) => void;
	routeString: string;
	onRouteStringChange: (route: string) => void;
	index: SearchIndex | null;
	loading: boolean;
	onRequestIndex?: () => void;
	showTooltip: boolean;
	setShowTooltip: (show: boolean) => void;
}

export const FlightPlanPanel: React.FC<FlightPlanPanelProps> = ({
	onFlightPlanChange,
	routeString,
	onRouteStringChange,
	index,
	loading,
	onRequestIndex,
	showTooltip,
	setShowTooltip,
}) => {
	const [isOpen, setIsOpen] = useState(false);

	if (!isOpen) {
		return (
			<Box
				className="desktop-only"
				position="absolute"
				top="4"
				left="4"
				style={{ zIndex: 10 }}
			>
				<Flex gap="2">
					<IconButton
						size="3"
						variant="surface"
						color={grayColor}
						onClick={() => {
							onRequestIndex?.();
							setIsOpen(true);
						}}
						title="Flight Plan"
						style={{
							backgroundColor: "var(--glass-bg)",
							backdropFilter: "blur(var(--glass-blur))",
							boxShadow: "0 0 0 1px var(--glass-border)",
						}}
					>
						<Plane size={20} />
					</IconButton>
					<IconButton
						size="3"
						variant={showTooltip ? "solid" : "surface"}
						color={showTooltip ? "iris" : grayColor}
						onClick={() => setShowTooltip(!showTooltip)}
						title={showTooltip ? "Disable Hover Info" : "Enable Hover Info"}
						style={{
							backgroundColor: showTooltip ? undefined : "var(--glass-bg)",
							backdropFilter: "blur(var(--glass-blur))",
							boxShadow: "0 0 0 1px var(--glass-border)",
						}}
					>
						<MessageSquare size={20} />
					</IconButton>
					<IconButton
						asChild
						size="3"
						variant="surface"
						color={grayColor}
						title="View on GitHub"
						style={{
							backgroundColor: "var(--glass-bg)",
							backdropFilter: "blur(var(--glass-blur))",
							boxShadow: "0 0 0 1px var(--glass-border)",
						}}
					>
						<a
							href="https://github.com/chen-ye/open-aerocharts"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="View on GitHub"
						>
							<VisuallyHidden>View on GitHub</VisuallyHidden>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
								<path d="M9 18c-4.51 2-5-2-7-2" />
							</svg>
						</a>
					</IconButton>
				</Flex>
			</Box>
		);
	}

	return (
		<Box
			className="desktop-only"
			position="absolute"
			top="4"
			left="4"
			style={{ zIndex: 10, maxWidth: "90vw" }}
		>
			<Card
				size="2"
				style={{
					width: 350,
					maxHeight: "80vh",
					display: "flex",
					flexDirection: "column",
					backgroundColor: "var(--glass-bg)",
					backdropFilter: "blur(var(--glass-blur))",
					boxShadow: "0 0 0 1px var(--glass-border)",
				}}
			>
				<Flex justify="between" align="center" mb="3">
					<Heading size="3">Flight Plan</Heading>
					<IconButton variant="ghost" onClick={() => setIsOpen(false)}>
						<X size={18} />
					</IconButton>
				</Flex>
				<FlightPlanContent
					onFlightPlanChange={onFlightPlanChange}
					routeString={routeString}
					onRouteStringChange={onRouteStringChange}
					index={index}
					loading={loading}
					onRequestIndex={onRequestIndex}
				/>
			</Card>
		</Box>
	);
};
