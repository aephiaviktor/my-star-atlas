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

function decodeMarketplaceAssetFlows(transaction, { trackedWallets = [], walletLineage = {}, assetsByMint = {}, starbasesByKey = {}, atlasPerSol } = {}) {
  if (!transaction || transaction.meta?.err) return [];
  const timestamp = flowTimestamp(transaction);
  const signature = txSignature(transaction);
  if (!timestamp || !signature) return [];
  const keys = transaction.transaction?.message?.accountKeys || [];
  const tracked = new Set(trackedWallets.map(String));
  const tokenMeta = tokenAccountMetadata(transaction);
  const events = [];
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
      const starbase = starbasesByKey[starbaseKey];
      const quantity = amountFromData(data);
      if (!asset || !starbase || !tracked.has(wallet) || !(quantity > 0)) return;
      const lineage = walletLineage[wallet];
      events.push({
        id: `${signature}:${index}:${isDeposit ? 'deposit' : 'withdraw'}`, timestamp, signature,
        type: 'transfer', asset: asset.name || asset.asset || String(asset), rawMint: mint, quantity,
        origin: isDeposit ? `wallet:${wallet}` : starbase,
        destination: isDeposit ? starbase : `wallet:${wallet}`,
        txFeeAtlas, flow: isDeposit ? 'css-deposit' : 'css-withdraw', schemaVersion: 2, wallet,
        faction: lineage?.faction || '', profile: lineage?.profile || '',
        lineageStatus: lineage?.faction && lineage?.profile ? 'proven' : 'unallocated',
        provenance: 'sage_css_transfer',
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
    if (!asset || !source || !destination || !tracked.has(source.owner) || !tracked.has(destination.owner) || source.owner === destination.owner || !(quantity > 0)) return;
    const sourceLineage = walletLineage[source.owner];
    const destinationLineage = walletLineage[destination.owner];
    const lineage = sourceLineage && destinationLineage
      && sourceLineage.faction === destinationLineage.faction
      && sourceLineage.profile === destinationLineage.profile ? sourceLineage : null;
    events.push({
      id: `${signature}:${index}:wallet-transfer`, timestamp, signature, type: 'transfer',
      asset: asset.name || asset.asset || String(asset), rawMint: mint, quantity,
      origin: `wallet:${source.owner}`, destination: `wallet:${destination.owner}`,
      txFeeAtlas, flow: 'wallet-transfer', schemaVersion: 2, wallet: source.owner,
      faction: lineage?.faction || '', profile: lineage?.profile || '',
      lineageStatus: lineage ? 'proven' : 'unallocated', provenance: 'spl_token_transfer',
    });
  });
  if (events.length > 1 && txFeeAtlas > 0) {
    for (const event of events) event.txFeeAtlas = txFeeAtlas / events.length;
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
    faction: event.faction || '', profile: event.profile || '', lineageStatus: event.lineageStatus || 'unallocated',
  };
  const tagText = Object.entries(tags).map(([key, value]) => `${key}=${escapeTag(value)}`).join(',');
  return `asset_flow,${tagText} quantity=${Number(event.quantity)},txFeeAtlas=${Number(event.txFeeAtlas || 0)},signature=${escapeFieldString(event.signature)},rawMint=${escapeFieldString(event.rawMint)} ${BigInt(timestamp.getTime()) * 1000000n}`;
}

function buildAssetFlowLedgerEvents(events) {
  return (events || []).map((event) => ({
    type: 'transfer', timestamp: event.timestamp, origin: event.origin, destination: event.destination,
    asset: event.asset, quantity: event.quantity, cargoCost: Number(event.txFeeAtlas || 0), flowId: event.id,
  }));
}

module.exports = { decodeMarketplaceAssetFlows, formatAssetFlowInfluxLine, buildAssetFlowLedgerEvents };
