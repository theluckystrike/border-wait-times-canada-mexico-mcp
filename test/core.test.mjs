// Fixture test/fixtures/bwtnew-2026-11-16.json is the CBP feed https://bwt.cbp.gov/api/bwtnew downloaded 2026-11-16 (85 crossings,
// 55 on the Mexican border, 30 on the Canadian). Values read off it: San Ysidro cars 150 min with 5 lanes, SENTRI 30 min with 13 lanes,
// pedestrians 70 min; Otay Mesa Passenger cars 90 min, SENTRI 25 min; Tecate cars 60 min; Peace Arch cars 5 min; Port Huron Bluewater
// Bridge cars 30 min (the longest on the Canadian border); Point Roberts and Whirlpool Bridge "Update Pending".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parseFeed, parseLane, stateOf, laneId, matchCrossings, waitTimes, listCrossings, fastestCrossing, InputError, UpstreamError, UTM } from '../dist/core.js';

const BODY = readFileSync(new URL('./fixtures/bwtnew-2026-11-16.json', import.meta.url), 'utf8');
const f = async (u) => { if (u === 'https://bwt.cbp.gov/api/bwtnew') return BODY; throw new Error(`HTTP 404 (no fixture for ${u})`); };
const NOW = new Date('2026-11-16T17:40:00Z');
const ALL = parseFeed(BODY);

test('feed parsing: 85 crossings, borders, states from port codes, lane statuses', () => {
  assert.equal(ALL.length, 85);
  assert.equal(ALL.filter((c) => c.border === 'Mexico').length, 55); assert.equal(ALL.filter((c) => c.border === 'Canada').length, 30);
  assert.equal(stateOf('250401', 'Mexican Border'), 'CA'); assert.equal(stateOf('535501', 'Mexican Border'), 'TX'); assert.equal(stateOf('240601', 'Mexican Border'), 'NM');
  assert.equal(stateOf('l24501', 'Mexican Border'), 'TX'); assert.equal(stateOf('L01901', 'Canadian Border'), 'ME'); assert.equal(stateOf('300402', 'Canadian Border'), 'WA');
  assert.ok(ALL.every((c) => c.state !== null));
  assert.deepEqual(parseLane({ operational_status: 'delay', delay_minutes: '150', lanes_open: '5', update_time: 'At 9:00 am PST' }), { status: 'open', wait_minutes: 150, lanes_open: 5, reported: 'At 9:00 am PST', cbp_status: 'delay' });
  assert.equal(parseLane({ operational_status: 'Lanes Closed', delay_minutes: '', lanes_open: '' }).status, 'closed');
  assert.equal(parseLane({ operational_status: 'Update Pending' }).status, 'pending');
  assert.equal(parseLane({ operational_status: 'N/A' }).status, 'not_offered');
  assert.equal(laneId('SENTRI'), 'sentri_nexus'); assert.equal(laneId('walking'), 'pedestrian'); assert.equal(laneId(undefined), 'car'); assert.throws(() => laneId('boat'), InputError);
});

test('matching: names, cities across the border, areas, states and port numbers', () => {
  assert.equal(matchCrossings(ALL, 'San Ysidro').length, 3);
  assert.equal(matchCrossings(ALL, 'Tijuana').length, 7);
  assert.deepEqual(matchCrossings(ALL, 'peace arch').map((c) => c.port_number), ['300402']);
  assert.equal(matchCrossings(ALL, 'Ambassador Bridge')[0].name, 'Detroit - Ambassador Bridge');
  assert.equal(matchCrossings(ALL, 'California').length, 11);
  assert.ok(matchCrossings(ALL, 'Ciudad Juárez').every((c) => c.state === 'TX' || c.state === 'NM'));
  assert.deepEqual(matchCrossings(ALL, '2504').map((c) => c.port_number), ['250401', '250409', '250407']);
  assert.equal(matchCrossings(ALL, 'Atlantis').length, 0);
});

