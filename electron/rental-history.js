'use strict';

const normalizeText = (value) => String(value || '').trim();
const normalizeLabel = (value) => normalizeText(value).toLowerCase();
const normalizeFaction = (value) => {
  const text = normalizeText(value).toUpperCase();
  return text === 'UST' ? 'USTUR' : text;
};

function buildRentalHistoryFluxQuery(bucket, rangeStart = '-40d') {
  const escapedBucket = String(bucket || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `from(bucket: "${escapedBucket}")
  |> range(start: ${rangeStart})
  |> filter(fn: (r) => r._measurement == "fleet_rental_daily_v1")
  |> pivot(rowKey: ["_time", "fleetAccount", "contractId", "rentalId"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", "fleetAccount", "contractId", "rentalId", "rentalCostAtlas", "dailyRateAtlas", "fleetLabel", "faction", "programGeneration", "requiredCrew", "crewCount", "crewSnapshotSource"])
  |> sort(columns: ["_time"])`;
}

function projectRentalHistoryRows(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const fleetAccount = normalizeText(row?.fleetAccount);
    const contractId = normalizeText(row?.contractId);
    const rentalId = normalizeText(row?.rentalId);
    const timestamp = new Date(String(row?._time || ''));
    const rentalCostAtlas = Number(row?.rentalCostAtlas);
    if (!fleetAccount || !contractId || !rentalId || Number.isNaN(timestamp.getTime())
      || !Number.isFinite(rentalCostAtlas) || rentalCostAtlas < 0) return [];
    return [{
      fleetAccount,
      contractId,
      rentalId,
      isoDate: timestamp.toISOString().slice(0, 10),
      rentalCostAtlas,
      dailyRateAtlas: Number.isFinite(Number(row?.dailyRateAtlas)) ? Number(row.dailyRateAtlas) : null,
      fleetLabel: normalizeText(row?.fleetLabel),
      faction: normalizeFaction(row?.faction),
      programGeneration: normalizeText(row?.programGeneration),
      requiredCrew: Number.isFinite(Number(row?.requiredCrew)) && Number(row.requiredCrew) > 0 ? Number(row.requiredCrew) : null,
      crewCount: Number.isFinite(Number(row?.crewCount)) && Number(row.crewCount) >= 0 ? Number(row.crewCount) : null,
      crewSnapshotSource: normalizeText(row?.crewSnapshotSource),
    }];
  });
}

function createRentalHistoryIndex(records) {
  const byAccountDate = new Map();
  const fallbackCandidates = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const accountKey = `${record.fleetAccount}\n${record.isoDate}`;
    const current = byAccountDate.get(accountKey) || { rentalCostAtlas: 0, records: [] };
    current.rentalCostAtlas += record.rentalCostAtlas;
    current.records.push(record);
    byAccountDate.set(accountKey, current);

    const label = normalizeLabel(record.fleetLabel);
    const faction = normalizeFaction(record.faction);
    if (!label || !faction) continue;
    const fallbackKey = `${faction}\n${label}\n${record.isoDate}`;
    const candidates = fallbackCandidates.get(fallbackKey) || new Map();
    const candidate = candidates.get(record.fleetAccount) || { rentalCostAtlas: 0, records: [] };
    candidate.rentalCostAtlas += record.rentalCostAtlas;
    candidate.records.push(record);
    candidates.set(record.fleetAccount, candidate);
    fallbackCandidates.set(fallbackKey, candidates);
  }
  return { byAccountDate, fallbackCandidates };
}

function summarizeRentalCandidate(candidate, fleetAccount = '') {
  if (!candidate) return null;
  const records = candidate.records || [];
  const authoritativeCrewSources = new Set(['fleet_account_observed', 'fleet_composition_historical_verified']);
  const observedCrewRecords = records.filter((record) => authoritativeCrewSources.has(record.crewSnapshotSource)
    && Number.isFinite(record.requiredCrew) && record.requiredCrew > 0);
  const requiredCrewValues = new Set(observedCrewRecords.map((record) => record.requiredCrew));
  const crewCountValues = new Set(observedCrewRecords.map((record) => record.crewCount).filter(Number.isFinite));
  const crewFactsConsistent = observedCrewRecords.length > 0 && requiredCrewValues.size === 1 && crewCountValues.size <= 1;
  const crewSources = new Set(observedCrewRecords.map((record) => record.crewSnapshotSource));
  return {
    fleetAccount: fleetAccount || records[0]?.fleetAccount || '',
    rentalCostAtlas: candidate.rentalCostAtlas,
    rentalContract: records.length === 1 ? records[0].contractId : null,
    rentalIds: records.map((record) => record.rentalId),
    programGenerations: Array.from(new Set(records.map((record) => record.programGeneration).filter(Boolean))),
    requiredCrew: crewFactsConsistent ? observedCrewRecords[0].requiredCrew : null,
    crewCount: crewFactsConsistent && crewCountValues.size === 1 ? Array.from(crewCountValues)[0] : null,
    crewSnapshotSource: crewFactsConsistent && crewSources.size === 1 ? Array.from(crewSources)[0] : '',
  };
}

function resolveHistoricalRental(index, { fleetAccount = '', fleetLabel = '', faction = '', isoDate = '' } = {}) {
  const account = normalizeText(fleetAccount);
  const date = normalizeText(isoDate);
  if (!index || !date) return null;
  if (account) {
    const exact = index.byAccountDate.get(`${account}\n${date}`);
    if (exact) return summarizeRentalCandidate(exact, account);
    return null;
  }
  const label = normalizeLabel(fleetLabel);
  const normalizedFaction = normalizeFaction(faction);
  if (!label || !normalizedFaction) return null;
  const candidates = index.fallbackCandidates.get(`${normalizedFaction}\n${label}\n${date}`);
  if (!candidates || candidates.size !== 1) return null;
  const [[candidateAccount, candidate]] = candidates.entries();
  return summarizeRentalCandidate(candidate, candidateAccount);
}

module.exports = {
  buildRentalHistoryFluxQuery,
  projectRentalHistoryRows,
  createRentalHistoryIndex,
  resolveHistoricalRental,
};
