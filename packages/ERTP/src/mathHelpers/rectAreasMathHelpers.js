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
});
