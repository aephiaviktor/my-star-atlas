'use strict';

function createMarketplaceTransactionCacheConnection(connection) {
  if (!connection || typeof connection !== 'object') throw new TypeError('Marketplace Connection is required.');
  const transactions = new Map();

  const retainSuccessful = (signature, source) => {
    let cached;
    cached = source.then(
      (transaction) => {
        if (transaction == null && transactions.get(signature) === cached) transactions.delete(signature);
        return transaction;
      },
      (error) => {
        if (transactions.get(signature) === cached) transactions.delete(signature);
        throw error;
      },
    );
    return cached;
  };

  const loadSingle = (signature, options) => {
    const key = String(signature);
    if (transactions.has(key)) return transactions.get(key);
    let promise = Promise.resolve().then(() => connection.getParsedTransaction(key, options));
    promise = retainSuccessful(key, promise);
    transactions.set(key, promise);
    return promise;
  };

  const loadBatch = async (signatures, options) => {
    const keys = Array.from(signatures || [], String);
    const missing = Array.from(new Set(keys.filter((signature) => !transactions.has(signature))));
    if (missing.length) {
      const batch = Promise.resolve().then(() => connection.getParsedTransactions(missing, options));
      for (let index = 0; index < missing.length; index += 1) {
        const signature = missing[index];
        let promise = batch.then((rows) => rows?.[index] ?? null);
        promise = retainSuccessful(signature, promise);
        transactions.set(signature, promise);
      }
    }
    return Promise.all(keys.map((signature) => transactions.get(signature)));
  };

  return new Proxy(connection, {
    get(target, property, receiver) {
      if (property === 'getParsedTransaction' && typeof target.getParsedTransaction === 'function') return loadSingle;
      if (property === 'getParsedTransactions' && typeof target.getParsedTransactions === 'function') return loadBatch;
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

module.exports = { createMarketplaceTransactionCacheConnection };
