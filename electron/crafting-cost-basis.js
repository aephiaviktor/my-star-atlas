'use strict';

function finiteOrNull(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}

function totalLotBasis(lot) {
  return Object.values(lot?.costs || {}).reduce((sum, value) => sum + Number(value || 0), 0) + Number(lot?.cargoCost || 0);
}

function utcDay(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function buildCraftingBasisByDay(appliedEventResults = []) {
  const basisByDay = new Map();
  for (const applied of appliedEventResults) {
    const event = applied?.event;
    const lot = applied?.result;
    if (event?.type !== 'craft') continue;
    const isoDate = utcDay(event.timestamp);
    const location = String(event.location || '').trim();
    const output = String(event.outputAsset || '').trim();
    if (!isoDate || !location || !output) continue;
    const key = `${isoDate}\n${location}\n${output}`;
    const entry = basisByDay.get(key) || { basis: 0, uncosted: false };
    entry.basis += Math.max(0, totalLotBasis(lot) - Number(event.craftingCost || 0));
    entry.uncosted ||= Number(lot?.uncostedQuantity || 0) > 0;
    basisByDay.set(key, entry);
  }
  return basisByDay;
}

function enrichCraftingEarningsRows({ craftingRows = [], craftingBasisByDay = new Map(), resolvePrice = () => null, atlasPerSol = null } = {}) {
  return craftingRows.map((craftingRow) => {
    const outputPriceAtl = finiteOrNull(resolvePrice(craftingRow.output));
    const crafted = finiteOrNull(craftingRow.crafted);
    const revenueAtlasPerDay = outputPriceAtl != null && crafted != null ? crafted * outputPriceAtl : null;
    const craftingBasis = craftingBasisByDay.get(`${craftingRow.isoDate}\n${craftingRow.starbase}\n${craftingRow.output}`);
    const ingCostsAtlas = craftingBasis && !craftingBasis.uncosted ? finiteOrNull(craftingBasis.basis) : null;
    const ingredientExternalValues = (craftingRow.ingredients || []).map(({ input, amount }) => {
      const price = finiteOrNull(resolvePrice(input));
      const quantity = finiteOrNull(amount);
      return price == null || quantity == null ? null : quantity * price;
    });
    const ingredientExternalValueAtlas = ingredientExternalValues.length > 0 && ingredientExternalValues.every(Number.isFinite)
      ? ingredientExternalValues.reduce((sum, value) => sum + value, 0) : null;
    const feeCostsAtlas = finiteOrNull(craftingRow.feeAmount);
    const txCostSol = finiteOrNull(craftingRow.txCostSol);
    const solPrice = finiteOrNull(atlasPerSol);
    const txsCostsAtlas = solPrice != null && txCostSol != null ? txCostSol * solPrice : null;
    const totalCostsAtlas = ingCostsAtlas != null && feeCostsAtlas != null && txsCostsAtlas != null ? ingCostsAtlas + feeCostsAtlas + txsCostsAtlas : null;
    const costsPerUnitAtlas = totalCostsAtlas != null && crafted > 0 ? totalCostsAtlas / crafted : null;
    const netProfitAtlas = revenueAtlasPerDay != null && totalCostsAtlas != null ? revenueAtlasPerDay - totalCostsAtlas : null;
    const crew = finiteOrNull(craftingRow.crew);
    const netProfitPerCrew = netProfitAtlas != null && crew > 0 ? netProfitAtlas / crew : null;
    const profitMarginPercent = netProfitAtlas != null && revenueAtlasPerDay != null && revenueAtlasPerDay !== 0 ? (netProfitAtlas / revenueAtlasPerDay) * 100 : null;
    const externalTotalCostsAtlas = ingredientExternalValueAtlas != null && feeCostsAtlas != null && txsCostsAtlas != null ? ingredientExternalValueAtlas + feeCostsAtlas + txsCostsAtlas : null;
    const externalNetProfitAtlas = revenueAtlasPerDay != null && externalTotalCostsAtlas != null ? revenueAtlasPerDay - externalTotalCostsAtlas : null;
    return {
      ...craftingRow, assetName: craftingRow.output, outputPriceAtl, revenueAtlasPerDay, ingCostsAtlas,
      ingredientExternalValueAtlas, externalTotalCostsAtlas, externalNetProfitAtlas,
      externalNetProfitPerCrew: externalNetProfitAtlas != null && crew > 0 ? externalNetProfitAtlas / crew : null,
      externalProfitMarginPercent: externalNetProfitAtlas != null && revenueAtlasPerDay != null && revenueAtlasPerDay !== 0 ? (externalNetProfitAtlas / revenueAtlasPerDay) * 100 : null,
      externalCostsPerUnitAtlas: externalTotalCostsAtlas != null && crafted > 0 ? externalTotalCostsAtlas / crafted : null,
      feeCostsAtlas, txsCostsAtlas, totalCostsAtlas, costsPerUnitAtlas, netProfitAtlas, crew, netProfitPerCrew, profitMarginPercent,
    };
  });
}

module.exports = { buildCraftingBasisByDay, enrichCraftingEarningsRows };
