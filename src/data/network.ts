export type NodeId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type Road = { id: string; a: NodeId; b: NodeId; minutes: number; open: boolean };
export type Location = { id: NodeId; name: string; area: string };

export const locations: Location[] = [
  { id: 'A', name: 'Silk Board', area: 'South Bengaluru' },
  { id: 'B', name: 'Agara', area: 'Hosur Road' },
  { id: 'C', name: 'HSR Layout', area: 'Sector 1' },
  { id: 'D', name: 'Ibbaluru', area: 'Outer Ring Road' },
  { id: 'E', name: 'Bellandur', area: 'Outer Ring Road' },
  { id: 'F', name: 'Kadubeesanahalli', area: 'Outer Ring Road' },
  { id: 'G', name: 'Marathahalli', area: 'East Bengaluru' },
];
export const nodeIds = locations.map((location) => location.id);
export const locationById = Object.fromEntries(locations.map((location) => [location.id, location])) as Record<NodeId, Location>;
export const initialRoads: Road[] = [
  { id: 'AB', a: 'A', b: 'B', minutes: 4, open: true },
  { id: 'AC', a: 'A', b: 'C', minutes: 2, open: true },
  { id: 'BC', a: 'B', b: 'C', minutes: 1, open: true },
  { id: 'BD', a: 'B', b: 'D', minutes: 5, open: true },
  { id: 'CD', a: 'C', b: 'D', minutes: 8, open: true },
  { id: 'CE', a: 'C', b: 'E', minutes: 10, open: true },
  { id: 'DE', a: 'D', b: 'E', minutes: 2, open: true },
  { id: 'DF', a: 'D', b: 'F', minutes: 6, open: true },
  { id: 'EF', a: 'E', b: 'F', minutes: 3, open: true },
  { id: 'EG', a: 'E', b: 'G', minutes: 8, open: true },
  { id: 'FG', a: 'F', b: 'G', minutes: 4, open: true },
];

export const pointDefaults: Record<NodeId, { x: number; y: number }> = {
  A: { x: 82, y: 246 }, B: { x: 213, y: 325 }, C: { x: 214, y: 147 },
  D: { x: 365, y: 278 }, E: { x: 440, y: 137 }, F: { x: 565, y: 272 }, G: { x: 685, y: 145 },
};
