// Pure core for border-wait-times-canada-mexico-mcp. The only I/O is a keyless read of the U.S. Customs and Border Protection
// border wait times feed, done through an injected fetchText.
//
// Source (public, no key): https://bwt.cbp.gov/api/bwtnew
//   One JSON array with every land port of entry on the Canadian and Mexican borders (85 crossings on 2026-11-16). Each has
//   passenger_vehicle_lanes {standard_lanes, NEXUS_SENTRI_lanes, ready_lanes}, pedestrian_lanes {standard_lanes, ready_lanes} and
//   commercial_vehicle_lanes {standard_lanes, FAST_lanes}; each lane has operational_status ("no delay", "delay", "Lanes Closed",
//   "Update Pending", "N/A"), delay_minutes, lanes_open and update_time ("At 9:00 am PST", local time at the port).
// CBP officers update the waits about once an hour; the feed is regenerated more often. Answers are cached for 5 minutes.
import type { FetchText } from './types.js';

export const REPO = 'border-wait-times-canada-mexico-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;
export const FEED = 'https://bwt.cbp.gov/api/bwtnew';
export const SOURCE = 'U.S. Customs and Border Protection, Border Wait Times (bwt.cbp.gov). Waits are entering the United States, reported by CBP officers at each port, in minutes.';

export class InputError extends Error {}
export class UpstreamError extends Error {}

export const LANES = {
  car: { group: 'passenger_vehicle_lanes', lane: 'standard_lanes', label: 'Passenger vehicles, general lanes' },
  sentri_nexus: { group: 'passenger_vehicle_lanes', lane: 'NEXUS_SENTRI_lanes', label: 'Passenger vehicles, SENTRI (Mexico) or NEXUS (Canada)' },
  ready_lane: { group: 'passenger_vehicle_lanes', lane: 'ready_lanes', label: 'Passenger vehicles, Ready Lane (RFID cards)' },
  pedestrian: { group: 'pedestrian_lanes', lane: 'standard_lanes', label: 'Pedestrians, general lanes' },
  pedestrian_ready: { group: 'pedestrian_lanes', lane: 'ready_lanes', label: 'Pedestrians, Ready Lane' },
  truck: { group: 'commercial_vehicle_lanes', lane: 'standard_lanes', label: 'Commercial vehicles, general lanes' },
  truck_fast: { group: 'commercial_vehicle_lanes', lane: 'FAST_lanes', label: 'Commercial vehicles, FAST lanes' },
} as const;
export type LaneId = keyof typeof LANES;

export function laneId(s: string | undefined): LaneId {
  const k = String(s ?? 'car').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const alias: Record<string, LaneId> = {
    car: 'car', cars: 'car', passenger: 'car', vehicle: 'car', general: 'car', standard: 'car', auto: 'car',
    sentri: 'sentri_nexus', nexus: 'sentri_nexus', sentri_nexus: 'sentri_nexus', nexus_sentri: 'sentri_nexus', trusted_traveler: 'sentri_nexus',
    ready: 'ready_lane', ready_lane: 'ready_lane', readylane: 'ready_lane',
    pedestrian: 'pedestrian', walk: 'pedestrian', walking: 'pedestrian', foot: 'pedestrian', pedestrians: 'pedestrian',
    pedestrian_ready: 'pedestrian_ready', pedestrian_ready_lane: 'pedestrian_ready',
    truck: 'truck', trucks: 'truck', commercial: 'truck', cargo: 'truck', fast: 'truck_fast', truck_fast: 'truck_fast', fast_lane: 'truck_fast',
  };
  if (alias[k]) return alias[k];
  throw new InputError(`unknown lane "${s}". Use car, sentri_nexus, ready_lane, pedestrian, pedestrian_ready, truck or truck_fast.`);
}

export interface LaneWait { status: 'open' | 'closed' | 'pending' | 'not_offered'; wait_minutes: number | null; lanes_open: number | null; reported: string | null; cbp_status: string }
export interface Crossing {
  port_number: string; border: 'Canada' | 'Mexico'; state: string | null; port_name: string; crossing_name: string; name: string; hours: string;
  port_status: string; feed_time: string; notice: string | null; lanes: Record<LaneId, LaneWait>;
}

