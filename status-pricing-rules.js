/* AISEL product-status pricing, v1.
 * Browser: window.AiselStatusPricing; Node: require('./status-pricing-rules.js').
 * derivePrice(code, workorder) returns only {salePrice, priceState, ruleVersion}.
 * isPriceAllowed(code, workorder, price) validates a frozen/confirmed sale price
 * without selecting a new price. Neither API reveals manufacturing costs.
 * parseNumber(value) returns a nonnegative finite number or null for empty or
 * invalid input. RULE_VERSION and ruleVersion both expose the rule version.
 * Input fields: pumMyeong, cat, lines[{nm, unit, qty}], gongim, siyage,
 * targetThreshold, priceConfirmed, priceSource. Inputs are never mutated.
 * Completed-product snapshots and status changes are handled by the caller.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AiselStatusPricing = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RULE_VERSION = 1;
  // Observed AISEL prices, with the owner's 59,000-won minimum for tops.
  var TOP_STEPS = [59000, 64000, 66000, 69000, 74000, 79000, 84000, 89000, 94000, 98000];
  var BOTTOM_STEPS = [59000, 64000, 69000, 74000, 79000, 84000, 89000, 94000, 98000];
  var COMFORT_STEPS = [59900, 62900, 64900, 65900, 67900, 69900, 74000];

  function filled(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  function numeric(value) {
    if (!filled(value) || (typeof value !== 'number' && typeof value !== 'string')) return null;
    var raw = String(value).trim().replace(/[,\s₩원]/g, '');
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
    var result = Number(raw);
    return Number.isFinite(result) && result >= 0 ? result : null;
  }

  function manufacturingCost(source) {
    var lines = Array.isArray(source.lines) ? source.lines : [];
    if (!lines.length) return null;
    var main = lines.find(function (line) {
      return line && String(line.nm || '').indexOf('원단') !== -1;
    }) || lines[0];
    if (!main || !(numeric(main.unit) > 0) || !(numeric(main.qty) > 0)) return null;
    var gongim = numeric(source.gongim), siyage = numeric(source.siyage);
    // Explicit zero is a completed work-cost entry; an empty input is not.
    if (gongim === null || siyage === null) return null;
    var total = gongim + siyage;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || typeof line !== 'object') continue;
      if (!filled(line.unit) && !filled(line.qty)) continue;
      var unit = numeric(line.unit);
      var quantity = filled(line.qty) ? numeric(line.qty) : 1;
      if (unit === null || quantity === null) return null;
      total += Math.round(unit * quantity);
    }
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  function comfortBase(name) {
    if (/플로/.test(name) && /코듀로이/.test(name)) return 69900;
    if (/리안/.test(name) && /플리츠/.test(name)) return 74000;
    if (/라인/.test(name) && /카프리/.test(name)) return 67900;
    if (/르(?:와이드|플레어)/.test(name)) return 64900;
    if (/(?:미아|로렌)/.test(name) && /(?:데님|컴포트)/.test(name)) return 62900;
    if (/라인/.test(name) && /(?:와이드|부츠컷|스트레이트)/.test(name)) return 62900;
    return 59900;
  }

  function knownComfortFamily(name) {
    return /(?:플로.*코듀로이|리안.*플리츠|라인.*(?:카프리|와이드|부츠컷|스트레이트)|르(?:와이드|플레어)|(?:미아|로렌).*(?:데님|컴포트)|(?:아네트|엘렌|페브).*(?:팬츠|트라우저))/.test(name);
  }

  function categoryFor(code, source) {
    var name = String(source.pumMyeong || '').replace(/\s+/g, '');
    var topName = /(?:티셔츠|블라우스|셔츠|니트탑|타이니트|스웨터|가디건|니트|탑)/.test(name);
    // Product names override legacy codes that have been reused for accessories
    // or sets. A scarf-detail shirt remains a top; a standalone scarf does not.
    if (/(?:셋업|세트|자켓|재킷|코트|원피스|드레스)/.test(name)) return null;
    if (/(?:스카프|머플러|벨트|모자|가방|브로치)/.test(name) && !/(?:티셔츠|블라우스|셔츠|탑|스웨터|가디건|팬츠|스커트|슬랙스|트라우저)/.test(name)) return null;
    if (/컴포트/.test(name) || knownComfortFamily(name)) return {base: comfortBase(name), steps: COMFORT_STEPS};
    if (/(?:스커트|팬츠|슬랙스|트라우저|데님)/.test(name)) return {base: 59000, steps: BOTTOM_STEPS};
    if (topName) return {base: 59000, steps: TOP_STEPS};

    var category = String(source.cat || '').trim().toUpperCase();
    if (!category) {
      var match = String(code || '').toUpperCase().match(/(?:^|-)(WSK|OPS|SET|BL|SH|HT|LT|KT|KN|CD|OP|SK|PT|CP|DN|JK|CT|VT)(?:-|$)/);
      category = match ? match[1] : '';
    }
    if (/^(?:BL|SH|HT|LT|KT|KN|CD|OPS)$/.test(category)) return {base: 59000, steps: TOP_STEPS};
    if (/^(?:WSK|PT|DN)$/.test(category)) return {base: 59000, steps: BOTTOM_STEPS};
    if (/^(?:CP|SK)$/.test(category)) return {base: comfortBase(name), steps: COMFORT_STEPS};
    return null;
  }

  function allowed(price, cost, category) {
    return price !== null && Number.isInteger(price) && price > cost * 4 && price >= (category ? category.base : 0);
  }

  function isPriceAllowed(code, source, price) {
    source = source && typeof source === 'object' ? source : {};
    var cost = manufacturingCost(source);
    return cost !== null && allowed(numeric(price), cost, categoryFor(code, source));
  }

  function result(salePrice, priceState) {
    return {salePrice: salePrice, priceState: priceState, ruleVersion: RULE_VERSION};
  }

  function derivePrice(code, source) {
    source = source && typeof source === 'object' ? source : {};
    var cost = manufacturingCost(source);
    if (cost === null) return result(null, 'cost_missing');
    var category = categoryFor(code, source);
    var current = numeric(source.targetThreshold);
    if (source.priceConfirmed === true && source.priceSource === 'manual' && allowed(current, cost, category)) {
      return result(current, 'ready');
    }
    if (!category) return result(null, 'review');
    var candidate = category.steps.find(function (price) { return allowed(price, cost, category); });
    return candidate === undefined ? result(null, 'review') : result(candidate, 'ready');
  }

  return Object.freeze({derivePrice: derivePrice, isPriceAllowed: isPriceAllowed, parseNumber: numeric, RULE_VERSION: RULE_VERSION, ruleVersion: RULE_VERSION});
}));

