// eslint-disable-next-line import/no-extraneous-dependencies
import { test } from 'tape-promise/tape';

import produceIssuer from '@agoric/ertp';
import { areRightsConserved } from '../../src/rightsConservation';

const setupAmountMaths = () => {
  const moolaIssuerResults = produceIssuer('moola');
  const simoleanIssuerResults = produceIssuer('simoleans');
  const bucksIssuerResults = produceIssuer('bucks');

  const all = [moolaIssuerResults, simoleanIssuerResults, bucksIssuerResults];
  return all.map(objs => objs.amountMath);
};

const makeAmountMatrix = (amountMathArray, extentMatrix) =>
  extentMatrix.map(row =>
    row.map((extent, i) => amountMathArray[i].make(extent)),
  );

function makeGetAmountMath(amountMaths) {
  const amountMathMap = new Map();
  amountMaths.forEach(a => amountMathMap.set(a.getBrand(), a));
  return brand => amountMathMap.get(brand);
}

const applyLabelsToRows = (labelMatrix, valueMatrix) => {
  const resultMatrix = [];
  for (let r = 0; r < labelMatrix.length; r += 1) {
    const newRow = {};
    resultMatrix.push(newRow);
    for (let i = 0; i < labelMatrix[r].length; i += 1) {
      newRow[labelMatrix[r][i]] = valueMatrix[r][i];
    }
  }
  return resultMatrix;
};

// rights are conserved for amount with Nat extents
test(`areRightsConserved - true for amount with nat extents`, t => {
  t.plan(1);
  try {
    const amountMaths = setupAmountMaths();
    const oldExtents = [
      [0, 1, 0],
      [4, 1, 0],
      [6, 3, 0],
    ];
    const newExtents = [
      [1, 2, 0],
      [3, 1, 0],
      [6, 2, 0],
    ];
    const keysMatrix = [
      ['A', 'B', 'C'],
      ['You', 'Ewe', 'Yew'],
      ['Too', 'To', 'Two'],
    ];

    const oldAmounts = makeAmountMatrix(amountMaths, oldExtents);
    const newAmounts = makeAmountMatrix(amountMaths, newExtents);
    const oldOfferMap = applyLabelsToRows(keysMatrix, oldAmounts);
    const newOfferMap = applyLabelsToRows(keysMatrix, newAmounts);

    const getAmountMath = makeGetAmountMath(amountMaths);
    t.ok(areRightsConserved(oldOfferMap, newOfferMap, getAmountMath));
  } catch (e) {
    t.assert(false, e);
  }
});

// rights are *not* conserved for amount with Nat extents
test(`areRightsConserved - false for amount with Nat extents`, t => {
  t.plan(1);
  try {
    const amountMaths = setupAmountMaths();
    const oldExtents = [
      [0, 1, 4],
      [4, 1, 0],
      [6, 3, 0],
    ];
    const keysMatrix = [
      ['A', 'B', 'C'],
      ['You', 'Ewe', 'Yew'],
      ['Too', 'To', 'Two'],
    ];
    const newExtents = [
      [1, 2, 0],
      [3, 1, 0],
      [6, 2, 0],
    ];

    const oldAmounts = makeAmountMatrix(amountMaths, oldExtents);
    const newAmounts = makeAmountMatrix(amountMaths, newExtents);
    const oldOfferMap = applyLabelsToRows(keysMatrix, oldAmounts);
    const newOfferMap = applyLabelsToRows(keysMatrix, newAmounts);

    const getAmountMath = makeGetAmountMath(amountMaths);
    t.notOk(areRightsConserved(oldOfferMap, newOfferMap, getAmountMath));
  } catch (e) {
    t.assert(false, e);
  }
});

test(`areRightsConserved - empty arrays`, t => {
  t.plan(1);
  try {
    const amountMaths = setupAmountMaths();
    const oldAmounts = [[], [], []];
    const newAmounts = [[], [], []];
    const keysMatrix = [
      ['A', 'B', 'C'],
      ['You', 'Ewe', 'Yew'],
      ['Too', 'To', 'Two'],
    ];

    const oldOfferMap = applyLabelsToRows(keysMatrix, oldAmounts);
    const newOfferMap = applyLabelsToRows(keysMatrix, newAmounts);

    const getAmountMath = makeGetAmountMath(amountMaths);
    t.ok(areRightsConserved(oldOfferMap, newOfferMap, getAmountMath));
  } catch (e) {
    t.assert(false, e);
  }
});

test('areRightsConserved simple case', t => {
  t.plan(1);
  const amountMaths = setupAmountMaths();
  const oldExtents = [
    [0, 1, 0],
    [4, 1, 0],
    [6, 3, 0],
  ];
  const newExtents = [
    [1, 2, 0],
    [3, 1, 0],
    [6, 2, 0],
  ];
  const keysMatrix = [
    ['A', 'B', 'C'],
    ['A', 'C', 'B'],
    ['C', 'B', 'A'],
  ];

  // offerMap should look like this (1, 2 are handles):
  // { { A: moola(3), B: simoleans(4) },
  //   { C: simoleans(5), D: moola(8), E: bucks(12) } }
  const oldAmountMatrix = makeAmountMatrix(amountMaths, oldExtents);
  const newAmountMatrix = makeAmountMatrix(amountMaths, newExtents);
  const oldOfferMap = applyLabelsToRows(keysMatrix, oldAmountMatrix);
  const newOfferMap = applyLabelsToRows(keysMatrix, newAmountMatrix);

  const amountMathGetter = makeGetAmountMath(amountMaths);
  t.assert(
    areRightsConserved(oldOfferMap, newOfferMap, amountMathGetter),
    'Rights should be conserved',
  );
});

// TODO: add tests for non-Nat extents
