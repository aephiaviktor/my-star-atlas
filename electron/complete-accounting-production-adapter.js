'use strict';

const crypto = require('node:crypto');
const arithmetic = require('./exact-arithmetic');
const { buildCompleteBreakEvenAccounting } = require('./complete-break-even-accounting');

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function exactText(value) {
  if (value && typeof value === 'object' && /^(?:0|[1-9]\d*)$/.test(String(value.atoms ?? '')) && Number.isInteger(Number(value.decimals))) {
    const rendered = arithmetic.renderRatio({
      numerator: { atoms: String(value.atoms), decimals: Number(value.decimals), unit: String(value.unit || 'scalar') },
      denominator: { atoms: '1', decimals: 0, unit: 'scalar' },
    }, Number(value.decimals));
    if (rendered.status !== 'ok') throw new Error(`cannot render exact value: ${rendered.status}`);
    return rendered.value.replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, '').replace(/\.$/, '') || '0';
  }
  const text = String(value ?? '').trim();
  if (/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return text;
  if (!/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) throw new Error(`invalid decimal value: ${text}`);
  const [coefficient, exponentText] = text.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = `${whole}${fraction}`;
  const point = whole.length + exponent;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`.replace(/0+$/, '') || '0';
  if (point >= digits.length) return `${digits}${'0'.repeat(point - digits.length)}`;
  return `${digits.slice(0, point)}.${digits.slice(point)}`.replace(/0+$/, '').replace(/\.$/, '');
}

function sumText(values) {
  let total = 0n;
  let decimals = 0;
  for (const value of values) {
    const text = exactText(value);
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > decimals) {
      total *= 10n ** BigInt(fraction.length - decimals);
      decimals = fraction.length;
    }
    total += BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  }
  const digits = total.toString().padStart(decimals + 1, '0');
  return decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/0+$/, '').replace(/\.$/, '') : digits;
}

function immutableId(prefix, item, authoritativeIds = []) {
  for (const key of authoritativeIds) {
    const value = String(item?.[key] || '').trim();
    if (value) return `${prefix}:${value}`;
  }
  return `${prefix}:legacy:${hash(item)}`;
}

function normalizeTimestamp(value) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString();
}

function marketplaceEvents(trades = [], scope = null) {
  return trades.flatMap((trade) => {
    const timestamp = normalizeTimestamp(trade.timestamp);
    const market = String(trade.marketplace || trade.market || 'LM').toUpperCase();
    const source = market === 'GM' ? 'gm' : 'lm';
    const asset = String(trade.asset || '').trim();
    const location = String(trade.starbase || '').trim() || `wallet:${String(trade.wallet || trade.originWallet || '').trim()}`;
    if (!timestamp || !asset || !location) return [];
    let quantity;
    try { quantity = exactText(trade.exactQuantity || trade.quantity); } catch (_error) { return []; }
    const id = immutableId(`market:${source}`, trade, ['tradeId', 'id', 'executionSignature', 'signature']);
    const lineageStatus = String(trade.lineageStatus || '').toLowerCase();
    if (source === 'gm' && ['ambiguous', 'quarantined'].includes(lineageStatus)) {
      return [{ eventId: id, timestamp, type: 'quarantined', source, asset, quantity, reason: 'ambiguous-gm-allocation', tradeId: String(trade.tradeId || trade.id || ''), originWallet: String(trade.wallet || trade.originWallet || ''), lineageStatus }];
    }
    if (source === 'gm' && ['pending', 'unallocated'].includes(lineageStatus)) {
      return [{ eventId: id, timestamp, type: lineageStatus, source, asset, quantity, tradeId: String(trade.tradeId || trade.id || ''), originWallet: String(trade.wallet || trade.originWallet || ''), lineageStatus }];
    }
    const gmDestinationProven = source !== 'gm' || Boolean(String(trade.starbase || '').trim());
    if (!gmDestinationProven) {
      return [{ eventId: id, timestamp, type: 'unallocated', source, asset, quantity, tradeId: String(trade.tradeId || trade.id || ''), originWallet: String(trade.wallet || trade.originWallet || ''), lineageStatus: lineageStatus || 'wallet-unallocated', scope: scope || null }];
    }
    if (String(trade.side).toLowerCase() === 'buy') {
      const basis = trade.totalCostAtlas ?? trade.settledAtlas ?? trade.grossAtlas;
      if (basis == null) return [{ eventId: id, timestamp, type: 'quarantined', source, asset, quantity, reason: 'marketplace-buy-cost-unavailable' }];
      const transactionFee = trade.totalCostAtlas != null ? '0' : exactText(trade.txFeeAtlas || '0');
      return [{ eventId: id, timestamp, type: 'acquisition', source, location, asset, quantity, basis: exactText(basis), fees: transactionFee, marketplaceFee: exactText(trade.marketplaceFeeAtlas || '0'), transactionFee, tradeId: String(trade.tradeId || trade.id || ''), originWallet: String(trade.wallet || trade.originWallet || ''), lineageStatus: lineageStatus || 'allocated' }];
    }
    if (String(trade.side).toLowerCase() === 'sell') {
      const gross = trade.grossAtlas ?? trade.settledAtlas ?? trade.netAtlas;
      const net = trade.netAtlas ?? trade.settledAtlas;
      if (gross == null || net == null) return [{ eventId: id, timestamp, type: 'quarantined', source, asset, quantity, reason: 'marketplace-sale-proceeds-unavailable' }];
      const marketplaceFee = trade.grossAtlas != null && trade.netAtlas != null
        ? subtractText(gross, net)
        : exactText(trade.marketplaceFeeAtlas || '0');
      const transactionFee = exactText(trade.txFeeAtlas || '0');
      const fees = sumText([marketplaceFee, transactionFee]);
      return [{ eventId: id, timestamp, type: 'sale', source, location, asset, quantity, grossProceeds: exactText(gross), fees, marketplaceFee, transactionFee, tradeId: String(trade.tradeId || trade.id || ''), originWallet: String(trade.wallet || trade.originWallet || ''), lineageStatus: lineageStatus || 'allocated' }];
    }
    return [];
  });
}

function subtractText(left, right) {
  const a = exactText(left); const b = exactText(right);
  const decimals = Math.max((a.split('.')[1] || '').length, (b.split('.')[1] || '').length);
  const atoms = (text) => { const [whole, fraction = ''] = text.split('.'); return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`); };
  const difference = atoms(a) - atoms(b);
  if (difference < 0n) throw new Error('net proceeds exceed gross proceeds');
  const digits = difference.toString().padStart(decimals + 1, '0');
  return decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/0+$/, '').replace(/\.$/, '') : digits;
}

