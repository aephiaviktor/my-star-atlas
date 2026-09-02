'use strict';

const crypto = require('node:crypto');
const { PublicKey } = require('@solana/web3.js');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;

const MARKETPLACE_RAWDATA_MEASUREMENT = 'marketplace_rawdata';
const GM_PROGRAM_ID = 'traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg';
const DEPOSIT_CARGO_TO_GAME = Buffer.from([87, 49, 117, 148, 241, 247, 176, 18]);
const WITHDRAW_CARGO_FROM_GAME = Buffer.from([102, 218, 88, 53, 255, 194, 24, 62]);
const PROCESS_HARVEST = Buffer.from([191, 70, 102, 41, 226, 36, 127, 160]);
const CLAIM_STAKE_PROGRAM_ID = 'STAKEr4Bh8sbBMoAVmTDBRqouPzgdocVrvtjmhJhd65';
const CLAIM_STAKE_TREASURY_AUTHORITY = '6gxMWRY4DJnx8WfJi45KqYY1LaqMGEHfX9YdLeQ6Wi5';
const CSS_STARBASE_NAMES = Object.freeze({ MUD: 'MUD-1', ONI: 'ONI-1', USTUR: 'UST-1' });
const TOKEN_PROGRAM_IDS = Object.freeze([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

function escapeTag(value) {
  return String(value).replace(/([ ,=])/g, '\\$1');
}

function escapeField(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

function canonicalJson(value) {
  const normalize = (item) => {
    if (typeof item === 'bigint') return item.toString();
    if (Buffer.isBuffer(item) || item instanceof Uint8Array) return Buffer.from(item).toString('base64');
    if (item && typeof item.toBase58 === 'function') return item.toBase58();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function payloadHash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function deriveCssStarbasePlayer({ sageProgramId, gameId, playerProfile, starbase, starbaseSeqId = 0 }) {
  const program = new PublicKey(sageProgramId);
  const profile = new PublicKey(playerProfile);
  const game = new PublicKey(gameId);
  const base = new PublicKey(starbase);
  const sagePlayerProfile = PublicKey.findProgramAddressSync([
    Buffer.from('sage_player_profile'), profile.toBuffer(), game.toBuffer(),
  ], program)[0];
  const seq = Buffer.alloc(2);
  seq.writeUInt16LE(starbaseSeqId);
  return PublicKey.findProgramAddressSync([
    Buffer.from('starbase_player'), base.toBuffer(), sagePlayerProfile.toBuffer(), seq,
  ], program)[0].toBase58();
}

function instructionData(instruction) {
  const data = instruction?.data;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  if (typeof data === 'string') {
    try { return Buffer.from(bs58.decode(data)); } catch (_error) { return null; }
  }
  return null;
}

function instructionAccounts(instruction, accountKeys) {
  const indexes = instruction?.accountKeyIndexes || instruction?.accounts || [];
  return indexes.map((value) => {
    if (typeof value === 'number') return String(accountKeys[value]?.pubkey || accountKeys[value] || '');
    return String(value?.pubkey || value || '');
  });
}

function allInstructions(transaction) {
  const message = transaction?.transaction?.message || {};
  const accountKeys = message.accountKeys || message.staticAccountKeys || [];
  const outer = (message.instructions || message.compiledInstructions || []).map((instruction, index) => ({ instruction, outerIndex: index, innerIndex: null }));
  const inner = (transaction?.meta?.innerInstructions || []).flatMap((group) => (group.instructions || []).map((instruction, index) => ({
    instruction, outerIndex: Number(group.index), innerIndex: index,
  })));
  return { accountKeys, entries: [...outer, ...inner] };
}

function hasCssCargoGameInstruction(transaction, { sageProgramId, cssStarbasePlayer }) {
  const { accountKeys, entries } = allInstructions(transaction);
  return entries.some(({ instruction }) => {
    const programId = String(instruction?.programId || accountKeys[instruction?.programIdIndex]?.pubkey || accountKeys[instruction?.programIdIndex] || '');
    if (programId !== String(sageProgramId)) return false;
    const data = instructionData(instruction);
    if (!data || data.length < 8) return false;
    const discriminator = data.subarray(0, 8);
    if (!discriminator.equals(DEPOSIT_CARGO_TO_GAME) && !discriminator.equals(WITHDRAW_CARGO_FROM_GAME)) return false;
    return instructionAccounts(instruction, accountKeys).includes(String(cssStarbasePlayer));
  });
}

function hasGmProgramInstruction(transaction, wallet) {
  const { accountKeys, entries } = allInstructions(transaction);
  return entries.some(({ instruction }) => {
    const programId = String(instruction?.programId || accountKeys[instruction?.programIdIndex]?.pubkey || accountKeys[instruction?.programIdIndex] || '');
    return programId === GM_PROGRAM_ID && instructionAccounts(instruction, accountKeys).includes(String(wallet));
  });
}

function hasTraderProgramInstruction(transaction) {
  const { accountKeys, entries } = allInstructions(transaction);
  return entries.some(({ instruction }) => {
    const programId = String(instruction?.programId || accountKeys[instruction?.programIdIndex]?.pubkey || accountKeys[instruction?.programIdIndex] || '');
    return programId === GM_PROGRAM_ID;
  });
}

function hasTokenTransferInstruction(transaction, tokenAccount) {
  const { accountKeys, entries } = allInstructions(transaction);
  return entries.some(({ instruction, innerIndex }) => {
    if (innerIndex !== null) return false;
    const programId = String(instruction?.programId || accountKeys[instruction?.programIdIndex]?.pubkey || accountKeys[instruction?.programIdIndex] || '');
    if (!TOKEN_PROGRAM_IDS.includes(programId)) return false;
    const parsed = instruction?.parsed;
    if (parsed && ['transfer', 'transferChecked'].includes(String(parsed.type))) {
      const info = parsed.info || {};
      return [info.source, info.destination].map(String).includes(String(tokenAccount));
    }
    const data = instructionData(instruction);
    if (!data?.length || ![3, 12].includes(data[0])) return false;
    const accounts = instructionAccounts(instruction, accountKeys);
    const endpoints = data[0] === 12 ? [accounts[0], accounts[2]] : [accounts[0], accounts[1]];
    return endpoints.includes(String(tokenAccount));
  });
}

function exactProcessHarvestAccounts(transaction) {
  if (transaction?.meta?.err) return null;
  const { accountKeys, entries } = allInstructions(transaction);
  for (const { instruction, innerIndex } of entries) {
    if (innerIndex !== null) continue;
    const programId = String(instruction?.programId || accountKeys[instruction?.programIdIndex]?.pubkey
      || accountKeys[instruction?.programIdIndex] || '');
    const data = instructionData(instruction);
    const accounts = instructionAccounts(instruction, accountKeys);
    if (programId === CLAIM_STAKE_PROGRAM_ID && data?.subarray(0, 8).equals(PROCESS_HARVEST)
      && accounts[11] === CLAIM_STAKE_TREASURY_AUTHORITY) return accounts;
  }
  return null;
}

function hasProcessHarvestInstruction(transaction, playerTokenAccount) {
  const accounts = exactProcessHarvestAccounts(transaction);
  return Boolean(accounts && accounts.slice(7, 11).includes(String(playerTokenAccount)));
}

function rewindMarketplaceTokenAccountCursors(cursors, tokenAccounts, shouldRewind) {
  if (!shouldRewind) return cursors;
  const addresses = new Set((tokenAccounts || []).map((account) => String(account?.address || '')).filter(Boolean));
  return Object.fromEntries(Object.entries(cursors || {}).filter(([address]) => !addresses.has(address)));
}

function classifyCssCargoEvents(transaction, { sageProgramId, cssStarbasePlayer }) {
  const signature = String(transaction?.transaction?.signatures?.[0] || '');
  const { accountKeys, entries } = allInstructions(transaction);
  const mintByTokenAccount = new Map();
  const ownerByTokenAccount = new Map();
  for (const balance of [...(transaction?.meta?.preTokenBalances || []), ...(transaction?.meta?.postTokenBalances || [])]) {
    const account = String(accountKeys[balance.accountIndex]?.pubkey || accountKeys[balance.accountIndex] || '');
    if (account && balance.mint) mintByTokenAccount.set(account, String(balance.mint));
    if (account && balance.owner) ownerByTokenAccount.set(account, String(balance.owner));
  }
  const events = [];
  for (const { instruction, outerIndex, innerIndex } of entries) {
    const programId = String(instruction?.programId || accountKeys[instruction?.programIdIndex]?.pubkey || accountKeys[instruction?.programIdIndex] || '');
    if (programId !== String(sageProgramId)) continue;
    const data = instructionData(instruction);
    if (!data || data.length < 8) continue;
    const stream = data.subarray(0, 8).equals(DEPOSIT_CARGO_TO_GAME) ? 'deposit'
      : data.subarray(0, 8).equals(WITHDRAW_CARGO_FROM_GAME) ? 'withdraw' : '';
    if (!stream) continue;
    const accounts = instructionAccounts(instruction, accountKeys);
    if (!accounts.includes(String(cssStarbasePlayer))) continue;
    const amountRaw = data.length >= 16 ? data.readBigUInt64LE(8).toString() : '';
    const tokenFromIndex = stream === 'deposit' ? 10 : 11;
    const tokenToIndex = stream === 'deposit' ? 11 : 12;
    const explicitMintIndex = stream === 'withdraw' ? 13 : -1;
    const mint = explicitMintIndex >= 0 ? String(accounts[explicitMintIndex] || '')
      : String(mintByTokenAccount.get(accounts[tokenFromIndex]) || mintByTokenAccount.get(accounts[tokenToIndex]) || '');
    events.push({
      eventId: `${signature}:${outerIndex}:${innerIndex === null ? 'outer' : innerIndex}`,
      signature, stream, type: stream === 'deposit' ? 'deposit_cargo_to_game' : 'withdraw_cargo_from_game',
      outerIndex, innerIndex, cssStarbasePlayer: String(cssStarbasePlayer),
      starbase: String(accounts[stream === 'deposit' ? 0 : 1] || ''),
      profile: String(accounts[stream === 'deposit' ? 6 : 4] || ''),
      fromWallet: String(ownerByTokenAccount.get(accounts[tokenFromIndex]) || ''),
      toWallet: String(ownerByTokenAccount.get(accounts[tokenToIndex]) || ''),
      fromTokenAccount: String(accounts[tokenFromIndex] || ''), toTokenAccount: String(accounts[tokenToIndex] || ''),
      mint, quantityRaw: amountRaw, accounts,
    });
  }
  return events;
}

function playerTransferEvents(transaction, playerWallets) {
  const owners = new Set((playerWallets || []).map(String));
  const signature = String(transaction?.transaction?.signatures?.[0] || '');
  const message = transaction?.transaction?.message || {};
  const accountKeys = message.accountKeys || message.staticAccountKeys || [];
  const tokenOwnerByAccount = new Map();
  const tokenMintByAccount = new Map();
  for (const row of [...(transaction?.meta?.preTokenBalances || []), ...(transaction?.meta?.postTokenBalances || [])]) {
    const account = String(accountKeys[row.accountIndex]?.pubkey || accountKeys[row.accountIndex] || '');
    if (account && row.owner) tokenOwnerByAccount.set(account, String(row.owner));
    if (account && row.mint) tokenMintByAccount.set(account, String(row.mint));
  }
  const parsedEvents = [];
  const { entries } = allInstructions(transaction);
  for (const { instruction, outerIndex, innerIndex } of entries) {
    const parsed = instruction?.parsed;
    if (!parsed || !['transfer', 'transferChecked'].includes(String(parsed.type))) continue;
    const info = parsed.info || {};
    const fromWallet = tokenOwnerByAccount.get(String(info.source || '')) || '';
    const toWallet = tokenOwnerByAccount.get(String(info.destination || '')) || '';
    if (!owners.has(fromWallet) || !owners.has(toWallet) || fromWallet === toWallet) continue;
    const quantityRaw = String(info.amount ?? info.tokenAmount?.amount ?? '');
    const decimals = Number(info.tokenAmount?.decimals ?? 0);
    if (!/^\d+$/.test(quantityRaw) || BigInt(quantityRaw) <= 0n) continue;
    parsedEvents.push({
      eventId: `${signature}:${outerIndex}:${innerIndex === null ? 'outer' : innerIndex}`,
      signature, stream: 'transfer', fromWallet, toWallet,
      mint: String(info.mint || tokenMintByAccount.get(String(info.source || ''))
        || tokenMintByAccount.get(String(info.destination || '')) || ''), quantityRaw, decimals,
    });
  }
  if (parsedEvents.length) return parsedEvents;

  // Some providers return compiled token instructions. Preserve a bounded,
  // deterministic balance-delta fallback rather than dropping the transfer.
  const pre = new Map((transaction?.meta?.preTokenBalances || []).map((row) => [`${row.accountIndex}:${row.mint}`, row]));
  const post = new Map((transaction?.meta?.postTokenBalances || []).map((row) => [`${row.accountIndex}:${row.mint}`, row]));
  const changes = [];
  for (const key of new Set([...pre.keys(), ...post.keys()])) {
    const before = pre.get(key);
    const after = post.get(key);
    const owner = String(after?.owner || before?.owner || '');
    if (!owners.has(owner)) continue;
    const mint = String(after?.mint || before?.mint || '');
    const decimals = Number(after?.uiTokenAmount?.decimals ?? before?.uiTokenAmount?.decimals ?? 0);
    const preRaw = BigInt(before?.uiTokenAmount?.amount || 0);
    const postRaw = BigInt(after?.uiTokenAmount?.amount || 0);
    const deltaRaw = postRaw - preRaw;
    if (deltaRaw) changes.push({ owner, mint, decimals, deltaRaw });
  }
  const outgoing = changes.filter((row) => row.deltaRaw < 0n);
  const incoming = changes.filter((row) => row.deltaRaw > 0n);
  const events = [];
  let index = 0;
  for (const from of outgoing) {
    let remaining = -from.deltaRaw;
    for (const to of incoming.filter((row) => row.mint === from.mint && row.owner !== from.owner)) {
      if (remaining <= 0n) break;
      const quantityRaw = remaining < to.deltaRaw ? remaining : to.deltaRaw;
      if (quantityRaw <= 0n) continue;
      events.push({ eventId: `${signature}:transfer:${index++}`, signature, stream: 'transfer', fromWallet: from.owner,
        toWallet: to.owner, mint: from.mint, quantityRaw: quantityRaw.toString(), decimals: from.decimals });
      remaining -= quantityRaw;
      to.deltaRaw -= quantityRaw;
    }
  }
  return events;
}

function processHarvestRewardEvents(transaction) {
  if (!exactProcessHarvestAccounts(transaction)) return [];
  const owners = [...new Set([
    ...(transaction.meta?.preTokenBalances || []), ...(transaction.meta?.postTokenBalances || []),
  ].map((balance) => String(balance?.owner || '')).filter(Boolean))];
  return playerTransferEvents(transaction, owners)
    .filter((event) => event.fromWallet === CLAIM_STAKE_TREASURY_AUTHORITY)
    .map((event, index) => ({ ...event, eventId: `${event.signature}:reward:${index}`, stream: 'reward',
      action: 'process_harvest', principalAtlas: 0 }));
}

function formatRawTransactionInfluxLine({ transaction, discoverySource = 'legacy_unknown' }) {
  const signature = String(transaction?.transaction?.signatures?.[0] || '').trim();
  const blockTime = Number(transaction?.blockTime);
  const slot = Number(transaction?.slot);
  if (!signature || !Number.isSafeInteger(slot) || !Number.isSafeInteger(blockTime)) throw new Error('invalid_raw_transaction');
  const payload = canonicalJson(transaction);
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  const fields = [
    `slot=${slot}i`, `success=${transaction?.meta?.err == null}`, `payload=${escapeField(payload)}`,
    `payloadHash=${escapeField(hash)}`,
  ];
  const normalizedSource = /^(?:gm_wallet|lm_scanner|css_account|token_account|multiple)$/.test(String(discoverySource))
    ? String(discoverySource) : 'legacy_unknown';
  return `${MARKETPLACE_RAWDATA_MEASUREMENT},record=transaction,discoverySource=${escapeTag(normalizedSource)},eventId=transaction,signature=${escapeTag(signature)} ${fields.join(',')} ${BigInt(blockTime) * 1000000000n}`;
}

function formatRawEventInfluxLine(event, blockTime) {
  if (!event?.eventId || !event?.signature || !event?.stream || !Number.isSafeInteger(Number(blockTime))) throw new Error('invalid_raw_event');
  const payload = canonicalJson(event);
  return `${MARKETPLACE_RAWDATA_MEASUREMENT},record=event,stream=${escapeTag(event.stream)},eventId=${escapeTag(event.eventId)},signature=${escapeTag(event.signature)} payload=${escapeField(payload)},payloadHash=${escapeField(payloadHash(event))} ${BigInt(blockTime) * 1000000000n}`;
}

function buildLmRawRecords({ transactions = [] } = {}) {
  return transactions.filter(hasTraderProgramInstruction).map((transaction) => ({
    signature: String(transaction?.signature || transaction?.transaction?.signatures?.[0] || ''),
    transaction,
    discoverySources: ['lm_scanner'],
  })).filter((record) => record.signature);
}

async function discoverPlayerTokenAccounts(connection, playerWallets, allowedMints = []) {
  const rows = [];
  const allowed = new Set((allowedMints || []).map(String));
  for (const owner of [...new Set((playerWallets || []).map(String))].sort()) {
    for (const programId of TOKEN_PROGRAM_IDS) {
      const response = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { programId: new PublicKey(programId) }, 'confirmed');
      for (const entry of response?.value || []) {
        const mint = String(entry.account?.data?.parsed?.info?.mint || '');
        if (allowed.size && !allowed.has(mint)) continue;
        rows.push({ address: String(entry.pubkey), owner, mint });
      }
    }
  }
  return rows.sort((a, b) => a.address.localeCompare(b.address) || a.owner.localeCompare(b.owner));
}

async function collectAddressTransactions(connection, scopes, cursors = {}, { startIso, startSlot = 0, maxPages = 1, batchSize = 5 } = {}) {
  const startMs = Date.parse(startIso || '2026-07-24T00:00:00.000Z');
  const signatures = new Map();
  const nextCursors = { ...cursors };
  let signatureRequests = 0;
  const scopesByAddress = new Map();
  for (const scope of scopes) scopesByAddress.set(scope.address, [...(scopesByAddress.get(scope.address) || []), scope]);
  const recordRows = (rows, addressScopes) => {
    let reachedStart = false;
    for (const row of rows || []) {
      if (Number(row.blockTime) * 1000 < startMs || Number(row.slot) < Number(startSlot || 0)) { reachedStart = true; continue; }
      if (!row.err && row.signature) {
        const current = signatures.get(String(row.signature)) || { row, scopes: [] };
        current.scopes.push(...addressScopes);
        current.scopes = [...new Map(current.scopes.map((scope) => [`${scope.kind}:${scope.address}`, scope])).values()];
        signatures.set(String(row.signature), current);
      }
    }
    return reachedStart;
  };
  for (const [address, addressScopes] of scopesByAddress) {
    const prior = cursors[address];
    const state = prior && typeof prior === 'object'
      ? { head: String(prior.head || ''), backfillBefore: String(prior.backfillBefore || ''), backfillComplete: prior.backfillComplete === true }
      : { head: String(prior || ''), backfillBefore: '', backfillComplete: Boolean(prior) };
    let next = { ...state };
    if (!state.head) {
      const rows = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 1000 }, 'confirmed');
      signatureRequests += 1;
      const reachedStart = recordRows(rows, addressScopes);
      next = {
        head: String(rows?.[0]?.signature || ''),
        backfillBefore: reachedStart || !rows?.length || rows.length < 1000 ? '' : String(rows[rows.length - 1]?.signature || ''),
        backfillComplete: reachedStart || !rows?.length || rows.length < 1000,
      };
    } else {
      const rows = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 1000, until: state.head }, 'confirmed');
      signatureRequests += 1;
      recordRows(rows, addressScopes);
      if (rows?.[0]?.signature) next.head = String(rows[0].signature);
      for (let page = 0; page < maxPages && !next.backfillComplete; page += 1) {
        const historical = await connection.getSignaturesForAddress(new PublicKey(address), {
          limit: 1000, before: next.backfillBefore,
        }, 'confirmed');
        signatureRequests += 1;
        const reachedStart = recordRows(historical, addressScopes);
        if (reachedStart || !historical?.length || historical.length < 1000) {
          next.backfillBefore = '';
          next.backfillComplete = true;
          break;
        }
        next.backfillBefore = String(historical[historical.length - 1]?.signature || '');
        if (!next.backfillBefore) { next.backfillComplete = true; break; }
      }
    }
    nextCursors[address] = next;
  }
  const ordered = [...signatures.entries()].sort((a, b) => Number(a[1].row.blockTime) - Number(b[1].row.blockTime));
  const fetched = [];
  let transactionRequests = 0;
  let transactionMisses = 0;
  for (let offset = 0; offset < ordered.length; offset += batchSize) {
    const chunk = ordered.slice(offset, offset + batchSize);
    const transactions = await connection.getParsedTransactions(chunk.map(([signature]) => signature), {
      commitment: 'confirmed', maxSupportedTransactionVersion: 0,
    });
    transactionRequests += 1;
    transactions.forEach((transaction, index) => {
      if (!transaction) { transactionMisses += 1; return; }
      const [signature, discovery] = chunk[index];
      fetched.push({ transaction: { ...transaction, signature, blockTime: transaction.blockTime ?? discovery.row.blockTime }, scopes: discovery.scopes });
    });
  }
  return {
    fetched,
    // A missing parsed transaction is retryable. Advancing any address that
    // contributed candidates could permanently skip that immutable fact.
    cursors: transactionMisses ? { ...cursors } : nextCursors,
    rpc: { signatureRequests, transactionRequests, transactionMisses, totalRpcRequests: signatureRequests + transactionRequests },
  };
}

