// Local type declarations for d3 sub-packages that don't bundle their own types.
// These cover only the API surface used in this plugin.

declare module 'd3-force' {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
  }

  export interface SimulationLinkDatum<NodeDatum extends SimulationNodeDatum> {
    source: NodeDatum | string | number;
    target: NodeDatum | string | number;
    index?: number;
  }

  export interface Simulation<NodeDatum extends SimulationNodeDatum, LinkDatum extends SimulationLinkDatum<NodeDatum> | undefined> {
    force(name: string, force?: Force<NodeDatum, LinkDatum> | null): this;
    alphaDecay(decay: number): this;
    alphaTarget(target: number): this;
    on(typenames: string, listener: (this: Simulation<NodeDatum, LinkDatum>) => void): this;
    restart(): this;
    stop(): this;
    nodes(): NodeDatum[];
  }

  export interface Force<NodeDatum extends SimulationNodeDatum, LinkDatum extends SimulationLinkDatum<NodeDatum> | undefined> {}

  export interface ForceLink<NodeDatum extends SimulationNodeDatum, LinkDatum extends SimulationLinkDatum<NodeDatum>> extends Force<NodeDatum, LinkDatum> {
    id(fn: (d: NodeDatum) => string): this;
    distance(d: number): this;
    strength(s: number): this;
  }

  export interface ForceManyBody<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum, undefined> {
    strength(s: number): this;
    distanceMax(d: number): this;
  }

  export interface ForceCenter<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum, undefined> {}

  export interface ForceCollide<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum, undefined> {
    radius(r: number): this;
  }

  export interface ForceX<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum, undefined> {
    strength(s: number | ((d: NodeDatum) => number)): this;
    x(x: number | ((d: NodeDatum) => number)): this;
  }

  export interface ForceY<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum, undefined> {
    strength(s: number | ((d: NodeDatum) => number)): this;
    y(y: number | ((d: NodeDatum) => number)): this;
  }

  export function forceSimulation<NodeDatum extends SimulationNodeDatum>(nodes?: NodeDatum[]): Simulation<NodeDatum, undefined>;
  export function forceLink<NodeDatum extends SimulationNodeDatum, LinkDatum extends SimulationLinkDatum<NodeDatum>>(links?: LinkDatum[]): ForceLink<NodeDatum, LinkDatum>;
  export function forceManyBody<NodeDatum extends SimulationNodeDatum>(): ForceManyBody<NodeDatum>;
  export function forceCenter<NodeDatum extends SimulationNodeDatum>(x?: number, y?: number): ForceCenter<NodeDatum>;
  export function forceCollide<NodeDatum extends SimulationNodeDatum>(radius?: number): ForceCollide<NodeDatum>;
  export function forceX<NodeDatum extends SimulationNodeDatum>(x?: number): ForceX<NodeDatum>;
  export function forceY<NodeDatum extends SimulationNodeDatum>(y?: number): ForceY<NodeDatum>;
}

declare module 'd3-quadtree' {
  export interface Quadtree<Datum> {
    x(fn: (d: Datum) => number): this;
    y(fn: (d: Datum) => number): this;
    addAll(data: Datum[]): this;
    find(x: number, y: number, radius?: number): Datum | undefined;
  }

  export function quadtree<Datum>(): Quadtree<Datum>;
}