function legacyLedgerEvents(events = []) {
  return events.flatMap((event) => {
    if (!event || !event.type || !normalizeTimestamp(event.timestamp)) return [];
    if (event.tradeId || String(event.purpose || '').endsWith('-sell')) return [];
    const timestamp = normalizeTimestamp(event.timestamp);
    const base = { eventId: immutableId(`ledger:${event.type}`, event, ['eventId', 'flowId', 'signature']), timestamp };
    try {
      if (event.type === 'acquire') return [{ ...base, type: event.source ? 'acquisition' : 'opening', source: event.source || undefined, location: event.location, asset: event.asset, quantity: exactText(event.quantity), basis: event.totalCost == null ? null : exactText(event.totalCost), lineageStatus: event.eventId || event.flowId ? 'confirmed' : 'legacy_unverified' }];
      if (event.type === 'transfer') return [{ ...base, type: 'transfer', location: event.origin, destination: event.destination, asset: event.asset, quantity: exactText(event.quantity), cargoCost: exactText(event.cargoCost || '0'), lineageStatus: event.eventId || event.flowId ? 'confirmed' : 'legacy_unverified' }];
      if (event.type === 'craft') return [{ ...base, type: 'craft', location: event.location, asset: event.outputAsset, quantity: exactText(event.outputQuantity), ingredients: (event.ingredients || []).map((ingredient) => ({ asset: ingredient.asset, quantity: exactText(ingredient.quantity) })), directCost: exactText(event.directCraftingCost ?? event.craftingCost ?? '0'), transactionCost: exactText(event.transactionCost || '0'), lineageStatus: event.eventId ? 'confirmed' : 'legacy_unverified' }];
      if (event.type === 'consume') return [{ ...base, type: 'consume', location: event.location, asset: event.asset, quantity: exactText(event.quantity), lineageStatus: event.eventId ? 'confirmed' : 'legacy_unverified' }];
    } catch (_error) { return []; }
    return [];
  });
}

