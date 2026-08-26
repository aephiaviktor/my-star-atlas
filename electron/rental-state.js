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
  referrer: 191,
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
  if (startTimeSeconds <= 0n || endTimeSeconds <= startTimeSeconds) return null;

  const referrerOption = data.readUInt8(CURRENT_RENTAL_OFFSETS.referrer);
  if (referrerOption !== 0 && referrerOption !== 1) return null;
  const discountBpsOffset = CURRENT_RENTAL_OFFSETS.referrer + 1 + (referrerOption === 1 ? PUBLIC_KEY_BYTES : 0);
  const bidAtlasOffset = discountBpsOffset + 2 + 8;
  if (data.length < bidAtlasOffset + 8) return null;
  const bidAtlas = data.readBigUInt64LE(bidAtlasOffset);
  return { borrowerProfile, contract, rate, startTimeSeconds, endTimeSeconds, bidAtlas };
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
    bidAtlas: rental.bidAtlas,
  };
}

module.exports = {
  CURRENT_CONTRACT_OFFSETS,
  CURRENT_RENTAL_OFFSETS,
  decodeCurrentContract,
  decodeCurrentRental,
  matchActiveRental,
};
