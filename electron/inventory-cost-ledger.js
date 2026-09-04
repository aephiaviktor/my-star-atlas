'use strict';

const COST_SOURCES = Object.freeze(['scanning', 'mining', 'crafting', 'lm', 'gm']);
const EPSILON = 1e-9;

function emptyCosts() {
  return Object.fromEntries(COST_SOURCES.map((source) => [source, 0]));
}

function requireText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function requirePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be positive`);
  return number;
}

function requireNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be non-negative`);
  return number;
}

function cloneLot(lot) {
  return {
    quantity: lot.quantity,
    uncostedQuantity: lot.uncostedQuantity,
    costs: { ...lot.costs },
    uncostedCosts: { ...lot.uncostedCosts },
    cargoCost: lot.cargoCost,
    uncostedCargoCost: lot.uncostedCargoCost,
  };
}

class InventoryCostLedger {
  constructor() {
    this.entries = new Map();
  }

  static fromSnapshot(rows) {
    if (!Array.isArray(rows)) throw new Error('ledger snapshot must be an array');
    const ledger = new InventoryCostLedger();
    for (const row of rows) {
      const location = requireText(row?.location, 'location');
      const asset = requireText(row?.asset, 'asset');
      const quantity = requireNonNegative(row?.quantity, 'quantity');
      const uncostedQuantity = requireNonNegative(row?.uncostedQuantity ?? 0, 'uncostedQuantity');
      if (uncostedQuantity > quantity + EPSILON) throw new Error('uncostedQuantity cannot exceed quantity');
      const costs = emptyCosts();
      for (const source of COST_SOURCES) costs[source] = requireNonNegative(row?.costs?.[source] ?? 0, `${source} cost`);
      const uncostedCosts = emptyCosts();
      for (const source of COST_SOURCES) {
        uncostedCosts[source] = requireNonNegative(row?.uncostedCosts?.[source] ?? 0, `uncosted ${source} cost`);
        if (uncostedCosts[source] > costs[source] + EPSILON) throw new Error(`uncosted ${source} cost cannot exceed total cost`);
      }
      const cargoCost = requireNonNegative(row?.cargoCost ?? 0, 'cargoCost');
      const uncostedCargoCost = requireNonNegative(row?.uncostedCargoCost ?? 0, 'uncostedCargoCost');
      if (uncostedCargoCost > cargoCost + EPSILON) throw new Error('uncostedCargoCost cannot exceed cargoCost');
      const key = ledger.key(location, asset);
      if (ledger.entries.has(key)) throw new Error(`duplicate ledger row: ${asset} at ${location}`);
      ledger.entries.set(key, { location, asset, quantity, uncostedQuantity, costs, uncostedCosts, cargoCost, uncostedCargoCost });
    }
    return ledger;
  }

  key(location, asset) {
    return `${requireText(location, 'location')}\n${requireText(asset, 'asset')}`;
  }

  ensure(location, asset) {
    const key = this.key(location, asset);
    if (!this.entries.has(key)) {
      this.entries.set(key, {
        location: String(location).trim(),
        asset: String(asset).trim(),
        quantity: 0,
        uncostedQuantity: 0,
        costs: emptyCosts(),
        uncostedCosts: emptyCosts(),
        cargoCost: 0,
        uncostedCargoCost: 0,
      });
    }
    return this.entries.get(key);
  }

  addLot(location, asset, lot) {
    const entry = this.ensure(location, asset);
    entry.quantity += lot.quantity;
    entry.uncostedQuantity += lot.uncostedQuantity;
    for (const source of COST_SOURCES) entry.costs[source] += lot.costs[source] || 0;
    for (const source of COST_SOURCES) entry.uncostedCosts[source] += lot.uncostedCosts?.[source] || 0;
    entry.cargoCost += lot.cargoCost || 0;
    entry.uncostedCargoCost += lot.uncostedCargoCost || 0;
    return entry;
  }

  acquire({ location, asset, quantity, source, totalCost, cargoCost = 0 }) {
    const units = requirePositive(quantity, 'quantity');
    const cargo = requireNonNegative(cargoCost, 'cargoCost');
    const lot = { quantity: units, uncostedQuantity: 0, costs: emptyCosts(), uncostedCosts: emptyCosts(), cargoCost: cargo, uncostedCargoCost: 0 };
    if (totalCost === null || totalCost === undefined) {
      if (source) throw new Error('totalCost is required when source is provided');
      lot.uncostedQuantity = units;
      lot.uncostedCargoCost = cargo;
    } else {
      if (!COST_SOURCES.includes(source)) throw new Error(`invalid cost source: ${source}`);
      lot.costs[source] = requireNonNegative(totalCost, 'totalCost');
    }
    this.addLot(location, asset, lot);
    return this.get(location, asset);
  }