function authoritativeCargoEvents(events = []) {
  return events.flatMap((event) => {
    try {
      const timestamp = normalizeTimestamp(event.timestamp);
      if (!timestamp || !event.eventId) return [];
      return [{ eventId: `cargo:${event.eventId}`, timestamp, type: 'transfer', source: 'cargo', location: event.origin, destination: event.destination, asset: event.asset, quantity: exactText(event.quantity), cargoCost: exactText(event.cargoCostAtlas || '0'), lineageStatus: 'confirmed', payloadHash: hash(event) }];
    } catch (_error) { return []; }
  });
}

function actualClosingRows(rows = []) {
  return rows.flatMap((row) => {
    const asset = String(row.asset || row.cargoType || '').trim();
    const quantity = row.quantity ?? row.curAmount ?? row.currentAmount;
    if (!asset || quantity == null) return [];
    try { return [{ asset, quantity: exactText(quantity) }]; } catch (_error) { return []; }
  });
}

function parseEvidenceJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch (_error) { return fallback; }
}

function normalizeSlyaFaction(value) {
  const faction = String(value || '').trim().toUpperCase();
  return faction === 'UST' ? 'USTUR' : faction;
}

function integerEvidenceField(value, minimum = 0) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function lamportsToSolExact(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const digits = BigInt(text).toString().padStart(10, '0');
  return `${digits.slice(0, -9)}.${digits.slice(-9)}`.replace(/\.0+$/, '');
}

function authoritativeOperationLineage({ evidenceType, operationId, signature, fleetAccount, inputs, outputs, lineage }) {
  if (!lineage || typeof lineage !== 'object' || !operationId || lineage.operationIdentity !== operationId) return 'operation-identity-unmatched';
  if (String(lineage.fleetAccount || '') !== fleetAccount || !String(lineage.location || '').trim()) return 'operation-scope-incomplete';
  if (evidenceType === 'scanning' || evidenceType === 'mining') {
    if (!String(lineage.sourceAccount || '').trim() || !String(lineage.destinationAccount || '').trim()) return 'asset-account-lineage-incomplete';
    if (!outputs.every((entry) => String(entry.mint || '').trim() && String(entry.mint) === String(lineage.assetMint || ''))) return 'asset-mint-lineage-unmatched';
    return '';
  }
  const stages = lineage.stageSignatures;
  if (!stages || typeof stages !== 'object' || !String(stages.input || '').trim() || !String(stages.output || '').trim()) return 'production-stage-unmatched';
  if (!Object.values(stages).map(String).includes(signature)) return 'production-signature-unmatched';
  if (!inputs.length || outputs.length !== 1) return 'production-stage-incomplete';
  return '';
}

function validSlyaEntry(entry) {
  if (!entry || typeof entry !== 'object' || !String(entry.asset || '').trim()) return false;
  try { exactText(entry.quantity); return true; } catch (_error) { return false; }
}

function slyaPayloadHash(payload) {
  return hash(payload);
}

function parseSlyaMoney(value, fallback) {
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())) return value.trim();
  return parseEvidenceJson(value, fallback);
}

