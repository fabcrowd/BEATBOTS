// core/jigAddress.js — deterministic shipping address line 1 variation (Target + Walmart).
// Loaded before content.js / walmart-content.js via manifest.

(function (root) {
  'use strict';

  var SUFFIX_TABLE = ['St', 'St.', 'Str', 'Strt', 'Stet', 'Street', 'Str.', 'Ste'];
  var UNIT_TABLE = ['', 'Apt', 'Unit', 'Suite', '#', 'Ste'];

  /**
   * Strip common trailing street-type suffixes so we can append a rotated spelling.
   * @param {string} line
   * @returns {string}
   */
  function stripTrailingStreetSuffix(line) {
    return String(line || '').replace(
      /\s+(St\.?|Street|Str\.?|Strt|Str|Stet|Ste)\s*$/i,
      ''
    ).trim();
  }

  /**
   * @param {string} baseAddress1  User's street line (e.g. "123 Sesame Street")
   * @param {number} jigIndex      0 = no jig (optional legacy prefix still applies)
   * @param {string} [legacyPrefix]  Deprecated: old shippingJig prefix; used only when jigIndex is 0
   * @returns {string}
   */
  function jigAddressLine1(baseAddress1, jigIndex, legacyPrefix) {
    var base = String(baseAddress1 || '').trim();
    var idx = Number(jigIndex);
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (idx > 99) idx = 99;

    if (idx === 0) {
      var pre = String(legacyPrefix || '').trim();
      return pre && base ? pre + ' ' + base : base;
    }

    var core = stripTrailingStreetSuffix(base) || base;
    var suf = SUFFIX_TABLE[idx % SUFFIX_TABLE.length];
    var unitType = UNIT_TABLE[idx % UNIT_TABLE.length];
    var letter = String.fromCharCode(65 + (idx % 26));
    var num = (idx % 9) + 1;
    var out = core + ' ' + suf;
    if (unitType) out += ' ' + unitType + ' ' + letter + String(num);
    return out.trim();
  }

  root.jigAddressLine1 = jigAddressLine1;
})(typeof self !== 'undefined' ? self : this);
