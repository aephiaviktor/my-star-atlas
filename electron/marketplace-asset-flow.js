'use strict';

const crypto = require('crypto');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;
const SAGE_PROGRAM_ID = 'SAGE2HAwep459SNq61LHvjxPk4pLPEJLoMETef7f7EE';

function discriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
const DEPOSIT = discriminator('deposit_cargo_to_game');
const WITHDRAW = discriminator('withdraw_cargo_from_game');

function keyText(value) { return String(value?.pubkey ?? value ?? ''); }
function dataBuffer(instruction) {
  try { return Buffer.from(bs58.decode(String(instruction?.data || ''))); } catch (_error) { return Buffer.alloc(0); }
}
function instructionAccounts(instruction, keys) {
  return (instruction?.accounts || []).map((value) => typeof value === 'number' ? keyText(keys[value]) : keyText(value));
}
function tokenAccountMetadata(transaction) {
  const keys = transaction?.transaction?.message?.accountKeys || [];
  const result = new Map();
  for (const row of [...(transaction?.meta?.preTokenBalances || []), ...(transaction?.meta?.postTokenBalances || [])]) {
    const account = keyText(keys[row.accountIndex]);
    if (account && row.owner && row.mint) result.set(account, { owner: String(row.owner), mint: String(row.mint) });
  }
  return result;
}
function flowTimestamp(transaction) {
  const value = new Date(Number(transaction?.blockTime) * 1000);
  return Number.isNaN(value.getTime()) ? '' : value.toISOString();
}
function txSignature(transaction) { return String(transaction?.signature || transaction?.transaction?.signatures?.[0] || ''); }
function amountFromData(data) { return data.length >= 16 ? Number(data.readBigUInt64LE(8)) : 0; }

function decodeMarketplaceAssetFlows(transaction, { trackedWallets = [], assetsByMint = {}, starbasesByKey = {}, atlasPerSol } = {}) {
  if (!transaction || transaction.meta?.err) return [];
  const timestamp = flowTimestamp(transaction);
  const signature = txSignature(transaction);
  if (!timestamp || !signature) return [];
  const keys = transaction.transaction?.message?.accountKeys || [];
  const tracked = new Set(trackedWallets.map(String));
  const tokenMeta = tokenAccountMetadata(transaction);
  const events = [];
  const txFeeSol = Number(transaction.meta?.fee || 0) / 1e9;
  const txFeeAtlas = Number.isFinite(atlasPerSol) && atlasPerSol > 0 ? (Number(transaction.meta?.fee || 0) / 1e9) * atlasPerSol : 0;
  const instructions = transaction.transaction?.message?.instructions || [];
  instructions.forEach((instruction, index) => {
    const programId = keyText(instruction?.programId || keys[instruction?.programIdIndex]);
    if (programId === SAGE_PROGRAM_ID) {
      const accounts = instructionAccounts(instruction, keys);
      const data = dataBuffer(instruction);
      const isDeposit = data.subarray(0, 8).equals(DEPOSIT);
      const isWithdraw = data.subarray(0, 8).equals(WITHDRAW);
      if (!isDeposit && !isWithdraw) return;
      const starbaseKey = accounts[isDeposit ? 0 : 1];
      const wallet = accounts[isDeposit ? 5 : 3];
      const tokenAccount = accounts[isDeposit ? 10 : 12];
      const mint = isWithdraw ? accounts[13] : tokenMeta.get(tokenAccount)?.mint;
      const asset = assetsByMint[mint];
      const starbaseContext = starbasesByKey[starbaseKey];
      const starbase = String(starbaseContext?.name || starbaseContext || '').trim();
      const faction = String(starbaseContext?.faction || '').trim().toUpperCase();
      const quantity = amountFromData(data);
      if (!asset || !starbase || !tracked.has(wallet) || !(quantity > 0)) return;
      events.push({
        id: `${signature}:${index}:${isDeposit ? 'deposit' : 'withdraw'}`, timestamp, signature,
        type: 'transfer', asset: asset.name || asset.asset || String(asset), rawMint: mint, quantity,
        origin: isDeposit ? `wallet:${wallet}` : starbase,
        destination: isDeposit ? starbase : `wallet:${wallet}`,
        txFeeSol, txFeeAtlas, flow: isDeposit ? 'css-deposit' : 'css-withdraw', faction, starbase,
      });
      return;
    }
    const parsed = instruction?.parsed;
    if (!parsed || !['transfer', 'transferChecked'].includes(parsed.type)) return;
    const info = parsed.info || {};
    const source = tokenMeta.get(String(info.source || ''));
    const destination = tokenMeta.get(String(info.destination || ''));
    const mint = String(info.mint || source?.mint || destination?.mint || '');
    const asset = assetsByMint[mint];
    const quantity = Number(info.tokenAmount?.uiAmountString ?? info.tokenAmount?.uiAmount ?? info.amount);
    if (!asset || !source || !destination || (!tracked.has(source.owner) && !tracked.has(destination.owner)) || source.owner === destination.owner || !(quantity > 0)) return;
    events.push({
      id: `${signature}:${index}:wallet-transfer`, timestamp, signature, type: 'transfer',
      asset: asset.name || asset.asset || String(asset), rawMint: mint, quantity,
      origin: `wallet:${source.owner}`, destination: `wallet:${destination.owner}`,
      txFeeSol, txFeeAtlas, flow: 'wallet-transfer',
    });
  });
  if (events.length > 1) {
    for (const event of events) {
      event.txFeeSol = txFeeSol / events.length;
      event.txFeeAtlas = txFeeAtlas / events.length;
    }
  }
  return events;
}

