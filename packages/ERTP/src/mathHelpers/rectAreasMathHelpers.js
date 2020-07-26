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
const TupleOf = (template) => {
  return harden({
    coerce: (specimen, ejector) => {
      if (specimen.length != template.length) {
        ejector(new Error("given specimen wasnt of equal length as expected"))
      }
      return template.map((guard, i) => guard.coerce(specimen[i]));
    },
    toString: () => "«tuple guard of (".concat(template.map((guard) => guard.toString().concat(", ")),")»");
  });
}
const throwingEjector = (e) => { throw e; };
Open
Remove MathHelpers from public view
#1324
tyg opened this issue 4 days ago · 9 comments 
Assignees
 @tyg  @katelynsills
Labels
ERTP
enhancement
Projects
 ERTP
Comments
@tyg
 
tyg commented 4 days ago
As discussed on Keybase, there is no need for our users to know that amountMath methods are really having their work done by similarly named MathHelper methods, and we’re not using any of the MathHelpers in our examples. Thus, we can simplify our documentation and lessen how much developers need to read and know by removing all references to MathHelpers from the docs and our examples.

The one thing currently associated with MathHelpers that developers need to know is that they can be one of three kinds, depending on how the issuer specifies how amount values are represented. These are ‘nat’, the default, for natural numbers/fungible assets, ‘str’ for strings/non-fungible assets, and ‘strSet’ for more complex objects/non-fungible assets. Instead of associating a kind with MathHandlers, we will henceforth associate a kind with a brand’s amountMath object. In code, this will be referred to as amountMathKind; i.e. what kind of amountMath is implementing the common set of methods.

This will require the following changes in docs and example code and for consistency, preferably in internal code:

In public-facing code and docs, remove all mention of MathHelper methods.

Instead of “You have your choice of three MathHelpers”, replace it with “You have your choice of three kinds of amountMath, each of which polymorphically implements all the specified amountMath methods.” or similar. Note the use of “kinds” rather than “types” to avoid confusing with system/JS typing.

Move general explanation of the three kinds to AmountMath doc pages.

makeIssuerKit() and docs will refer to specifying an “amountMath kind argument” rather than
any mention of MathHelpers.

When possible, have the makeIssuerKit’s second, optional, parameter be referred to as “amountMathKind”

The name and docs of method “amountMath.getMathHelpersName()” is changed to “amountMath.getAmountMathKind()’

The name and docs of method "issuer.getMathHelperName()" is changed to "issuer.getAmountMathKind()"

 @tyg tyg added the enhancement  label 4 days ago
@tyg tyg assigned tyg and katelynsills 4 days ago
 @zarutian zarutian commented 3 days ago
I really should finish writing the "rectAreas" and "cubeVolumes" mathHelpers.
So, no, I recommend against removing MathHelpers from the documentation. But I am open to ideas on how to enable local reconstruction of amountMaths so that amount calculations can be done without doing eventual-sends.

  @tyg tyg commented 2 days ago
 Let's see if I correctly conveyed what I want to do (which was already
discussed on Keybase with no objections). I'm not saying get rid of the
MathHelper methods; they'll still be in the internal codebase, we can still
call them internally, etc.

But every one of them has an equivalent method at the amountMath level,
which can and is being used by developers instead of the MathHelper. The
only thing unique to MathHelpers is the nat, str, strSat, which can be
pushed up to the amountMath level.

So if you don't want MathHelper removed from the docs because you're
writing two new ones (and honestly, I'm not sure from the names you give
just what they'd do; the names read more like UI methods than financial
math type things), I have to ask

1) will these not have the same type of equivalent method at the amountMath
level as every existing MathHelper? If they will have amountMath
equivalents, then we can still remove MathHandlers in general from docs.

2) If you weren't planning to have such amountMath equivalents, is there
any reason why you can't add such that they just call the MathHandler
version and nothing else?

Thanks,
Tom
…
 @zarutian zarutian commented 2 days ago
"rectAreas" (not the final name but works for now) MathHelper deals with extents of the form of a list of non-overlapping spefic rectangular areas.
These kind of extents are usefull when dealing with Minecraft (sur)real estate. "cubeVolumes" is similar, just adds extra dimension.

I am mainly writing them for my own edification and amusement but they do demonstrate that the list of kinds of MathHelpers is non exhaustive. Therefor we should not limit the kinds of extents expressible in Agoric smart contracts.

  @tyg tyg commented 2 days ago
 Ah. Thanks for the explanation. I don't think I explained well what I want
to do and why though. It has nothing to do with limiting values (the new
name for extents, already implemented) in them, and it doesn't sound like
it'd be a problem to have an amountMath equivalent like all the existing
ones. Let's see what Kate has to say about it.

Tom
…
 @erights erights commented 2 days ago
Hi @tyg you are correct about how you should proceed. Agoric is not yet set up for users to extend the MathHelpers namespace, so there's no reason to document how to for normal users. @zarutian 's is a private experiment.

Hi @zarutian I very much look forward to seeing your MathHelpers. Virtual real estate remains my standard example of an eright which is divisible and recombinable but not fungible. We got a taste of this with the pixel demo, but without a compact rectangle-at-a-time representation.

 @katelynsills katelynsills commented 2 days ago
I agree with @erights! @zarutian that sounds like an incredibly valuable contribution that I'd love to be able to add to ERTP.

 @katelynsills katelynsills added the ERTP  label 2 days ago
@katelynsills katelynsills added this to Do This Week in ERTP 2 days ago
 @zarutian zarutian commented 11 hours ago
@erights: feast your eyes on https://github.com/zarutian/agoric-sdk/blob/rectAreas-MathHelper/packages/ERTP/src/mathHelpers/rectAreasMathHelpers.js

needs testing and probably quite a few explanation comments.

 @erights erights commented 11 hours ago
OMG did you implement the E guards/ejectors architecture? Cool!

 @zarutian
 
zarutian commented 1 hour ago
OMG did you implement the E guards/ejectors architecture? Cool!

Some of it. Though faking escapeExpr with

const escape_primitive = (block) => {
  const internalMarker = {};
  const ejector = (value) => { throw [internalMarker, value] };
  try { return [false, block(ejector)]; } catch (e) {
    if (!Array.isArray(e)) { throw e; }
    if (e[0] !== internalMarker) { throw e; }
    return [true, e[1]];
  }
}
const escape = (mainblock, catchblock) => {
  const [escapement, value] = escape_primitive(mainblock);
  if (escapement) { return catchblock(value); }
  return value;
}
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
const rectAreasMathHelpers = rectHelper;
export default rectAreasMathHelpers;