/** State from the CBP port code (district prefix). */
export function stateOf(port: string, border: string): string | null {
  const p = port.toUpperCase();
  if (p.startsWith('L01') || p.startsWith('01')) return 'ME';
  if (p.startsWith('02')) return 'VT';
  if (p.startsWith('07') || p.startsWith('09')) return 'NY';
  if (p.startsWith('30')) return 'WA';
  if (p.startsWith('33')) return 'MT';
  if (p.startsWith('34')) return 'ND';
  if (p.startsWith('36')) return 'MN';
  if (p.startsWith('38')) return 'MI';
  if (p.startsWith('25')) return 'CA';
  if (p.startsWith('26')) return 'AZ';
  if (p.startsWith('2406') || p.startsWith('2408')) return 'NM';
  if (p.startsWith('23') || p.startsWith('24') || p.startsWith('L24') || p.startsWith('53') || p.startsWith('20')) return 'TX';
  return null;
}

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = (s: unknown) => { const t = clean(s); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };

export function parseLane(l: any): LaneWait {
  const st = clean(l?.operational_status);
  const s = st.toLowerCase();
  const wait = num(l?.delay_minutes), open = num(l?.lanes_open);
  const reported = clean(l?.update_time) || null;
  if (s === 'n/a' || s === '') return { status: 'not_offered', wait_minutes: null, lanes_open: null, reported: null, cbp_status: st || 'N/A' };
  if (s.includes('closed')) return { status: 'closed', wait_minutes: null, lanes_open: 0, reported, cbp_status: st };
  if (s.includes('pending')) return { status: 'pending', wait_minutes: null, lanes_open: open, reported, cbp_status: st };
  return { status: 'open', wait_minutes: wait, lanes_open: open, reported, cbp_status: st };
}

export function parseFeed(body: string): Crossing[] {
  let rows: unknown;
  try { rows = JSON.parse(body); } catch { throw new UpstreamError('bwt.cbp.gov returned something that is not JSON'); }
  if (!Array.isArray(rows) || !rows.length) throw new UpstreamError('bwt.cbp.gov returned an empty list of ports');
  return rows.map((r: any) => {
    const border = clean(r.border).startsWith('Can') ? 'Canada' : 'Mexico';
    const port_name = clean(r.port_name), crossing_name = clean(r.crossing_name);
    const lanes = {} as Record<LaneId, LaneWait>;
    for (const [id, spec] of Object.entries(LANES)) lanes[id as LaneId] = parseLane(r?.[spec.group]?.[spec.lane]);
    const name = crossing_name && crossing_name.toLowerCase() !== port_name.toLowerCase() ? `${port_name} - ${crossing_name}` : port_name;
    return {
      port_number: clean(r.port_number), border, state: stateOf(clean(r.port_number), border), port_name, crossing_name, name, hours: clean(r.hours),
      port_status: clean(r.port_status), feed_time: `${clean(r.date)} ${clean(r.time)}`.trim(), notice: clean(r.construction_notice) || null, lanes,
    } as Crossing;
  });
}

