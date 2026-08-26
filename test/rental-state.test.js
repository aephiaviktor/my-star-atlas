'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CURRENT_CONTRACT_OFFSETS,
  CURRENT_RENTAL_OFFSETS,
  LEGACY_CONTRACT_OFFSETS,
  LEGACY_RENTAL_OFFSETS,
  decodeCurrentContract,
  decodeCurrentRental,
  decodeLegacyContract,
  decodeLegacyRental,
  matchActiveRental,
} = require('../electron/rental-state');

function key(byte) { return Buffer.alloc(32, byte); }

function contractFixture({ fleet = key(3), activeRental = key(4), rate = 9_000_000_000n } = {}) {
  const data = Buffer.alloc(240);
  data.writeBigUInt64LE(rate, CURRENT_CONTRACT_OFFSETS.rate);
  fleet.copy(data, CURRENT_CONTRACT_OFFSETS.fleet);
  activeRental.copy(data, CURRENT_CONTRACT_OFFSETS.activeRental);
  return data;
}

function rentalFixture({
  borrowerProfile = key(2),
  contract = key(5),
  rate = 8_640_000_000n,
  startTime = 1_999_568_000n,
  endTime = 2_000_000_000n,
  serviceFee = 864_000_000n,
  bidAtlas = 43_200_000_000n,
  hasReferrer = false,
} = {}) {
  const data = Buffer.alloc(280);
  borrowerProfile.copy(data, CURRENT_RENTAL_OFFSETS.borrowerProfile);
  contract.copy(data, CURRENT_RENTAL_OFFSETS.contract);
  data.writeBigUInt64LE(rate, CURRENT_RENTAL_OFFSETS.rate);
  data.writeBigInt64LE(startTime, CURRENT_RENTAL_OFFSETS.startTime);
  data.writeBigInt64LE(endTime, CURRENT_RENTAL_OFFSETS.endTime);
  data.writeBigUInt64LE(serviceFee, CURRENT_RENTAL_OFFSETS.serviceFee);
  data.writeUInt8(hasReferrer ? 1 : 0, CURRENT_RENTAL_OFFSETS.referrer);
  if (hasReferrer) key(7).copy(data, CURRENT_RENTAL_OFFSETS.referrer + 1);
  const bidAtlasOffset = CURRENT_RENTAL_OFFSETS.referrer + 1 + (hasReferrer ? 32 : 0) + 2 + 8;
  data.writeBigUInt64LE(bidAtlas, bidAtlasOffset);
  return data;
}

function legacyContractFixture({ activeRental = key(8) } = {}) {
  const data = Buffer.alloc(240);
  activeRental.copy(data, LEGACY_CONTRACT_OFFSETS.activeRental);
  return data;
}

function legacyRentalFixture({
  effectiveRateAtlasPerDay = 1087.9,
  startTime = 1_999_568_000n,
  endTime = 2_000_000_000n,
  cancelled = false,
} = {}) {
  const data = Buffer.alloc(180);
  data.writeDoubleLE(effectiveRateAtlasPerDay, LEGACY_RENTAL_OFFSETS.effectiveRate);
  data.writeBigInt64LE(startTime, LEGACY_RENTAL_OFFSETS.startTime);
  data.writeBigInt64LE(endTime, LEGACY_RENTAL_OFFSETS.endTime);
  data.writeUInt8(cancelled ? 1 : 0, LEGACY_RENTAL_OFFSETS.cancelled);
  return data;
}

test('current SRSLY contract and rental layouts expose authoritative active-rental economics', () => {
  const contract = decodeCurrentContract(contractFixture());
  const rental = decodeCurrentRental(rentalFixture({ hasReferrer: true }));
  assert.deepEqual(contract.fleet, key(3));
  assert.deepEqual(contract.activeRental, key(4));
  assert.equal(contract.rate, 9_000_000_000n);
  assert.deepEqual(rental.borrowerProfile, key(2));
  assert.deepEqual(rental.contract, key(5));
  assert.equal(rental.rate, 8_640_000_000n);
  assert.equal(rental.startTimeSeconds, 1_999_568_000n);
  assert.equal(rental.endTimeSeconds, 2_000_000_000n);
  assert.equal(rental.serviceFee, 864_000_000n);
  assert.equal(rental.bidAtlas, 43_200_000_000n);
});

test('only the contract authoritative active-rental pointer can discover a managed fleet', () => {
  const rentalAddress = key(4);
  const matched = matchActiveRental({
    rentalAddress,
    rentalData: rentalFixture(),
    contractData: contractFixture({ activeRental: rentalAddress }),
  });
  assert.deepEqual(matched, {
    fleet: key(3),
    rate: 8_640_000_000n,
    startTimeSeconds: 1_999_568_000n,
    endTimeSeconds: 2_000_000_000n,
    serviceFee: 864_000_000n,
    bidAtlas: 43_200_000_000n,
  });
  assert.equal(matchActiveRental({
    rentalAddress: key(9),
    rentalData: rentalFixture(),
    contractData: contractFixture({ activeRental: rentalAddress }),
  }), null);
});

test('legacy SRSLY exposes the effective renter-paid daily rate without adding another fee', () => {
  const contract = decodeLegacyContract(legacyContractFixture());
  const rental = decodeLegacyRental(legacyRentalFixture());
  assert.deepEqual(contract.activeRental, key(8));
  assert.equal(rental.effectiveRateAtlasPerDay, 1087.9);
  assert.equal(rental.endTimeSeconds, 2_000_000_000n);
  assert.equal(decodeLegacyRental(legacyRentalFixture({ cancelled: true })), null);
});

test('legacy SAGE discovery remains present while current and legacy SRSLY readers coexist', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /offset: fleetFieldOffsets\.subProfile/);
  assert.match(main, /SRSLYxcFnjd5jG2DpJw4as6UEyjwJQK1U4J1TD1hvZH/);
  assert.match(main, /SRSLY1fq9TJqCk1gNSE7VZL2bztvTn9wm4VR8u8jMKT/);
  assert.match(main, /offset: CURRENT_RENTAL_OFFSETS\.borrowerProfile/);
  assert.match(main, /decodeLegacyContract/);
  assert.match(main, /decodeLegacyRental/);
  assert.match(main, /currentRentalsByFleet\.set\(fleetKey/);
  assert.match(main, /currentRentalFleetKeys\.forEach/);
  assert.match(main, /const rental = currentRental \|\| await/);
  assert.match(main, /rental\?\.totalRentalCostAtlasPerDay \?\? null/);
});

test('active ATLAS reservation premium is spread across the exact rental duration', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /matched\.endTimeSeconds - matched\.startTimeSeconds/);
  assert.match(main, /normalizeAtlasAmount\(matched\.serviceFee\)/);
  assert.match(main, /normalizeAtlasAmount\(matched\.bidAtlas\)/);
  assert.match(main, /baseRateAtlasPerDay \+ \(serviceFeeAtlas \+ reservationPremiumAtlas\) \/ rentalDurationDays/);
});
