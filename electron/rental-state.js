'use strict';

const CURRENT_CONTRACT_OFFSETS = Object.freeze({
  rate: 14,
  fleet: 80,
  activeRental: 176,
});

const CURRENT_RENTAL_OFFSETS = Object.freeze({
  borrowerProfile: 77,
  contract: 109,
  rate: 141,
  startTime: 165,
  endTime: 173,
  serviceFee: 181,
  referrer: 191,
});

const LEGACY_CONTRACT_OFFSETS = Object.freeze({
  activeRental: 99,
});

const LEGACY_RENTAL_OFFSETS = Object.freeze({
  effectiveRate: 137,
  startTime: 145,
  endTime: 153,
  cancelled: 161,
});

const PUBLIC_KEY_BYTES = 32;
const SYSTEM_PROGRAM_BYTES = Buffer.alloc(PUBLIC_KEY_BYTES);

function publicKeyBytes(data, offset) {
  if (!Buffer.isBuffer(data) || data.length < offset + PUBLIC_KEY_BYTES) return null;
  return data.subarray(offset, offset + PUBLIC_KEY_BYTES);
}

function decodeCurrentContract(data) {
  const fleet = publicKeyBytes(data, CURRENT_CONTRACT_OFFSETS.fleet);
  const activeRental = publicKeyBytes(data, CURRENT_CONTRACT_OFFSETS.activeRental);
  if (!fleet || !activeRental || activeRental.equals(SYSTEM_PROGRAM_BYTES)
    || data.length < CURRENT_CONTRACT_OFFSETS.rate + 8) return null;
  const rate = data.readBigUInt64LE(CURRENT_CONTRACT_OFFSETS.rate);
  return { fleet, activeRental, rate };
}

function decodeCurrentRental(data) {
  const borrowerProfile = publicKeyBytes(data, CURRENT_RENTAL_OFFSETS.borrowerProfile);
  const contract = publicKeyBytes(data, CURRENT_RENTAL_OFFSETS.contract);
  if (!borrowerProfile || !contract || data.length < CURRENT_RENTAL_OFFSETS.referrer + 1) return null;
  const rate = data.readBigUInt64LE(CURRENT_RENTAL_OFFSETS.rate);
  const startTimeSeconds = data.readBigInt64LE(CURRENT_RENTAL_OFFSETS.startTime);
  const endTimeSeconds = data.readBigInt64LE(CURRENT_RENTAL_OFFSETS.endTime);
  const serviceFee = data.readBigUInt64LE(CURRENT_RENTAL_OFFSETS.serviceFee);
  if (startTimeSeconds <= 0n || endTimeSeconds <= startTimeSeconds) return null;

  const referrerOption = data.readUInt8(CURRENT_RENTAL_OFFSETS.referrer);
  if (referrerOption !== 0 && referrerOption !== 1) return null;
  const discountBpsOffset = CURRENT_RENTAL_OFFSETS.referrer + 1 + (referrerOption === 1 ? PUBLIC_KEY_BYTES : 0);
  const bidAtlasOffset = discountBpsOffset + 2 + 8;
  if (data.length < bidAtlasOffset + 8) return null;
  const bidAtlas = data.readBigUInt64LE(bidAtlasOffset);
  return { borrowerProfile, contract, rate, startTimeSeconds, endTimeSeconds, serviceFee, bidAtlas };
}

function decodeLegacyContract(data) {
  const activeRental = publicKeyBytes(data, LEGACY_CONTRACT_OFFSETS.activeRental);
  if (!activeRental || activeRental.equals(SYSTEM_PROGRAM_BYTES)) return null;
  return { activeRental };
}

function decodeLegacyRental(data) {
  if (!Buffer.isBuffer(data) || data.length <= LEGACY_RENTAL_OFFSETS.cancelled
    || data.readUInt8(LEGACY_RENTAL_OFFSETS.cancelled) !== 0) return null;
  const effectiveRateAtlasPerDay = data.readDoubleLE(LEGACY_RENTAL_OFFSETS.effectiveRate);
  const startTimeSeconds = data.readBigInt64LE(LEGACY_RENTAL_OFFSETS.startTime);
  const endTimeSeconds = data.readBigInt64LE(LEGACY_RENTAL_OFFSETS.endTime);
  if (!Number.isFinite(effectiveRateAtlasPerDay) || effectiveRateAtlasPerDay <= 0
    || startTimeSeconds <= 0n || endTimeSeconds <= startTimeSeconds) return null;
  return { effectiveRateAtlasPerDay, startTimeSeconds, endTimeSeconds };
}

function matchActiveRental({ rentalAddress, rentalData, contractData }) {
  const rental = decodeCurrentRental(rentalData);
  const contract = decodeCurrentContract(contractData);
  if (!rental || !contract || !Buffer.isBuffer(rentalAddress)) return null;
  if (!contract.activeRental.equals(rentalAddress)) return null;
  return {
    fleet: contract.fleet,
    rate: rental.rate,
    startTimeSeconds: rental.startTimeSeconds,
    endTimeSeconds: rental.endTimeSeconds,
    serviceFee: rental.serviceFee,
    bidAtlas: rental.bidAtlas,
  };
}

module.exports = {
  CURRENT_CONTRACT_OFFSETS,
  CURRENT_RENTAL_OFFSETS,
  LEGACY_CONTRACT_OFFSETS,
  LEGACY_RENTAL_OFFSETS,
  decodeCurrentContract,
  decodeCurrentRental,
  decodeLegacyContract,
  decodeLegacyRental,
  matchActiveRental,
};