export async function load(f: FetchText): Promise<Crossing[]> {
  return parseFeed(await f(FEED, { cacheTtl: 300, timeoutMs: 20000 }));
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STATE_NAMES: Record<string, string> = { california: 'CA', arizona: 'AZ', 'new mexico': 'NM', texas: 'TX', washington: 'WA', montana: 'MT', 'north dakota': 'ND', minnesota: 'MN', michigan: 'MI', 'new york': 'NY', vermont: 'VT', maine: 'ME' };
// Common names people use for a crossing or an area that the feed does not carry, mapped to feed names.
const NICKNAMES: Record<string, string[]> = {
  tijuana: ['san ysidro', 'otay mesa'], 'san diego': ['san ysidro', 'otay mesa', 'tecate'], chaparral: ['san ysidro'], mexicali: ['calexico'], juarez: ['el paso', 'santa teresa', 'marcelino serna'],
  'ciudad juarez': ['el paso', 'santa teresa', 'marcelino serna'], 'nuevo laredo': ['laredo'], reynosa: ['hidalgo pharr'], mcallen: ['hidalgo pharr', 'progreso'], 'rio grande valley': ['brownsville', 'hidalgo pharr', 'progreso', 'rio grande city', 'roma'],
  matamoros: ['brownsville'], 'piedras negras': ['eagle pass'], 'ciudad acuna': ['del rio'], acuna: ['del rio'], 'agua prieta': ['douglas'], sonoyta: ['lukeville'], 'puerto penasco': ['lukeville'], 'rocky point': ['lukeville'],
  'san luis rio colorado': ['san luis'], 'los algodones': ['andrade'], algodones: ['andrade'], yuma: ['san luis', 'andrade'], tucson: ['nogales', 'lukeville', 'douglas', 'naco'], ojinaga: ['presidio'],
  windsor: ['detroit'], sarnia: ['port huron'], niagara: ['buffalo niagara falls'], 'niagara falls': ['buffalo niagara falls'], toronto: ['buffalo niagara falls', 'lewiston'], 'fort erie': ['peace bridge'],
  vancouver: ['blaine', 'lynden', 'sumas'], seattle: ['blaine', 'lynden', 'sumas'], surrey: ['blaine'], 'white rock': ['blaine'], montreal: ['champlain', 'highgate springs', 'derby line'], lacolle: ['champlain'],
  'st stephen': ['calais'], stanstead: ['derby line'], emerson: ['pembina'], winnipeg: ['pembina'], coutts: ['sweetgrass'], calgary: ['sweetgrass'], 'fort frances': ['international falls'], ottawa: ['ogdensburg', 'alexandria bay', 'massena'],
  cbx: ['cross border express'], 'cross border xpress': ['cross border express'], bota: ['bridge of the americas'], pdn: ['paso del norte'], zaragoza: ['ysleta'],
};

export function matchCrossings(all: Crossing[], query: string): Crossing[] {
  const q = norm(query);
  if (!q) return [];
  const st = STATE_NAMES[q] ?? (q.length === 2 ? q.toUpperCase() : null);
  if (st && all.some((c) => c.state === st)) return all.filter((c) => c.state === st);
  if (/^\d{4,6}$/.test(q)) return all.filter((c) => c.port_number.startsWith(q));
  const hay = (c: Crossing) => norm(`${c.port_name} ${c.crossing_name}`);
  const direct = all.filter((c) => hay(c).includes(q));
  if (direct.length) return direct;
  const nick = NICKNAMES[q];
  if (nick) return all.filter((c) => nick.some((n) => hay(c).includes(n)));
  const words = q.split(' ').filter((w) => w.length > 2);
  return words.length ? all.filter((c) => words.every((w) => hay(c).includes(w))) : [];
}

export function fmtLane(w: LaneWait): string {
  if (w.status === 'open') return w.wait_minutes === null ? 'open, no time posted' : `${w.wait_minutes} min${w.lanes_open !== null ? ` (${w.lanes_open} lane${w.lanes_open === 1 ? '' : 's'} open)` : ''}`;
  if (w.status === 'closed') return 'lanes closed';
  if (w.status === 'pending') return 'update pending';
  return 'not offered';
}

function line(c: Crossing, ids: LaneId[] = ['car', 'sentri_nexus', 'ready_lane', 'pedestrian', 'truck']): string {
  const parts = ids.filter((id) => c.lanes[id].status !== 'not_offered').map((id) => `${id.replace('_', ' ')} ${fmtLane(c.lanes[id])}`);
  const rep = c.lanes.car.reported ?? c.lanes.pedestrian.reported ?? c.lanes.truck.reported;
  return `${c.name} (${c.border}${c.state ? `, ${c.state}` : ''}, ${c.hours}): ${parts.length ? parts.join('; ') : 'no waits posted'}${rep ? `. Reported ${rep.replace(/^At /, 'at ')}` : ''}`;
}

export async function waitTimes(f: FetchText, a: { crossing: string }, now = new Date()) {
  if (!a.crossing || !String(a.crossing).trim()) throw new InputError('crossing is required: a port or bridge name (San Ysidro, Peace Arch, Ambassador Bridge), a Mexican or Canadian city across from it, or a state');
  const all = await load(f);
  const hits = matchCrossings(all, a.crossing);
  if (!hits.length) {
    throw new InputError(`no CBP crossing matches "${a.crossing}". Ports on the Mexican border include ${[...new Set(all.filter((c) => c.border === 'Mexico').map((c) => c.port_name))].slice(0, 12).join(', ')}; ` +
      `on the Canadian border ${[...new Set(all.filter((c) => c.border === 'Canada').map((c) => c.port_name))].slice(0, 12).join(', ')}. Use border_wait_times_list for all of them.`);
  }
  const shown = hits.slice(0, 15);
  const summary = `${hits.length} crossing${hits.length === 1 ? '' : 's'} matching "${a.crossing}", waits to enter the US:\n${shown.map((c) => line(c)).join('\n')}` +
    (hits.length > shown.length ? `\n(${hits.length - shown.length} more in crossings)` : '') +
    (shown.some((c) => c.notice) ? `\nNotices: ${shown.filter((c) => c.notice).map((c) => `${c.name}: ${c.notice}`).join(' | ')}` : '');
  return { summary, query: a.crossing, count: hits.length, crossings: hits, as_of: now.toISOString(), source: SOURCE, more: more() };
}

export async function listCrossings(f: FetchText, a: { border?: string; state?: string; lane?: string; sort?: 'wait' | 'name' }, now = new Date()) {
  const lane = laneId(a.lane);
  const b = a.border ? String(a.border).toLowerCase() : '';
  if (b && !['mexico', 'canada', 'mexican', 'canadian', 'both'].includes(b)) throw new InputError('border must be mexico, canada or both');
  let all = await load(f);
  if (b.startsWith('mex')) all = all.filter((c) => c.border === 'Mexico');
  if (b.startsWith('can')) all = all.filter((c) => c.border === 'Canada');
  if (a.state) {
    const s = STATE_NAMES[norm(a.state)] ?? String(a.state).trim().toUpperCase();
    all = all.filter((c) => c.state === s);
    if (!all.length) throw new InputError(`no land border crossings in state "${a.state}". Border states: WA, MT, ND, MN, MI, NY, VT, ME, CA, AZ, NM, TX.`);
  }
  const withLane = all.filter((c) => c.lanes[lane].status !== 'not_offered');
  const rows = (a.sort === 'name' ? [...withLane].sort((x, y) => x.name.localeCompare(y.name)) : rankByWait(withLane, lane));
  const summary = `${LANES[lane].label}, waits to enter the US at ${rows.length} crossing${rows.length === 1 ? '' : 's'}${a.border && b !== 'both' ? ` on the ${b.startsWith('mex') ? 'Mexican' : 'Canadian'} border` : ''}${a.state ? ` in ${a.state}` : ''}:\n` +
    rows.map((c) => `${c.name}${c.state ? ` (${c.state})` : ''}: ${fmtLane(c.lanes[lane])}`).join('\n');
  return { summary, lane, lane_label: LANES[lane].label, count: rows.length,
    crossings: rows.map((c) => ({ name: c.name, port_number: c.port_number, border: c.border, state: c.state, hours: c.hours, ...c.lanes[lane] })), as_of: now.toISOString(), source: SOURCE, more: more() };
}

export function rankByWait(cs: Crossing[], lane: LaneId): Crossing[] {
  const key = (c: Crossing) => { const w = c.lanes[lane]; return w.status === 'open' && w.wait_minutes !== null ? w.wait_minutes : w.status === 'pending' || w.status === 'open' ? 1e6 : 2e6; };
  return [...cs].sort((x, y) => key(x) - key(y) || x.name.localeCompare(y.name));
}

export async function fastestCrossing(f: FetchText, a: { crossings?: string[]; near?: string; lane?: string }, now = new Date()) {
  const lane = laneId(a.lane);
  const all = await load(f);
  let pool: Crossing[] = [];
  if (a.crossings?.length) {
    if (a.crossings.length > 12) throw new InputError('compare at most 12 crossings');
    for (const q of a.crossings) {
      const hits = matchCrossings(all, q);
      if (!hits.length) throw new InputError(`no CBP crossing matches "${q}"`);
      for (const h of hits) if (!pool.includes(h)) pool.push(h);
    }
  } else if (a.near) {
    pool = matchCrossings(all, a.near);
    if (!pool.length) throw new InputError(`no CBP crossing matches "${a.near}". Pass a state (CA, TX, WA, MI ...) or crossing names.`);
  } else throw new InputError('pass crossings (a list of names) or near (a state or area such as "San Diego", "TX" or "Niagara")');
  const ranked = rankByWait(pool.filter((c) => c.lanes[lane].status !== 'not_offered'), lane);
  const best = ranked.find((c) => c.lanes[lane].status === 'open' && c.lanes[lane].wait_minutes !== null);
  const summary = (best ? `Shortest ${LANES[lane].label.toLowerCase()} wait right now: ${best.name}${best.state ? ` (${best.state})` : ''}, ${fmtLane(best.lanes[lane])}.` : `No ${LANES[lane].label.toLowerCase()} wait is posted at these crossings right now.`) +
    `\n${ranked.map((c, i) => `${i + 1}. ${c.name}: ${fmtLane(c.lanes[lane])}, hours ${c.hours}`).join('\n')}` +
    '\nWaits are posted by CBP about hourly; drive time to each port is not included.';
  return { summary, lane, lane_label: LANES[lane].label, best: best ? { name: best.name, port_number: best.port_number, ...best.lanes[lane] } : null,
    ranking: ranked.map((c) => ({ name: c.name, port_number: c.port_number, state: c.state, hours: c.hours, ...c.lanes[lane] })), as_of: now.toISOString(), source: SOURCE, more: more() };
}
