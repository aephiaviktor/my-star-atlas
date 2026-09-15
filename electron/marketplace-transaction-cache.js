'use strict';

function createMarketplaceTransactionCacheConnection(connection, { persistentCache = null, onPersistentError = null } = {}) {
  if (!connection || typeof connection !== 'object') throw new TypeError('Marketplace Connection is required.');
  const transactions = new Map();

  const reportPersistentError = (error) => {
    if (typeof onPersistentError === 'function') onPersistentError(error);
  };

  const readPersistent = (signature) => {
    if (!persistentCache || typeof persistentCache.read !== 'function') return null;
    try {
      return persistentCache.read(signature)?.transaction || null;
    } catch (error) {
      reportPersistentError(error);
      return null;
    }
  };

  const writePersistent = (signature, transaction) => {
    if (!persistentCache || typeof persistentCache.write !== 'function') return;
    try {
      persistentCache.write(signature, transaction);
    } catch (error) {
      // Persistence is an optimization. A cache I/O or integrity failure must
      // not make a successfully fetched canonical transaction unavailable.
      reportPersistentError(error);
    }
  };

  const retainSuccessful = (signature, source) => {
    let cached;
    cached = source.then(
      (transaction) => {
        if (transaction == null) {
          if (transactions.get(signature) === cached) transactions.delete(signature);
        } else {
          writePersistent(signature, transaction);
        }
        return transaction;
      },
      (error) => {
        if (transactions.get(signature) === cached) transactions.delete(signature);
        throw error;
      },
    );
    return cached;
  };

  const loadPersistent = (signature) => {
    const transaction = readPersistent(signature);
    if (!transaction) return false;
    transactions.set(signature, Promise.resolve(transaction));
    return true;
  };

  const loadSingle = (signature, options) => {
    const key = String(signature);
    if (transactions.has(key)) return transactions.get(key);
    if (loadPersistent(key)) return transactions.get(key);
    let promise = Promise.resolve().then(() => connection.getParsedTransaction(key, options));
    promise = retainSuccessful(key, promise);
    transactions.set(key, promise);
    return promise;
  };

  const loadBatch = async (signatures, options) => {
    const keys = Array.from(signatures || [], String);
    const uncached = Array.from(new Set(keys.filter((signature) => !transactions.has(signature))));
    for (const signature of uncached) loadPersistent(signature);
    const missing = uncached.filter((signature) => !transactions.has(signature));
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