  acquireLot({ location, asset, quantity, uncostedQuantity = 0, costs = {}, uncostedCosts = null, cargoCost = 0, uncostedCargoCost = null }) {
    const units = requirePositive(quantity, 'quantity');
    const uncosted = requireNonNegative(uncostedQuantity, 'uncostedQuantity');
    if (uncosted > units + EPSILON) throw new Error('uncostedQuantity cannot exceed quantity');
    const lot = { quantity: units, uncostedQuantity: uncosted, costs: emptyCosts(), uncostedCosts: emptyCosts(), cargoCost: requireNonNegative(cargoCost, 'cargoCost'), uncostedCargoCost: 0 };
    const inferredUncostedRatio = units > 0 ? uncosted / units : 0;
    for (const source of COST_SOURCES) {
      lot.costs[source] = requireNonNegative(costs?.[source] ?? 0, `${source} cost`);
      lot.uncostedCosts[source] = requireNonNegative(uncostedCosts?.[source] ?? lot.costs[source] * inferredUncostedRatio, `uncosted ${source} cost`);
      if (lot.uncostedCosts[source] > lot.costs[source] + EPSILON) throw new Error(`uncosted ${source} cost cannot exceed total cost`);
    }
    lot.uncostedCargoCost = requireNonNegative(uncostedCargoCost ?? lot.cargoCost * inferredUncostedRatio, 'uncostedCargoCost');
    if (lot.uncostedCargoCost > lot.cargoCost + EPSILON) throw new Error('uncostedCargoCost cannot exceed cargoCost');
    this.addLot(location, asset, lot);
    return this.get(location, asset);
  }

  consume({ location, asset, quantity }) {
    const units = requirePositive(quantity, 'quantity');
    const entry = this.ensure(location, asset);
    if (units > entry.quantity + EPSILON) {
      throw new Error(`insufficient inventory for ${entry.asset} at ${entry.location}`);
    }
    const uncostedUnits = Math.min(units, entry.uncostedQuantity);
    const costedUnits = Math.max(0, units - uncostedUnits);
    const costedQuantity = Math.max(0, entry.quantity - entry.uncostedQuantity);
    const uncostedRatio = entry.uncostedQuantity > 0 ? uncostedUnits / entry.uncostedQuantity : 0;
    const costedRatio = costedQuantity > 0 ? costedUnits / costedQuantity : 0;
    const lot = {
      quantity: units,
      uncostedQuantity: uncostedUnits,
      costs: emptyCosts(),
      uncostedCosts: emptyCosts(),
      cargoCost: 0,
      uncostedCargoCost: entry.uncostedCargoCost * uncostedRatio,
    };
    for (const source of COST_SOURCES) {
      lot.uncostedCosts[source] = entry.uncostedCosts[source] * uncostedRatio;
      lot.costs[source] = lot.uncostedCosts[source]
        + (entry.costs[source] - entry.uncostedCosts[source]) * costedRatio;
    }
    lot.cargoCost = lot.uncostedCargoCost
      + (entry.cargoCost - entry.uncostedCargoCost) * costedRatio;

    entry.quantity = Math.max(0, entry.quantity - units);
    entry.uncostedQuantity = Math.max(0, entry.uncostedQuantity - lot.uncostedQuantity);
    entry.cargoCost = Math.max(0, entry.cargoCost - lot.cargoCost);
    entry.uncostedCargoCost = Math.max(0, entry.uncostedCargoCost - lot.uncostedCargoCost);
    for (const source of COST_SOURCES) {
      entry.costs[source] = Math.max(0, entry.costs[source] - lot.costs[source]);
      entry.uncostedCosts[source] = Math.max(0, entry.uncostedCosts[source] - lot.uncostedCosts[source]);
    }
    return cloneLot(lot);
  }

  reconcile({ location, asset, quantity }) {
    const targetQuantity = requireNonNegative(quantity, 'quantity');
    const entry = this.ensure(location, asset);
    const variance = targetQuantity - entry.quantity;
    if (variance > EPSILON) this.acquire({ location, asset, quantity: variance, source: null, totalCost: null });
    else if (variance < -EPSILON) this.consume({ location, asset, quantity: -variance });
    return this.get(location, asset);
  }

  transfer({ origin, destination, asset, quantity, cargoCost = 0, carryPoolRate = false }) {
    const units = requirePositive(quantity, 'quantity');
    const originPool = this.get(origin, asset);
    const consumed = this.consume({ location: origin, asset, quantity: units });
    const addedCargoCost = requireNonNegative(cargoCost, 'cargoCost');
    const hasPoolRate = originPool.quantity - originPool.uncostedQuantity > EPSILON;
    const lot = carryPoolRate && hasPoolRate ? {
      quantity: units,
      uncostedQuantity: 0,
      costs: Object.fromEntries(COST_SOURCES.map((source) => [source, originPool.costPerUnit[source] * units])),
      uncostedCosts: emptyCosts(),
      cargoCost: addedCargoCost + originPool.cargoCostPerUnit * units,
      uncostedCargoCost: 0,
    } : consumed;
    if (!(carryPoolRate && hasPoolRate)) {
      lot.cargoCost += addedCargoCost;
      lot.uncostedCargoCost += addedCargoCost * (lot.uncostedQuantity / lot.quantity);
    }
    this.addLot(destination, asset, lot);
    return cloneLot(lot);
  }

