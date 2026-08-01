'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const compat = require('../electron/marketplace-trade-compat');
const point = require('../electron/marketplace-v2-point');

const context = { applicationProfile: 'USTUR', selectedProfile: 'PlayerKey', faction: 'USTUR', scopeProven: true };
const base = { _time: '2026-08-01T00:00:00Z', tradeId: 'legacy-id', market: 'LM', faction: 'USTUR', profile: 'PlayerKey', signature: 'sig', rawMint: 'mint', side: 'buy', quantity: 2, settledAtlas: 20, grossAtlas: 20, marketplaceFeeAtlas: 1, netAtlas: 19, unitPriceAtlas: 10, wallet: 'wallet', starbase: 'star', asset: 'asset', certificateMint: 'cert' };
const stableId = point.deriveMarketplaceTradeId({ market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: 'sig', rawMint: 'mint', side: 'buy', quantity: 2 });
function v2(rank='fallback') {
  const prefix = rank;
  const row = { _time: base._time, market: 'LM', faction: 'USTUR', profile: 'USTUR', executionSignature: 'sig', rawMint: 'mint', side: 'buy', tradeId: stableId };
  Object.assign(row, { [`${prefix}Quantity`]:2, [`${prefix}SettledAtlas`]:20, [`${prefix}GrossAtlas`]:20, [`${prefix}MarketplaceFeeAtlas`]:1, [`${prefix}NetAtlas`]:19, [`${prefix}UnitPriceAtlas`]:10, [`${prefix}Wallet`]:'wallet', [`${prefix}Starbase`]:'star', [`${prefix}Asset`]:'asset', [`${prefix}CertificateMint`]:'cert' });
  if (rank === 'enriched') Object.assign(row, { enrichedTxFeeAtlas:0.1, enrichedOrderId:'order', enrichedCreationSignature:'create' });
  return row;
}

test('exports exactly the Gate 5 API', () => assert.deepEqual(Object.keys(compat).sort(), ['canonicalRecursiveSerialize','compareMarketplaceRepresentations','dedupeMarketplaceRows','deriveMarketplaceUnionKey','inferMarketplaceV1Rank','normalizeMarketplaceV1Row','normalizeMarketplaceV2Row','resolveMarketplaceProfileScope'].sort()));
test('canonical recursive serialization is order-independent and rejects unsupported content', () => {
  assert.equal(compat.canonicalRecursiveSerialize({b:[2,1],a:{y:true,x:null}}), compat.canonicalRecursiveSerialize({a:{x:null,y:true},b:[2,1]}));
  for (const value of [{x:undefined},{x:Infinity},{x:()=>{}},{x:Symbol('x')}]) assert.throws(() => compat.canonicalRecursiveSerialize(value));
  const cycle={}; cycle.x=cycle; assert.throws(() => compat.canonicalRecursiveSerialize(cycle));
});
test('profile scope maps LM alias/pubkey/scoped missing, rejects mismatches, and GM is GLOBAL', () => {
  for (const rowProfile of ['USTUR','PlayerKey']) assert.equal(compat.resolveMarketplaceProfileScope({market:'LM',applicationProfile:'USTUR',selectedProfile:'PlayerKey',rowProfile}).profileScope,'USTUR');
  assert.equal(compat.resolveMarketplaceProfileScope({market:'LM',applicationProfile:'USTUR',selectedProfile:'PlayerKey',rowProfile:'',scopeProven:true}).certain,true);
  assert.equal(compat.resolveMarketplaceProfileScope({market:'LM',applicationProfile:'USTUR',rowProfile:'',scopeProven:false}).certain,false);
  assert.equal(compat.resolveMarketplaceProfileScope({market:'LM',applicationProfile:'USTUR',rowProfile:'OTHER'}).certain,false);
  assert.equal(compat.resolveMarketplaceProfileScope({market:'GM',rowProfile:'anything'}).profileScope,'GLOBAL');
});
test('v1 normalization derives Gate 1 identity and enrichment only from genuine markers', () => {
  const fallback=compat.normalizeMarketplaceV1Row(base,context); assert.equal(fallback.tradeId,stableId); assert.equal(fallback.id,'legacy-id'); assert.equal(fallback.representationRank,'fallback');
  assert.equal(compat.inferMarketplaceV1Rank({...base,wallet:'x',starbase:'x',asset:'x'}),'fallback');
  for (const patch of [{orderId:'o'},{creationSignature:'c'},{txFeeAtlas:0.1}]) assert.equal(compat.inferMarketplaceV1Rank({...base,...patch}),'enriched');
  assert.equal(compat.normalizeMarketplaceV1Row({...base,signature:''},context).representationRank,'identity_uncertain');
});
test('v2 normalizes complete namespaces, prefers enriched wholly, and rejects tradeId mismatch', () => {
  const fallback=compat.normalizeMarketplaceV2Row(v2(),context); assert.equal(fallback.tradeId,stableId); assert.equal(fallback.representationRank,'fallback');
  const both={...v2(),...v2('enriched'),fallbackGrossAtlas:999}; const enriched=compat.normalizeMarketplaceV2Row(both,context); assert.equal(enriched.representationRank,'enriched'); assert.equal(enriched.grossAtlas,20); assert.equal(enriched.orderId,'order');
  assert.equal(compat.normalizeMarketplaceV2Row({...v2(),tradeId:'wrong'},context),null);
});
test('precedence follows fidelity, generation, vectors and canonical bytes without mixing', () => {
  const f1=compat.normalizeMarketplaceV1Row(base,context), f2=compat.normalizeMarketplaceV2Row(v2(),context);
  const e1=compat.normalizeMarketplaceV1Row({...base,orderId:'v1-order'},context), e2=compat.normalizeMarketplaceV2Row(v2('enriched'),context);
  assert.ok(compat.compareMarketplaceRepresentations(e1,f2)>0); assert.ok(compat.compareMarketplaceRepresentations(e2,e1)>0); assert.ok(compat.compareMarketplaceRepresentations(f2,f1)>0);
  assert.equal(compat.dedupeMarketplaceRows([f2,e1])[0].orderId,'v1-order');
  const a={...e2,asset:'A'}, b={...e2,asset:'B'}; assert.equal(compat.dedupeMarketplaceRows([a,b])[0].asset,'B');
});
test('uncertain rows dedupe only when bounded normalized bytes are identical', () => {
  const a=compat.normalizeMarketplaceV1Row({...base,signature:'',tradeId:'x'},context), b=compat.normalizeMarketplaceV1Row({...base,signature:'',tradeId:'x'},context), c=compat.normalizeMarketplaceV1Row({...base,signature:'',tradeId:'x',asset:'other'},context);
  assert.equal(compat.dedupeMarketplaceRows([a,b]).length,1); assert.equal(compat.dedupeMarketplaceRows([a,c]).length,2);
  const missingProfile=compat.normalizeMarketplaceV1Row({...base,signature:'',profile:''},{...context,scopeProven:false});
  const namedProfile=compat.normalizeMarketplaceV1Row({...base,signature:'',profile:'USTUR'},context);
  assert.notEqual(compat.deriveMarketplaceUnionKey(missingProfile),compat.deriveMarketplaceUnionKey(namedProfile));
});

