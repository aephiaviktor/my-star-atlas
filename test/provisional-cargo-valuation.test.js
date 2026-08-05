'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAtlasPriceResolver } = require('../electron/atlas-price-resolver');
const { projectRawCostEvents, valueCanonicalRawCosts, aggregateRawCostsByFleetDay } = require('../electron/cargo-cost-source');
const { projectCargoTableRow } = require('../electron/cargo-table-projection');

const fuel = (overrides = {}) => ({ _time:'2026-08-05T00:00:00Z', schemaVersion:'1', eventType:'fuel', eventIdentity:'f', fuelQuantity:'12.500000000000001', movementEventId:'m', cycleId:'c', movementIndex:'0', timestampProvenance:'solana_block_time', sourceProvenance:'confirmed_movement', faction:'MUD', instance:'MUD', fleetAccount:'fleet', ...overrides });
const sol = (overrides = {}) => ({ _time:'2026-08-05T00:00:00Z', schemaVersion:'1', eventType:'sol_fee', eventIdentity:'s', txFeeLamports:'5001', transactionSignature:'sig', timestampProvenance:'solana_block_time', sourceProvenance:'confirmed_transaction', faction:'MUD', instance:'MUD', fleetAccount:'fleet', ...overrides });

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-provisional-'));
  const filePath = path.join(root, 'seed.json');
  try { await run(createAtlasPriceResolver({ filePath, now: () => '2026-08-04T12:00:00Z' }), filePath); }
  finally { await fs.rm(root, { recursive:true, force:true }); }
}

test('August 5 Fuel and lamports use exact August 4 seed provisionally', async () => fixture(async (resolver) => {
  await resolver.captureCurrentPriceSeeds({ Fuel:'0.00102448', SOL:'144.25' });
  const records = projectRawCostEvents([fuel(), sol()]).records;
  const valued = await valueCanonicalRawCosts(records, { resolvePrice:(asset, day) => resolver.resolveAtlasPrice(asset, day) });
  const fv = valued.find((r) => r.eventType === 'fuel').valuation;
  const sv = valued.find((r) => r.eventType === 'sol_fee').valuation;
  assert.deepEqual({status:fv.status,eventDay:fv.eventDay,priceDay:fv.priceDay,source:fv.source,amount:fv.amountATLExact}, {status:'provisional',eventDay:'2026-08-05',priceDay:'2026-08-04',source:'provisional_seed_carry_forward',amount:'0.01280600000000000102448'});
  assert.deepEqual({status:sv.status,eventDay:sv.eventDay,priceDay:sv.priceDay,source:sv.source,amount:sv.amountATLExact}, {status:'provisional',eventDay:'2026-08-05',priceDay:'2026-08-04',source:'provisional_seed_carry_forward',amount:'0.00072139425'});
}));

test('exact-day authority supersedes provisional and no nearest/future fallback is used', async () => fixture(async (resolver) => {
  await resolver.captureCurrentPriceSeeds({ Fuel:'2' });
  const exact = await resolver.resolveAtlasPrice('Fuel','2026-08-05',{historicalByDate:{'2026-08-05':{fuel:{priceATL:'3.25',source:'aephia_historical'}}}});
  assert.equal(exact.status,'complete'); assert.equal(exact.priceATLExact,'3.25'); assert.equal(exact.priceDay,'2026-08-05');
  const futureOnly = await resolver.resolveAtlasPrice('Fuel','2026-08-05',{historicalByDate:{'2026-08-06':{fuel:{priceATL:'9'}}}});
  assert.equal(futureOnly.status,'provisional'); assert.equal(futureOnly.priceATLExact,'2');
}));

test('missing, malformed, zero, or negative August 4 seed stays incomplete', async () => fixture(async (resolver, filePath) => {
  assert.equal((await resolver.resolveAtlasPrice('Fuel','2026-08-05')).status,'incomplete');
  await fs.writeFile(filePath, JSON.stringify({schemaVersion:1,seeds:{fuel:{effectiveUtcStart:'2026-07-06',effectiveUtcEnd:'2026-08-04',priceATL:0}},historical:{}}));
  const result = await resolver.resolveAtlasPrice('Fuel','2026-08-05');
  assert.equal(result.status,'incomplete'); assert.equal(result.priceATL,null); assert.equal(result.reason,'provisional_seed_invalid');
}));

test('scoped and unallocated native costs preserve identities, allocations, and exact totals', async () => fixture(async (resolver) => {
  await resolver.captureCurrentPriceSeeds({Fuel:'2',SOL:'100'});
  const projected = projectRawCostEvents([fuel(), sol(), fuel({eventIdentity:'u',movementEventId:'u',fleetAccount:''})]);
  const before = projected.records.map(({id,fleetAccount,fuelQuantity,txFeeLamports}) => ({id,fleetAccount,fuelQuantity,txFeeLamports}));
  const valued = await valueCanonicalRawCosts(projected.records,{resolvePrice:(a,d)=>resolver.resolveAtlasPrice(a,d)});
  assert.deepEqual(valued.map(({id,fleetAccount,fuelQuantity,txFeeLamports}) => ({id,fleetAccount,fuelQuantity,txFeeLamports})),before);
  const daily=aggregateRawCostsByFleetDay(valued);
  assert.ok(daily.some((r)=>r.allocationStatus==='scoped')); assert.ok(daily.some((r)=>r.allocationStatus==='unallocated'));
  assert.equal(daily.reduce((n,r)=>n+BigInt(r.txFeeLamports),0n),5001n);
}));

test('Cargo projection unifies dates, retains UTC day, and never renders null as zero', () => {
  const canonical=projectCargoTableRow({isoDate:'2026-08-05',sourceMode:'canonical_raw',fuelCostsAtlas:null},{formatDate:(d)=>`fmt:${d}`});
  const legacy=projectCargoTableRow({isoDate:'2026-08-04',label:'08/04',sourceMode:'legacy'},{formatDate:(d)=>`fmt:${d}`});
  assert.equal(canonical.label,'fmt:2026-08-05'); assert.equal(legacy.label,'fmt:2026-08-04');
  assert.equal(canonical.isoDate,'2026-08-05'); assert.equal(canonical.fuelCostsAtlas,null);
});

test('presentation hides internal price provenance without adding RPC, polling, or cadence', async () => {
  const renderer=await fs.readFile(path.join(__dirname,'..','electron','renderer.js'),'utf8');
  const source=await fs.readFile(path.join(__dirname,'..','electron','cargo-cost-source.js'),'utf8');
  const projection=await fs.readFile(path.join(__dirname,'..','electron','cargo-table-projection.js'),'utf8');
  assert.doesNotMatch(renderer,/provisional-valuation-indicator|incomplete-valuation-indicator|Incomplete valuation|fallback price day/);
  assert.doesNotMatch(source+projection,/Connection\(|getAccountInfo|setInterval|setTimeout|polling/i);
});
