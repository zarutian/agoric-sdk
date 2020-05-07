import { assert, details } from '@agoric/assert';

function extractByBrand(allocations) {
  const amountByBrand = new Map();

  function appendAmountByBrand(amount) {
    if (!amount) {
      return;
    }
    const { brand } = amount;
    const cur = amountByBrand.get(brand);
    if (cur) {
      cur.push(amount);
    } else {
      amountByBrand.set(brand, [amount]);
    }
  }

  for (let i = 0; i < allocations.length; i += 1) {
    const allocation = allocations[i];
    Object.getOwnPropertyNames(allocation).forEach(keyword =>
      appendAmountByBrand(allocation[keyword]),
    );
  }
  return amountByBrand;
}

/**
 * `areRightsConserved` checks that the total amount per issuer stays
 * the same regardless of the reallocation.
 * @param  {amountKeywordRecord[]} prevAllocations - An array of
 * amountKeywordRecords - objects with keyword keys and amount values, with one
 * keywordRecord per offerHandle.
 * @param  {amountKeywordRecord[]} newAllocations - An array of
 * amountKeywordRecords - objects with keyword keys and amount values, with one
 * keywordRecord per offerHandle.
 * @param  {function} getAmountMath - a function that takes a brand and returns
 * the appropriate amountMath
 */
function areRightsConserved(prevAllocations, newAllocations, getAmountMath) {
  const prevAmountsByBrand = extractByBrand(prevAllocations);
  const newAmountsByBrand = extractByBrand(newAllocations);
  // We assert the sizes are the same and will later enumerate one and expect
  // everything in it to be in the other.
  assert(
    prevAmountsByBrand.size === newAmountsByBrand.size,
    details`new allocation must have same keys as current`,
  );

  for (const key of prevAmountsByBrand.keys()) {
    if (prevAmountsByBrand.get(key).length === 0) {
      return true;
    }
    const amountMath = getAmountMath(prevAmountsByBrand.get(key)[0].brand);
    const sumRows = rows => rows.reduce(amountMath.add, amountMath.getEmpty());
    const prevTotal = sumRows(prevAmountsByBrand.get(key));
    const newTotal = sumRows(newAmountsByBrand.get(key));
    if (!amountMath.isEqual(prevTotal, newTotal)) {
      return false;
    }
  }
  return true;
}

export { areRightsConserved };