function escapeTag(value) { return String(value ?? '').replace(/([ ,=])/g, '\\$1'); }
function escapeFieldString(value) { return `"${String(value ?? '').replace(/(["\\])/g, '\\$1')}"`; }
function formatAssetFlowInfluxLine(event) {
  const timestamp = new Date(event?.timestamp);
  if (Number.isNaN(timestamp.getTime()) || !(Number(event?.quantity) > 0)) return '';
  const tags = {
    flowId: event.id, flow: event.flow, asset: event.asset, origin: event.origin, destination: event.destination,
    faction: event.faction, starbase: event.starbase,
  };
  const tagText = Object.entries(tags).filter(([, value]) => String(value || '').trim())
    .map(([key, value]) => `${key}=${escapeTag(value)}`).join(',');
  return `asset_flow,${tagText} quantity=${Number(event.quantity)},txFeeAtlas=${Number(event.txFeeAtlas || 0)},signature=${escapeFieldString(event.signature)},rawMint=${escapeFieldString(event.rawMint)} ${BigInt(timestamp.getTime()) * 1000000n}`;
}

function buildAssetFlowLedgerEvents(events) {
  return (events || []).map((event) => ({
    type: 'transfer', timestamp: event.timestamp, origin: event.origin, destination: event.destination,
    asset: event.asset, quantity: event.quantity, cargoCost: Number(event.txFeeAtlas || 0), flowId: event.id,
  }));
}

function selectFactionAssetFlows(events, faction) {
  const selectedFaction = String(faction || '').trim().toUpperCase().replace(/^UST$/, 'USTUR');
  const rows = Array.from(events || []);
  const inferFaction = (event) => {
    const tagged = String(event?.faction || '').trim().toUpperCase().replace(/^UST$/, 'USTUR');
    if (tagged) return tagged;
    const starbase = event?.flow === 'css-deposit' ? event.destination : event?.flow === 'css-withdraw' ? event.origin : '';
    const prefix = String(starbase || '').trim().toUpperCase().split('-')[0];
    return prefix === 'UST' ? 'USTUR' : ['MUD', 'ONI'].includes(prefix) ? prefix : '';
  };
  const direct = rows.filter((event) => inferFaction(event) === selectedFaction);
  const selected = new Set(direct);
  const inboundWallets = new Set(direct
    .filter((event) => event.flow === 'css-deposit' && String(event.origin || '').startsWith('wallet:'))
    .map((event) => String(event.origin)));
  const outboundWallets = new Set(direct
    .filter((event) => event.flow === 'css-withdraw' && String(event.destination || '').startsWith('wallet:'))
    .map((event) => String(event.destination)));
  const unscopedWalletTransfers = rows.filter((event) => !String(event?.faction || '').trim()
    && event?.flow === 'wallet-transfer'
    && String(event.origin || '').startsWith('wallet:')
    && String(event.destination || '').startsWith('wallet:'));

  let changed = true;
  while (changed) {
    changed = false;
    for (const event of unscopedWalletTransfers) {
      if (!inboundWallets.has(String(event.destination)) || selected.has(event)) continue;
      selected.add(event);
      inboundWallets.add(String(event.origin));
      changed = true;
    }
    for (const event of rows) {
      if (event?.flow !== 'css-withdraw' || !inboundWallets.has(String(event.destination)) || selected.has(event)) continue;
      selected.add(event);
      changed = true;
    }
  }
  for (const event of unscopedWalletTransfers) {
    if (outboundWallets.has(String(event.origin))) selected.add(event);
  }
  return rows.filter((event) => selected.has(event));
}

function projectAssetFlowInfluxRows(rows) {
  return (rows || []).flatMap((row) => {
    const timestamp = String(row?._time || '');
    const quantity = Number(row?.quantity);
    const origin = String(row?.origin || '');
    const destination = String(row?.destination || '');
    const asset = String(row?.asset || '');
    if (!timestamp || !origin || !destination || !asset || !(quantity > 0)) return [];
    const txFeeAtlas = Number(row?.txFeeAtlas || 0);
    const flowId = String(row?.flowId || '');
    return [{
      id: flowId, flowId, type: 'transfer', timestamp,
      flow: String(row?.flow || ''), faction: String(row?.faction || ''), starbase: String(row?.starbase || ''),
      origin, destination, asset, rawMint: String(row?.rawMint || ''), signature: String(row?.signature || ''),
      quantity, txFeeAtlas, cargoCost: txFeeAtlas,
    }];
  });
}

module.exports = {
  decodeMarketplaceAssetFlows,
  formatAssetFlowInfluxLine,
  buildAssetFlowLedgerEvents,
  selectFactionAssetFlows,
  projectAssetFlowInfluxRows,
};
