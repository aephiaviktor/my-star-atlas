'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bs58Module = require('bs58');
const crypto = require('crypto');
const { decodeMarketplaceAssetFlows, formatAssetFlowInfluxLine, buildAssetFlowLedgerEvents, projectAssetFlowInfluxRows } = require('../electron/marketplace-asset-flow');
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
  const rows = decodeMarketplaceAssetFlows(tx, { trackedWallets: ['handler'], assetsByMint: { 'food-mint': { name: 'Food' } }, starbasesByKey: { starbase: { name: 'UST-1', faction: 'USTUR' } }, atlasPerSol: 1000 });
  assert.deepEqual(rows[0], { id: 'sig:0:deposit', timestamp: '2026-07-15T23:47:25.000Z', signature: 'sig', type: 'transfer', asset: 'Food', rawMint: 'food-mint', quantity: 25, origin: 'wallet:handler', destination: 'UST-1', txFeeAtlas: 0.005, flow: 'css-deposit', faction: 'USTUR', starbase: 'UST-1' });
  assert.equal(buildAssetFlowLedgerEvents(rows)[0].destination, 'UST-1');
  assert.match(formatAssetFlowInfluxLine(rows[0]), /^asset_flow,/);
  assert.match(formatAssetFlowInfluxLine(rows[0]), /faction=USTUR,starbase=UST-1/);
});

test('Influx projection preserves custody dimensions needed by GM accounting', () => {
  assert.deepEqual(projectAssetFlowInfluxRows([{
    _time: '2026-08-01T00:00:00Z', flowId: 'flow', flow: 'css-withdraw', faction: 'USTUR', starbase: 'UST-1',
    origin: 'UST-1', destination: 'wallet:handler', asset: 'Electronics', rawMint: 'mint', signature: 'sig', quantity: '25', txFeeAtlas: '0.01',
  }]), [{
    id: 'flow', flowId: 'flow', type: 'transfer', timestamp: '2026-08-01T00:00:00Z', flow: 'css-withdraw', faction: 'USTUR', starbase: 'UST-1',
    origin: 'UST-1', destination: 'wallet:handler', asset: 'Electronics', rawMint: 'mint', signature: 'sig', quantity: 25, txFeeAtlas: 0.01, cargoCost: 0.01,
  }]);
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
});

test('decodes an incoming SPL transfer when only the receiving wallet is tracked', () => {
  const keys = ['payer', 'source-ata', 'destination-ata'];
  const balances = [
    { accountIndex: 1, owner: 'upstream-wallet', mint: 'food-mint', uiTokenAmount: { uiAmountString: '10' } },
    { accountIndex: 2, owner: 'gm-wallet', mint: 'food-mint', uiTokenAmount: { uiAmountString: '0' } },
  ];
  const tx = transaction({ programId: 'token', parsed: { type: 'transferChecked', info: { source: 'source-ata', destination: 'destination-ata', mint: 'food-mint', tokenAmount: { uiAmountString: '10' } } } }, keys, balances);
  const rows = decodeMarketplaceAssetFlows(tx, { trackedWallets: ['gm-wallet'], assetsByMint: { 'food-mint': { name: 'Food' } } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origin, 'wallet:upstream-wallet');
  assert.equal(rows[0].destination, 'wallet:gm-wallet');
});