function authoritativeSlyaAccountingEvents(rows = [], scope = null) {
  return rows.flatMap((row) => {
    const eventId = String(row?.eventId || '').trim();
    const evidenceType = String(row?.evidenceType || '').trim().toLowerCase();
    const payloadHash = String(row?.payloadHash || '').trim();
    const signature = String(row?.signature || '').trim();
    const programId = String(row?.programId || '').trim();
    const operationId = String(row?.operationId || '').trim();
    const outerInstructionIndex = integerEvidenceField(row?.outerInstructionIndex);
    const slot = integerEvidenceField(row?.slot);
    const blockTime = integerEvidenceField(row?.blockTime, 1);
    const blockTimestamp = blockTime == null ? '' : new Date(blockTime * 1000).toISOString();
    const influxTimestamp = normalizeTimestamp(row?.timestamp || row?._time);
    const timestamp = blockTimestamp || influxTimestamp;
    const faction = String(row?.faction || '').trim();
    const profile = String(row?.profile || '').trim();
    const fleetAccount = String(row?.fleetAccount || '').trim();
    const inputs = parseEvidenceJson(row?.inputs, null);
    const outputs = parseEvidenceJson(row?.outputs, null);
    const lineage = parseEvidenceJson(row?.lineage, {});
    const directFees = parseSlyaMoney(row?.directFees, row?.directFees);
    const transactionCosts = parseEvidenceJson(row?.transactionCosts, row?.transactionCosts);
    const base = { eventId, sourceEventId: eventId, timestamp, source: evidenceType, payloadHash, signature, programId, operationId, slot: slot == null ? '' : String(slot), profile, fleet: fleetAccount, lineageStatus: 'confirmed', scope: scope || null };
    const quarantine = (reason, output = outputs?.[0]) => [{ ...base, type: 'quarantined', asset: String(output?.asset || lineage?.asset || evidenceType), quantity: validSlyaEntry(output) ? exactText(output.quantity) : '0', reason }];
    if (!eventId || !timestamp || !/^[0-9a-f]{64}$/.test(payloadHash) || !['scanning', 'mining', 'crafting', 'upgrading'].includes(evidenceType) || !Array.isArray(inputs) || !Array.isArray(outputs)) return eventId ? quarantine('slya-evidence-shape-invalid') : [];
    if (!signature || !programId || outerInstructionIndex == null || slot == null || blockTime == null || !faction || !profile || !fleetAccount || !inputs.every(validSlyaEntry) || !outputs.length || !outputs.every(validSlyaEntry)) return quarantine('slya-authoritative-identity-incomplete');
    if (influxTimestamp && influxTimestamp !== blockTimestamp) return quarantine('slya-block-time-mismatch');
    const expectedScopeFaction = normalizeSlyaFaction(scope?.faction);
    if ((expectedScopeFaction && normalizeSlyaFaction(faction) !== expectedScopeFaction) || (scope?.profile && profile !== String(scope.profile))) return quarantine('slya-scope-mismatch');
    const expectedInstructionId = `slya-accounting:v1:${evidenceType}:${signature}:${outerInstructionIndex}`;
    const expectedTransactionId = `slya-accounting:v1:${evidenceType}:${signature}:tx`;
    const expectedOperationId = operationId ? `slya-accounting:v1:${evidenceType}:${signature}:op:${operationId}` : '';
    if (eventId !== expectedInstructionId && eventId !== expectedTransactionId && eventId !== expectedOperationId) return quarantine('slya-event-identity-mismatch');
    const canonicalPayload = {
      schemaVersion: 1, evidenceType, eventId, signature, outerInstructionIndex, programId,
      slot, blockTime, faction, profile, fleetAccount, fleetLabel: String(row?.fleetLabel || ''),
      inputs, outputs, directFees, transactionCosts, operationId, lineage, sourceProvenance: String(row?.sourceProvenance || ''),
    };
    if (slyaPayloadHash(canonicalPayload) !== payloadHash) return quarantine('slya-payload-hash-mismatch');
    const output = outputs[0];
    const baseWithCanonical = { ...base, timestamp: new Date(blockTime * 1000).toISOString() };
    const lineageFailure = authoritativeOperationLineage({ evidenceType, operationId, signature, fleetAccount, inputs, outputs, lineage });
    if (lineageFailure) return [{ ...baseWithCanonical, type: evidenceType === 'crafting' || evidenceType === 'upgrading' ? 'pending' : 'quarantined', asset: String(output.asset), quantity: exactText(output.quantity), reason: `slya-${lineageFailure}` }];
    if ((evidenceType === 'crafting' || evidenceType === 'upgrading') && outputs.length !== 1) return [{ ...baseWithCanonical, type: 'quarantined', asset: String(output.asset), quantity: exactText(output.quantity), reason: 'slya-output-lineage-ambiguous' }];
    if (evidenceType === 'crafting' || evidenceType === 'upgrading') {
      const costs = transactionCosts && typeof transactionCosts === 'object' ? transactionCosts : null;
      const direct = typeof directFees === 'string' ? directFees : directFees?.atlas;
      const transaction = costs?.atlas;
      if (direct == null) return [{ ...baseWithCanonical, type: 'pending', asset: String(output.asset), quantity: exactText(output.quantity), reason: 'slya-direct-cost-unavailable' }];
      const txFeeLamports = String(costs?.solLamports ?? '').trim();
      const txFeeSolExact = lamportsToSolExact(txFeeLamports);
      if (transaction == null && txFeeSolExact == null) return [{ ...baseWithCanonical, type: 'pending', asset: String(output.asset), quantity: exactText(output.quantity), reason: 'slya-transaction-fee-unavailable' }];
      return [{ ...baseWithCanonical, type: 'craft', location: String(lineage.location), asset: String(output.asset), quantity: exactText(output.quantity), ingredients: inputs.map((entry) => ({ asset: String(entry.asset), quantity: exactText(entry.quantity) })), directCost: exactText(direct), transactionCost: transaction == null ? '0' : exactText(transaction), transactionFeeStatus: transaction == null ? 'uncosted' : 'costed', txFeeLamports: txFeeLamports || null, txFeeSolExact, forceUncosted: transaction == null, lineageStatus: 'confirmed' }];
    }
    return outputs.map((entry, index) => {
      const location = String(entry.location || lineage?.location || lineage?.starbase || lineage?.sector || '').trim();
      if (!location) return { ...baseWithCanonical, eventId: `${eventId}:output:${index}`, type: 'quarantined', asset: String(entry.asset), quantity: exactText(entry.quantity), reason: 'slya-lineage-location-unavailable' };
      return { ...baseWithCanonical, eventId: `${eventId}:output:${index}`, type: 'acquisition', location, asset: String(entry.asset), quantity: exactText(entry.quantity), basis: null, lineageStatus: 'confirmed' };
    });
  });
}

