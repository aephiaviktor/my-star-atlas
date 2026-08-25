'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bs58Module = require('bs58');
const crypto = require('crypto');
const { decodeMarketplaceAssetFlows, formatAssetFlowInfluxLine, buildAssetFlowLedgerEvents } = require('../electron/marketplace-asset-flow');
const bs58 = bs58Module.default || bs58Module;
const SAGE = 'SAGE2HAwep459SNq61LHvjxPk4pLPEJLoMETef7f7EE';

function sageData(name, amount) {
  const discriminator = crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
  const bytes = Buffer.alloc(10); bytes.writeBigUInt64LE(BigInt(amount));
  return bs58.encode(Buffer.concat([discriminator, bytes]));
}
function transaction(instruction, accountKeys, balances = []) {
  return { signature: 'sig', blockTime: 1784159245, meta: { err: null, fee: 5000, preTokenBalances: balances, postTokenBalances: balances }, transaction: { signatures: ['sig'], message: { accountKeys, instructions: [instruction] } } };
}

test('decodes CSS deposit as a wallet-to-starbase custody transfer', () => {
  const accounts = ['starbase', 'starbase-player', 'pod', 'cargo-type', 'stats', 'handler', 'profile', 'faction', 'game', 'state', 'wallet-ata', 'pod-ata', 'cargo-program', 'token-program'];
  const tx = transaction({ programId: SAGE, accounts, data: sageData('deposit_cargo_to_game', 25) }, accounts, [{ accountIndex: 10, owner: 'handler', mint: 'food-mint', uiTokenAmount: { uiAmountString: '25' } }]);
  const rows = decodeMarketplaceAssetFlows(tx, { trackedWallets: ['handler'], walletLineage: { handler: { faction: 'USTUR', profile: 'profile-ustur' } }, assetsByMint: { 'food-mint': { name: 'Food' } }, starbasesByKey: { starbase: 'UST-1' }, atlasPerSol: 1000 });
  assert.deepEqual(rows[0], { id: 'sig:0:deposit', timestamp: '2026-07-15T23:47:25.000Z', signature: 'sig', type: 'transfer', asset: 'Food', rawMint: 'food-mint', quantity: 25, origin: 'wallet:handler', destination: 'UST-1', txFeeAtlas: 0.005, flow: 'css-deposit', schemaVersion: 2, wallet: 'handler', faction: 'USTUR', profile: 'profile-ustur', lineageStatus: 'proven', provenance: 'sage_css_transfer' });
  assert.equal(buildAssetFlowLedgerEvents(rows)[0].destination, 'UST-1');
  assert.match(formatAssetFlowInfluxLine(rows[0]), /^asset_flow,/);
  assert.match(formatAssetFlowInfluxLine(rows[0]), /faction=USTUR,profile=profile-ustur,lineageStatus=proven/);
  assert.match(formatAssetFlowInfluxLine(rows[0]), /schemaVersion=2i/);
  assert.match(formatAssetFlowInfluxLine(rows[0]), /wallet="handler",provenance="sage_css_transfer"/);
});

test('decodes direct tracked-wallet SPL transfer and divides one tx fee across flows', () => {
  const keys = ['payer', 'source-ata', 'destination-ata'];
  const balances = [
    { accountIndex: 1, owner: 'gm-wallet', mint: 'food-mint', uiTokenAmount: { uiAmountString: '10' } },
    { accountIndex: 2, owner: 'handler', mint: 'food-mint', uiTokenAmount: { uiAmountString: '0' } },
  ];
  const tx = transaction({ programId: 'token', parsed: { type: 'transferChecked', info: { source: 'source-ata', destination: 'destination-ata', mint: 'food-mint', tokenAmount: { uiAmountString: '10' } } } }, keys, balances);
  const rows = decodeMarketplaceAssetFlows(tx, { trackedWallets: ['gm-wallet', 'handler'], assetsByMint: { 'food-mint': { name: 'Food' } }, atlasPerSol: 1000 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origin, 'wallet:gm-wallet');
  assert.equal(rows[0].destination, 'wallet:handler');
  assert.equal(rows[0].quantity, 10);
  assert.equal(rows[0].lineageStatus, 'unallocated');
});

test('asset-flow publication preserves a large exact quantity without Number conversion', () => {
  const exactQuantity = '123456789012345678901234567890.000000000000000001';
  const line = formatAssetFlowInfluxLine({
    id: 'flow', flow: 'css-deposit', timestamp: '2026-08-24T00:00:00.000Z', asset: 'Carbon', rawMint: 'mint',
    exactQuantity, origin: 'wallet:handler', destination: 'UST-1', txFeeAtlas: '0', schemaVersion: 2,
    wallet: 'handler', faction: 'USTUR', profile: 'profile', lineageStatus: 'proven', provenance: 'sage_css_transfer',
  });
  assert.match(line, new RegExp(`quantity=${exactQuantity.replaceAll('.', '\\.')},`));
});

test('production Influx asset-flow query carries lineage and exact quantity into projection', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const query = source.match(/async function fetchMarketplaceAssetFlowsFromInflux[\s\S]*?\n}\n/)[0];
  assert.match(query, /schemaVersion: Number\(row\.schemaVersion \|\| 1\)/);
  assert.match(query, /const quantity = String\(row\.quantity \?\? ''\)\.trim\(\)/);
  assert.match(query, /exactQuantity: quantity, quantity/);
  for (const field of ['wallet', 'faction', 'profile', 'lineageStatus']) {
    assert.match(query, new RegExp(`${field}: String\\(row\\.${field} \\|\\| ''\\)`));
  }
  assert.match(query, /provenance: String\(row\.provenance \|\| row\.flow \|\| ''\)/);
  assert.doesNotMatch(query, /Number\(row\.quantity/);
});
