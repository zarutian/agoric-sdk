// global harden
import nat from "@agoric/nat";
// -inlined from "@zarutian/ocaps/js/guards"-
// (dont relie on this module specifier, quick to link-rot)
const AnyGuard = harden({
  coerce: (specimen, ejector) => specimen,
  toString: () => "«the any guard»“
});
const NatGuard = harden({
  coerce: (specimen, ejector) => {
    try { return nat(specimen); } catch (e) { ejector(e); }
  },
  toString: () => "«the nat guard»"
});
const NumberGuard = harden({
  coerce: (specimen, ejector) => {
    if (Number.isSafeNumber(specimen) || ((typeof specimen) == "bigint") {
      // probably forgetting some of the predicates
      return specimen;
    } else {
      ejector(new Error("specimen must be a number"));
    }
  },
  toString: () => "«the number guard»"
});
const RecordOf = (template) => {
  const templateAsEntries = Object.entries(template);
  return harden({
    coerce: (specimen, ejector) => {
      if (Object.entries(specimen).length != templateAsEntries.length) {
        ejector(new Error("specimen does not have equal number of own properties as this guard expects"));
      }
      return harden(Object.fromEntries(templateAsEntries.map(([prop, guard]) => {
        return [prop, guard.coerce(specimen[prop], ejector)];
      })));
    },
    toString: () => {
      return "«record guard of {".concat(
        templateAsEntries.map(([prop, guard], i) => "\"".concat(prop, "\": ", guard.toString(), (i < templateAsEntries.length ? ", " : ""))), "}»");
    }
  }
};
const ArrayOf = (perItemGuard) => {
  return harden({
    coerce: (specimen, ejector) => {
      return Array.prototype.map.call(specimen, (item) => perItemGuard.coerce(item, ejector));
    },
    toString: () => {
      return "«array guard of ".concat(perItemGuard.toString(), "»");
    }
  });
};
const throwingEjector = (e) => { throw e; };
// -inline ends-
const rectGuard = ArrayOf(RecordOf({
  x: NumberGuard, y: NumberGuard, w: NatGuard, h: NatGuard
}));
const isInside = (a, b) => ((a.x >= b.x) && (a.y >= b.y) && (a.w <= b.w) && (a.h <= b.h));
const compare = (a, b) => (((a.y < b.y) || (a.x < b.x) || (a.w < b.w) || (a.h < b.h)) ? -1 : 1);
const isEqual = (a, b) => ((BigInt(a.x) == BigInt(b.x)) && (BigInt(a.y) == BigInt(b.y)) && (BigInt(a.w) == BigInt(b.w)) && (BigInt(a.h) == BigInt(b.h)));
const consolidate = (extent) => {
  var curr = (new Array(extent)).sort(compare);
  var prev = rectHelper.doGetEmpty();
  while (!rectHelper.isEqual(curr, prev)) {
    prev = curr;
    curr = curr.reduce((acc, b, idx) => {
      const a = acc[-1];
      if (a === undefined) { acc.push(b); return acc; }
      if (isEqual(a, b)) { return acc; }
      // do we have two rect of equal height abutting?
      if ((a.h == b.h) && (a.y == b.y) && ((a.x + a.w) == b.x)) {
        // combine them
        acc[-1] = { x: a.x, y: b.y, w: (a.w + b.w), h: a.h };
        return acc;
      }
      // do we have two rect of equal width abutting?
      if ((a.w == b.w) && (a.x == b.x) && ((a.y + a.h) == b.y)) {
        // combine them
        acc[-1] = { x: a.x, y: a.y, w: b.w, h: (a.h + b.h)};
        return acc;
      }
      acc.push(b); return acc;
    }, []).sort(compare);
  }
  return curr;
};
const subtract = (a, b) => {
  return harden(a.reduce((acc, atem) => {
    const intersects = b.filter((btem) => intersect(atem, btem));
    if (intersects.length == 0) { acc.push(atem); return acc; }
    if (intersects.reduce((covered, item) => (isInside(atem, item) ? true : covered), false)) {
      return acc;
    }
    const { x: a_x1, y: a_y1 } = atem;
    const a_x2 = a_x1 + atem.w;
    const a_y2 = a_y1 + atem.h;
    const btem = intersects[0];
    const { x: b_x1, y: b_y1 } = btem;
    const b_x2 = b_x1 + btem.w;
    const b_y2 = b_y1 + btem.h;
  }, []));
};
const rectHelper = harden({
  doAssertKind: (extent) => { rectGuard(extent, throwingEjector); },
  doGetEmpty: () => harden([{ x: 0, y: 0, w: 0, h: 0}]),
  doIsEmpty: (extent) => {
    rectHelper.doAssertKind(extent);
    return ((extent.length == 1) &&
            (BigInt(extent[0].x) == 0n) &&
            (BigInt(extent[0].y) == 0n) &&
            (BigInt(extent[0].w) == 0n) &&
            (BigInt(extent[0].h) == 0n));
  },
  doIsGTE: (l, r) => {
    rectHelper.doAssertKind(l);
    rectHelper.doAssertKind(r);
    return r.reduce((a, ir) => {
      return l.reduce((b, il) => (isInside(ir, il) ? true : b), false) ? a : false;
    }, true);
  },
  doIsEqual: (l, r) => ((rectHelper.doIsGTE(l, r) && rectHelper.doIsGTE(r, l))),
  doAdd: (l, r) => {
    rectHelper.doAssertKind(l);
    rectHelper.doAssertKind(r);
    return consolidate(l.concat(r));
  },
  doSubtract: (l, r) => {
    rectHelper.doAssertKind(l);
    rectHelper.doAssertKind(r);
    return consolidate(subtract(l,r));
  }
});