test('wait times at San Ysidro: cars 150 min on 5 lanes, SENTRI 30 min, pedestrians 70 min', async () => {
  const r = await waitTimes(f, { crossing: 'San Ysidro' }, NOW);
  assert.equal(r.count, 3);
  const sy = r.crossings[0];
  assert.equal(sy.name, 'San Ysidro'); assert.equal(sy.state, 'CA'); assert.equal(sy.hours, '24 hrs/day');
  assert.equal(sy.lanes.car.wait_minutes, 150); assert.equal(sy.lanes.car.lanes_open, 5); assert.equal(sy.lanes.sentri_nexus.wait_minutes, 30); assert.equal(sy.lanes.sentri_nexus.lanes_open, 13);
  assert.equal(sy.lanes.ready_lane.wait_minutes, 120); assert.equal(sy.lanes.pedestrian.wait_minutes, 70);
  assert.match(r.summary, /San Ysidro \(Mexico, CA, 24 hrs\/day\): car 150 min \(5 lanes open\); sentri nexus 30 min \(13 lanes open\)/);
  assert.ok(r.more.includes(UTM));
});

test('list: Canadian border cars, sorted by wait, Port Huron 30 min last among posted waits, pending after', async () => {
  const r = await listCrossings(f, { border: 'canada', lane: 'car' }, NOW);
  assert.equal(r.count, 30);
  const posted = r.crossings.filter((c) => c.wait_minutes !== null);
  assert.equal(posted[posted.length - 1].name, 'Port Huron - Bluewater Bridge'); assert.equal(posted[posted.length - 1].wait_minutes, 30);
  assert.ok(posted.every((c, i) => i === 0 || posted[i - 1].wait_minutes <= c.wait_minutes));
  assert.deepEqual(r.crossings.slice(-2).map((c) => c.status), ['pending', 'pending']);
  const tx = await listCrossings(f, { state: 'Texas', lane: 'pedestrian' }, NOW);
  assert.ok(tx.crossings.every((c) => c.state === 'TX'));
});

test('fastest crossing: near San Diego by car is Tecate (60 min); SENTRI near Tijuana is Otay Mesa (25 min); an explicit list', async () => {
  const a = await fastestCrossing(f, { near: 'San Diego' }, NOW);
  assert.equal(a.best.name, 'Tecate'); assert.equal(a.best.wait_minutes, 60);
  assert.deepEqual(a.ranking.map((c) => c.name).slice(0, 3), ['Tecate', 'Otay Mesa - Passenger', 'San Ysidro']);
  const b = await fastestCrossing(f, { near: 'Tijuana', lane: 'sentri_nexus' }, NOW);
  assert.equal(b.best.name, 'Otay Mesa - Passenger'); assert.equal(b.best.wait_minutes, 25);
  const c = await fastestCrossing(f, { crossings: ['Ambassador Bridge', 'Windsor Tunnel', 'Bluewater'] }, NOW);
  assert.equal(c.ranking.length, 3); assert.equal(c.ranking[2].name, 'Port Huron - Bluewater Bridge');
});

test('input errors and upstream errors', async () => {
  await assert.rejects(waitTimes(f, { crossing: 'Atlantis' }, NOW), InputError);
  await assert.rejects(waitTimes(f, { crossing: ' ' }, NOW), InputError);
  await assert.rejects(listCrossings(f, { state: 'FL' }, NOW), InputError);
  await assert.rejects(listCrossings(f, { border: 'atlantic' }, NOW), InputError);
  await assert.rejects(fastestCrossing(f, {}, NOW), InputError);
  await assert.rejects(fastestCrossing(f, { crossings: ['San Ysidro', 'Nowhere'] }, NOW), InputError);
  await assert.rejects(waitTimes(async () => '<html>busy</html>', { crossing: 'San Ysidro' }, NOW), UpstreamError);
  await assert.rejects(waitTimes(async () => '[]', { crossing: 'San Ysidro' }, NOW), UpstreamError);
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'border-wait-times-canada-mexico-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['border_wait_times', 'border_wait_times_list', 'border_fastest_crossing']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'border_fastest_crossing', arguments: {} } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
