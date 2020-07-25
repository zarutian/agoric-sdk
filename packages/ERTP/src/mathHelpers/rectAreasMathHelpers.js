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
const is__common = (a, b) => {
  const k = {};
  k.x1 = a.x;
  k.x2 = (a.x + a.w);
  k.y1 = a.y;
  k.y2 = (a.y + a.h);
  k.x3 = b.x;
  k.x4 = (b.x + b.w);
  k.y3 = b.y;
  k.y4 = (b.y + b.h);
  k.t1 = ((x3 <= x1) && (x1 < x4));
  k.t2 = ((y3 <= y1) && (y1 < y4));
  k.t3 = ((x3 <= x2) && (x2 < x4));
  k.t4 = ((y3 <= y2) && (y2 < y4));
  k.t5 = ((x1 <= x3) && (x3 < x2));
  k.t6 = ((y1 <= y3) && (y3 < y2));
  k.t7 = ((x1 <= x4) && (x4 < x2));
  k.t8 = ((y1 <= y4) && (y4 < y2));
  return k;
};
const isOverlap = (a, b) => {
  const k = is__common(a,b);
  return ((k.t1 && k.t2) || (k.t1 && k.t4) ||
          (k.t3 && k.t2) || (k.t3 && k.t4) ||
          (k.t5 && k.t6) || (k.t5 && k.t8) ||
          (k.t7 && k.t6) || (k.t7 && k.t8));
};
const isCompletelyInside = (insider, outsider) => {
  const k = is__common(insider, outsider);
  return (k.t1 && k.t2 && k.t3 && k.t4);
}
const subtract = (a, b) => {
  return harden(a.reduce((acc, atem) => {
    const intersects = b.filter((btem) => isOverlap(atem, btem));
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
    const a1 = { x: a_x1, y: a_y1, w: (b_x1 - a_x1), h: atem.h };
    const a2 = { x: b_x1, y: a_y1, w: btem.w, h: (b_y1 - a_y1) };
    const a3 = { x: b_x1, y: b_y2, w: btem.w, h: (a_y2 - b_y2) };
    const a4 = { x: b_x2, y: a_y1, w: (a_x2 - b_x2), h: atem.h };
    const args = [];
    if ((a1.w > 0) && (a1.h > 0)) { args.push(a1); }
    if ((a2.w > 0) && (a2.h > 0)) { args.push(a2); }
    if ((a3.w > 0) && (a3.h > 0)) { args.push(a3); }
    if ((a4.w > 0) && (a4.h > 0)) { args.push(a4); }
    if (args.length == 0) { return acc; }
    const res = subtract(args, intersects.slice(1));
    if (res.length > 0) {
      return acc.concat(res);
    } else {
      return acc;
    }
  }, []));
};
const rectHelper = harden({
  doCoerce: (extent) => rectGuard(extent, throwingEjector),
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
export default rectHelper;