function buildProductionEvents({ scope = null, ledgerEvents = [], authoritativeCargo = [], authoritativeSlyaEvidence = [], marketplaceTrades = [] } = {}) {
  return [...legacyLedgerEvents(ledgerEvents), ...authoritativeCargoEvents(authoritativeCargo), ...authoritativeSlyaAccountingEvents(authoritativeSlyaEvidence, scope), ...marketplaceEvents(marketplaceTrades, scope)]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.eventId.localeCompare(right.eventId));
}

function buildProductionCompleteAccounting({ scope, period, ledgerEvents = [], authoritativeCargo = [], authoritativeSlyaEvidence = [], marketplaceTrades = [], normalizedEvents = null, actualClosing = [], checkpoint = null, sourceAvailability = {} } = {}) {
  const events = normalizedEvents || buildProductionEvents({ scope, ledgerEvents, authoritativeCargo, authoritativeSlyaEvidence, marketplaceTrades });
  const result = buildCompleteBreakEvenAccounting({ scope, period, currency: 'ATLAS', events, actualClosing: actualClosingRows(actualClosing), checkpoint });
  const freshness = {
    generatedAt: new Date().toISOString(),
    scanning: sourceAvailability.scanning || 'available',
    mining: sourceAvailability.mining || 'available',
    crafting: sourceAvailability.crafting || 'available',
    upgrading: sourceAvailability.upgrading || (authoritativeSlyaEvidence.some((row) => row.evidenceType === 'upgrading') ? 'available' : 'unavailable'),
    marketplace: sourceAvailability.marketplace || (marketplaceTrades.length ? 'available' : 'unavailable'),
    cargo: sourceAvailability.cargo || (authoritativeCargo.length ? 'available' : 'unavailable'),
    closingInventory: sourceAvailability.closingInventory || (actualClosing.length ? 'available' : 'unavailable'),
  };
  const unavailableSources = Object.entries(freshness).filter(([key, value]) => key !== 'generatedAt' && value === 'unavailable').map(([key]) => key);
  if (freshness.marketplace === 'unavailable') for (const row of result.rows) {
    row.acquisitions.lm = null; row.acquisitions.gm = null; row.costsBySource.lm = null; row.costsBySource.gm = null;
  }
  for (const source of ['scanning', 'mining', 'crafting', 'upgrading', 'cargo']) if (freshness[source] === 'unavailable') for (const row of result.rows) {
    row.acquisitions[source] = null; row.costsBySource[source] = null;
  }
  return { ...result, sourceFreshness: freshness, unavailableSources, inputEventCount: events.length };
}

module.exports = { exactText, lamportsToSolExact, marketplaceEvents, legacyLedgerEvents, authoritativeCargoEvents, authoritativeSlyaAccountingEvents, actualClosingRows, buildProductionEvents, buildProductionCompleteAccounting };