async function scanMarketplaceRawData(connection, {
  gmWallets = [], cssScopes = [], playerWallets = [], tokenAccounts = [], cursors = {}, startIso, startSlot = 0, maxPages = 1,
} = {}) {
  const scopes = [
    ...gmWallets.map((address) => ({ address: String(address), kind: 'gm' })),
    ...cssScopes.map((scope) => ({ address: String(scope.address), kind: 'css', faction: scope.faction, sageProgramId: String(scope.sageProgramId) })),
    ...tokenAccounts.map((scope) => ({ address: String(scope.address), kind: 'token', owner: String(scope.owner) })),
  ];
  const scanned = await collectAddressTransactions(connection, scopes, cursors, { startIso, startSlot, maxPages });
  const records = [];
  for (const item of scanned.fetched) {
    const transaction = item.transaction;
    const signature = String(transaction.signature || transaction.transaction?.signatures?.[0] || '');
    const discoverySources = new Set();
    for (const scope of item.scopes) {
      if (scope.kind === 'gm' && hasGmProgramInstruction(transaction, scope.address)) discoverySources.add('gm_wallet');
      if (scope.kind === 'token' && (hasTokenTransferInstruction(transaction, scope.address)
        || hasProcessHarvestInstruction(transaction, scope.address))) discoverySources.add('token_account');
      if (scope.kind === 'css' && hasCssCargoGameInstruction(transaction, {
        sageProgramId: scope.sageProgramId,
        cssStarbasePlayer: scope.address,
      })) discoverySources.add('css_account');
    }
    if (!discoverySources.size) continue;
    records.push({ signature, transaction, discoverySources: [...discoverySources].sort() });
  }
  return { records, cursors: scanned.cursors, rpc: scanned.rpc };
}

module.exports = Object.freeze({
  MARKETPLACE_RAWDATA_MEASUREMENT, GM_PROGRAM_ID, DEPOSIT_CARGO_TO_GAME, WITHDRAW_CARGO_FROM_GAME, PROCESS_HARVEST,
  CLAIM_STAKE_PROGRAM_ID, CLAIM_STAKE_TREASURY_AUTHORITY, CSS_STARBASE_NAMES,
  TOKEN_PROGRAM_IDS, deriveCssStarbasePlayer, hasCssCargoGameInstruction, hasGmProgramInstruction, hasTraderProgramInstruction,
  hasTokenTransferInstruction, hasProcessHarvestInstruction, rewindMarketplaceTokenAccountCursors,
  classifyCssCargoEvents, playerTransferEvents, processHarvestRewardEvents, buildLmRawRecords,
  formatRawTransactionInfluxLine, formatRawEventInfluxLine, discoverPlayerTokenAccounts, collectAddressTransactions, scanMarketplaceRawData,
});
