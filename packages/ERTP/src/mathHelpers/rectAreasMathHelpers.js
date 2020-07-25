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
// -inline ends-