test('normalized public rows have exactly the consumer schema and preserve v1 profile metadata privately', () => {
  const row=compat.normalizeMarketplaceV1Row(base,context);
  assert.deepEqual(Object.keys(row), ['id','tradeId','timestamp','marketplace','faction','profile','starbase','asset','side','wallet','quantity','settledAtlas','grossAtlas','marketplaceFeeAtlas','txFeeAtlas','netAtlas','unitPriceAtlas','signature','creationSignature','rawMint','certificateMint','orderId','representationRank','schemaGeneration']);
  assert.equal(row.profile,'USTUR'); assert.equal(row.historicalProfile,'PlayerKey');
});

test('all completeness-vector positions are compared lexicographically before canonical bytes', () => {
  const keys=['orderId','creationSignature','txFeeAtlas','settledAtlas','grossAtlas','marketplaceFeeAtlas','netAtlas','unitPriceAtlas'];
  const absent={representationRank:'identity_uncertain',schemaGeneration:'v1',tradeId:'',orderId:'',creationSignature:'',txFeeAtlas:0};
  for(const key of keys){
    const left={...absent}; const right={...absent};
    if(key==='orderId'||key==='creationSignature') right[key]='present';
    else if(key==='txFeeAtlas') right[key]=1;
    else { left[key]=undefined; right[key]=1; }
    assert.ok(compat.compareMarketplaceRepresentations(right,left)>0,key);
  }
});

test('invalid economics remain uncertain and retain distinctions in their deterministic keys', () => {
  const missing=compat.normalizeMarketplaceV1Row({...base,signature:'',grossAtlas:undefined},context);
  const empty=compat.normalizeMarketplaceV1Row({...base,signature:'',grossAtlas:''},context);
  const negative=compat.normalizeMarketplaceV1Row({...base,signature:'',grossAtlas:-1},context);
  assert.equal(missing.representationRank,'identity_uncertain'); assert.equal(empty.representationRank,'identity_uncertain'); assert.equal(negative.representationRank,'identity_uncertain');
  assert.notEqual(compat.deriveMarketplaceUnionKey(missing),compat.deriveMarketplaceUnionKey(negative));
});

test('GM normalization uses GLOBAL identity and permits the accepted empty starbase', () => {
  const gmBase={...base,market:'GM',faction:'GLOBAL',profile:'GLOBAL',signature:'gm-sig',rawMint:'gm-mint',starbase:''};
  const gm=compat.normalizeMarketplaceV1Row(gmBase,{applicationProfile:'USTUR',selectedProfile:'PlayerKey',scopeProven:true});
  assert.equal(gm.profile,'GLOBAL'); assert.equal(gm.faction,'GLOBAL'); assert.equal(gm.marketplace,'GM');
});
