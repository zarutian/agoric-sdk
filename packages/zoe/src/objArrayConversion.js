import { assert, details, q } from '@agoric/assert';

export const arrayToObj = (array, keywords) => {
  assert(
    array.length === keywords.length,
    details`array and keywords must be of equal length`,
  );
  const obj = {};
  keywords.forEach((keyword, i) => (obj[keyword] = array[i]));
  return obj;
};

export const objToArray = (obj, keywords) => {
  const keys = Object.getOwnPropertyNames(obj);
  assert(
    keys.length === keywords.length,
    details`object keys ${q(keys)} and keywords ${q(
      keywords,
    )} must be of equal length`,
  );
  return keywords.map(keyword => obj[keyword]);
};

export const assertSubset = (whole, part) => {
  part.forEach(key => {
    assert.typeof(key, 'string');
    assert(
      whole.includes(key),
      details`key ${q(key)} was not one of the expected keys ${q(whole)}`,
    );
  });
};

/**
 * Return a new object with only the keys in subsetKeywords.
 * `obj` must have values for all the `subsetKeywords`.
 * @param {Object} obj
 * @param {import('./zoe').Keyword[]} subsetKeywords
 */
export const filterObj = (obj, subsetKeywords) => {
  const newObj = {};
  subsetKeywords.forEach(keyword => {
    assert(
      obj[keyword] !== undefined,
      details`obj[keyword] must be defined for keyword ${q(keyword)}`,
    );
    newObj[keyword] = obj[keyword];
  });
  return newObj;
};

/**
 * Return a new object with only the keys in `amountMathKeywordRecord`, but fill
 * in empty amounts for any key that is undefined in the original allocation
 * @param {import('./zoe').Allocation} allocation
 * @param {import('./zoe').AmountMathKeywordRecord} amountMathKeywordRecord
 * @returns Allocation
 * */
export const filterFillAmounts = (allocation, amountMathKeywordRecord) => {
  const filledAllocation = {};
  const subsetKeywords = Object.getOwnPropertyNames(amountMathKeywordRecord);
  subsetKeywords.forEach(keyword => {
    if (allocation[keyword] === undefined) {
      filledAllocation[keyword] = amountMathKeywordRecord[keyword].getEmpty();
    } else {
      filledAllocation[keyword] = allocation[keyword];
    }
  });
  return filledAllocation;
};