  craft({ location, outputAsset, outputQuantity, ingredients, craftingCost = 0 }) {
    const outputUnits = requirePositive(outputQuantity, 'outputQuantity');
    if (!Array.isArray(ingredients) || ingredients.length === 0) throw new Error('ingredients are required');

    const requiredByAsset = new Map();
    for (const ingredient of ingredients) {
      const asset = requireText(ingredient.asset, 'ingredient asset');
      const units = requirePositive(ingredient.quantity, 'ingredient quantity');
      requiredByAsset.set(asset, (requiredByAsset.get(asset) || 0) + units);
    }
    for (const [asset, units] of requiredByAsset.entries()) {
      const available = this.ensure(location, asset).quantity;
      if (units > available + EPSILON) throw new Error(`insufficient inventory for ${asset} at ${String(location).trim()}`);
    }

    const outputLot = { quantity: outputUnits, uncostedQuantity: 0, costs: emptyCosts(), uncostedCosts: emptyCosts(), cargoCost: 0, uncostedCargoCost: 0 };
    let hasUncostedIngredient = false;
    for (const ingredient of ingredients) {
      const ingredientPool = this.get(location, ingredient.asset);
      const hasPoolRate = ingredientPool.quantity - ingredientPool.uncostedQuantity > EPSILON;
      const consumed = this.consume({ location, asset: ingredient.asset, quantity: ingredient.quantity });
      if (!hasPoolRate) hasUncostedIngredient = true;
      outputLot.cargoCost += hasPoolRate
        ? ingredientPool.cargoCostPerUnit * ingredient.quantity
        : consumed.cargoCost;
      for (const source of COST_SOURCES) {
        outputLot.costs[source] += hasPoolRate
          ? ingredientPool.costPerUnit[source] * ingredient.quantity
          : consumed.costs[source];
      }
    }
    outputLot.uncostedQuantity = hasUncostedIngredient ? outputUnits : 0;
    outputLot.costs.crafting += requireNonNegative(craftingCost, 'craftingCost');
    if (hasUncostedIngredient) {
      outputLot.uncostedCosts = { ...outputLot.costs };
      outputLot.uncostedCargoCost = outputLot.cargoCost;
    }
    this.addLot(location, outputAsset, outputLot);
    return cloneLot(outputLot);
  }

  applyEvent(event) {
    if (!event || typeof event !== 'object') throw new Error('event is required');
    if (event.type === 'acquire') return this.acquire(event);
    if (event.type === 'acquire-lot') return this.acquireLot(event);
    if (event.type === 'consume') return this.consume(event);
    if (event.type === 'reconcile') return this.reconcile(event);
    if (event.type === 'transfer') return this.transfer(event);
    if (event.type === 'craft') return this.craft(event);
    throw new Error(`unsupported ledger event: ${event.type}`);
  }

  applyEvents(events) {
    const ordered = Array.from(events || []).map((event, index) => ({ event, index })).sort((left, right) => {
      const timeDifference = Date.parse(left.event.timestamp) - Date.parse(right.event.timestamp);
      if (!Number.isFinite(timeDifference) || timeDifference === 0) return left.index - right.index;
      return timeDifference;
    });
    return ordered.map(({ event }) => this.applyEvent(event));
  }

  get(location, asset) {
    const entry = this.ensure(location, asset);
    const quantity = entry.quantity;
    const knownQuantity = Math.max(0, quantity - entry.uncostedQuantity);
    const knownCosts = emptyCosts();
    const costPerUnit = emptyCosts();
    for (const source of COST_SOURCES) {
      knownCosts[source] = Math.max(0, entry.costs[source] - entry.uncostedCosts[source]);
      costPerUnit[source] = knownQuantity > 0 ? knownCosts[source] / knownQuantity : 0;
    }
    const knownCargoCost = Math.max(0, entry.cargoCost - entry.uncostedCargoCost);
    const baseTotalCost = COST_SOURCES.reduce((sum, source) => sum + knownCosts[source], 0);
    const baseCostPerUnit = knownQuantity > 0 ? baseTotalCost / knownQuantity : 0;
    const cargoCostPerUnit = knownQuantity > 0 ? knownCargoCost / knownQuantity : 0;
    return {
      location: entry.location,
      asset: entry.asset,
      quantity,
      uncostedQuantity: entry.uncostedQuantity,
      costs: { ...entry.costs },
      uncostedCosts: { ...entry.uncostedCosts },
      knownCosts,
      cargoCost: entry.cargoCost,
      uncostedCargoCost: entry.uncostedCargoCost,
      knownCargoCost,
      costPerUnit,
      baseCostPerUnit,
      cargoCostPerUnit,
      totalCostPerUnit: baseCostPerUnit + cargoCostPerUnit,
    };
  }

  snapshot() {
    return Array.from(this.entries.values())
      .map((entry) => this.get(entry.location, entry.asset))
      .sort((a, b) => a.location.localeCompare(b.location) || a.asset.localeCompare(b.asset));
  }
}

module.exports = { COST_SOURCES, InventoryCostLedger };
