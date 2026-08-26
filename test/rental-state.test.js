'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CURRENT_CONTRACT_OFFSETS,
  CURRENT_RENTAL_OFFSETS,
  decodeCurrentContract,
  decodeCurrentRental,
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

function rentalFixture({ borrowerProfile = key(2), contract = key(5), endTime = 2_000_000_000n } = {}) {
  const data = Buffer.alloc(240);
  borrowerProfile.copy(data, CURRENT_RENTAL_OFFSETS.borrowerProfile);
  contract.copy(data, CURRENT_RENTAL_OFFSETS.contract);
  data.writeBigInt64LE(endTime, CURRENT_RENTAL_OFFSETS.endTime);
  return data;
}

test('current SRSLY contract and rental layouts expose fleet, rate, profile, and end time', () => {
  const contract = decodeCurrentContract(contractFixture());
  const rental = decodeCurrentRental(rentalFixture());
  assert.deepEqual(contract.fleet, key(3));
  assert.deepEqual(contract.activeRental, key(4));
  assert.equal(contract.rate, 9_000_000_000n);
  assert.deepEqual(rental.borrowerProfile, key(2));
  assert.deepEqual(rental.contract, key(5));
  assert.equal(rental.endTimeSeconds, 2_000_000_000n);
});

test('only the contract authoritative active-rental pointer can discover a managed fleet', () => {
  const rentalAddress = key(4);
  const matched = matchActiveRental({
    rentalAddress,
    rentalData: rentalFixture(),
    contractData: contractFixture({ activeRental: rentalAddress }),
  });
  assert.deepEqual(matched, { fleet: key(3), rate: 9_000_000_000n, endTimeSeconds: 2_000_000_000n });
  assert.equal(matchActiveRental({
    rentalAddress: key(9),
    rentalData: rentalFixture(),
    contractData: contractFixture({ activeRental: rentalAddress }),
  }), null);
});

test('legacy SAGE discovery remains present while current SRSLY rentals merge by fleet account', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /offset: fleetFieldOffsets\.subProfile/);
  assert.match(main, /offset: CURRENT_RENTAL_OFFSETS\.borrowerProfile/);
  assert.match(main, /currentRentalsByFleet\.set\(fleetKey/);
  assert.match(main, /currentRentalFleetKeys\.forEach/);
  assert.match(main, /currentRental\?\.rentalEnd \|\| await/);
  assert.match(main, /currentRental\?\.rateAtlasPerDay \?\? null/);
});
