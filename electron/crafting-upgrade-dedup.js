'use strict';

const DEFAULT_START_TOLERANCE_MS = 15_000;

function text(value) { return String(value || '').trim(); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function day(timestamp) { const date = new Date(timestamp); return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10); }
function rowKey(row) { return `${row.isoDate}\n${text(row.starbase)}\n${text(row.output)}`; }
function subtractNonNegative(value, removed) {
  const result = Math.max(0, Number(value || 0) - Number(removed || 0));
  return result < 1e-9 ? 0 : result;
}

function subtractIngredient(ingredients, input, amount) {
  let remaining = Math.max(0, Number(amount) || 0);
  const result = [];
  for (const ingredient of ingredients || []) {
    if (text(ingredient.input) !== input || !(remaining > 0)) {
      result.push({ ...ingredient });
      continue;
    }
    const current = Math.max(0, Number(ingredient.amount) || 0);
    const removed = Math.min(current, remaining);
    remaining -= removed;
    if (current - removed > 1e-9) result.push({ ...ingredient, amount: current - removed });
  }
  return result;
}

function removeUpgradeMirroredCraftingEvents(craftingRows = [], upgradeJobs = [], { startToleranceMs = DEFAULT_START_TOLERANCE_MS } = {}) {
  const jobs = (upgradeJobs || []).flatMap((job, index) => {
    const startedAt = finite(job?.startedAt);
    const amount = finite(job?.amount);
    const starbase = text(job?.starbase);
    const asset = text(job?.component || job?.asset || job?.input);
    if (!(startedAt > 0) || !(amount > 0) || !starbase || !asset) return [];
    return [{ ...job, index, startedAt, amount, starbase, asset }];
  });
  const usedJobs = new Set();
  const mirroredIds = new Set();
  const mirroredEvents = [];
  const events = Array.from(craftingRows?.ledgerEvents || []).slice().sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  for (const event of events) {
    const timestamp = Date.parse(event?.timestamp);
    const amount = finite(event?.crafted);
    if (!Number.isFinite(timestamp) || !(amount > 0)) continue;
    const candidate = jobs
      .filter((job) => !usedJobs.has(job.index)
        && job.starbase === text(event.starbase)
        && job.asset === text(event.output)
        && job.amount === amount
        && Math.abs(timestamp - job.startedAt) <= startToleranceMs)
      .sort((left, right) => Math.abs(timestamp - left.startedAt) - Math.abs(timestamp - right.startedAt) || left.index - right.index)[0];
    if (!candidate) continue;
    usedJobs.add(candidate.index);
    mirroredIds.add(text(event.craftingId));
    mirroredEvents.push(event);
  }

  const byKey = new Map((craftingRows || []).map((row) => [rowKey(row), {
    ...row,
    ingredients: (row.ingredients || []).map((ingredient) => ({ ...ingredient })),
  }]));
  for (const event of mirroredEvents) {
    const key = `${day(event.timestamp)}\n${text(event.starbase)}\n${text(event.output)}`;
    const row = byKey.get(key);
    if (!row) continue;
    row.crafted = subtractNonNegative(row.crafted, event.crafted);
    row.txsDaily = subtractNonNegative(row.txsDaily, 1);
    row.feeAmount = subtractNonNegative(row.feeAmount, event.feeAmount);
    row.txCostSol = subtractNonNegative(row.txCostSol, event.txCostSol);
    row.crew = subtractNonNegative(row.crew, event.crew);
    for (const ingredient of event.ingredients || []) {
      row.ingredients = subtractIngredient(row.ingredients, text(ingredient.input), ingredient.amount);
    }
  }
  const result = Array.from(byKey.values()).filter((row) => Number(row.crafted) > 0 || Number(row.feeAmount) > 0
    || Number(row.txCostSol) > 0 || Number(row.crew) > 0 || (row.ingredients || []).length > 0);
  result.ledgerEvents = events.filter((event) => !mirroredIds.has(text(event.craftingId)));
  result.mirroredUpgradeCraftingIds = Array.from(mirroredIds).filter(Boolean).sort();
  return result;
}

module.exports = { DEFAULT_START_TOLERANCE_MS, removeUpgradeMirroredCraftingEvents };
