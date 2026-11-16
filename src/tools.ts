// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, fastestCrossing, listCrossings, waitTimes } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'border-wait-times',
  metaDescription: 'MCP server for live US border wait times at Canada and Mexico land crossings: car, SENTRI and NEXUS, Ready Lane, pedestrian and truck waits and lanes open at every CBP port of entry, and the fastest crossing nearby.',
  intro: 'Live border wait times at every US land port of entry on the Canadian and Mexican borders, read from U.S. Customs and Border Protection.',
};

export const TOOL_INFO = [
  { name: 'border_wait_times', blurb: 'Current waits at one crossing or area (San Ysidro, Peace Arch, Ambassador Bridge, Tijuana, Juarez, a state): car, SENTRI or NEXUS, Ready Lane, walking and truck, with lanes open and hours.' },
  { name: 'border_wait_times_list', blurb: 'Every crossing on the Mexican or Canadian border, or in one state, for one lane type, sorted by the shortest wait.' },
  { name: 'border_fastest_crossing', blurb: 'Rank a set of crossings (or every crossing near an area) by the current wait for your lane type and name the fastest.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const LANE = z.enum(['car', 'sentri_nexus', 'ready_lane', 'pedestrian', 'pedestrian_ready', 'truck', 'truck_fast']).optional()
  .describe('Lane type: car (general), sentri_nexus, ready_lane, pedestrian, pedestrian_ready, truck or truck_fast. Default car.');

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream CBP error'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'Live waits to enter the United States at land ports of entry on the Mexican and Canadian borders, read at call time from U.S. Customs and Border Protection (bwt.cbp.gov). ' +
      'A model cannot know the current line. Use border_wait_times for "San Ysidro wait time" or "border wait Tijuana", border_wait_times_list for every crossing on a border or in a state, ' +
      'and border_fastest_crossing to pick the shortest line. CBP posts waits about once an hour, in local port time. Waits are northbound (into the US) only.',
  });

  server.registerTool('border_wait_times', {
    title: 'Border wait times at a crossing',
    description:
      'Current wait to enter the US at a land border crossing: passenger car general lanes, SENTRI or NEXUS, Ready Lane, pedestrian and commercial truck (FAST) lanes, ' +
      'lanes open, port hours, CBP notices and when CBP last reported. Accepts a port or bridge name (San Ysidro, Otay Mesa, Peace Arch, Ambassador Bridge, Rainbow Bridge), ' +
      'the city across the border (Tijuana, Juarez, Nuevo Laredo, Windsor, Vancouver), a state, or a CBP port number.',
    inputSchema: { crossing: z.string().min(2).max(80).describe('Crossing, city across the border, US border state, or CBP port number.') },
    annotations: { title: 'Border wait times', ...RO },
  }, wrap((a: any) => waitTimes(fetchText, a)));

  server.registerTool('border_wait_times_list', {
    title: 'All border crossing wait times',
    description:
      'Wait times for one lane type at every CBP land port on the Mexican border, the Canadian border, or in one state (CA, AZ, NM, TX, WA, MT, ND, MN, MI, NY, VT, ME), ' +
      'sorted by the shortest wait or by name. Closed and pending lanes are listed after posted waits.',
    inputSchema: {
      border: z.enum(['mexico', 'canada', 'both']).optional().describe('mexico, canada or both (default both).'),
      state: z.string().min(2).max(20).optional().describe('US border state, as a code or a name.'),
      lane: LANE,
      sort: z.enum(['wait', 'name']).optional().describe('wait (default) or name.'),
    },
    annotations: { title: 'All border wait times', ...RO },
  }, wrap((a: any) => listCrossings(fetchText, a)));

  server.registerTool('border_fastest_crossing', {
    title: 'Fastest border crossing',
    description:
      'Rank border crossings by the current wait for a lane type and name the fastest. Pass crossings (e.g. ["San Ysidro", "Otay Mesa", "Tecate"]) or near ' +
      '(an area or state, e.g. "San Diego", "Juarez", "Niagara", "TX"). Drive time to each port is not included.',
    inputSchema: {
      crossings: z.array(z.string().min(2).max(80)).min(1).max(12).optional().describe('Crossing names to compare.'),
      near: z.string().min(2).max(80).optional().describe('An area or state instead of a list.'),
      lane: LANE,
    },
    annotations: { title: 'Fastest border crossing', ...RO },
  }, wrap((a: any) => fastestCrossing(fetchText, a)));

  return server;
}
