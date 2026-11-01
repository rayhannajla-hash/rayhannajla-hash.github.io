/* File Compare engine — header matching + row comparison.
   Pure functions, no DOM. Usable in browser (window.FCEngine) and node. */
(function (root) {
  'use strict';

  /* ---------- text utils ---------- */

  var SYNONYMS = [
    ['first', 'fname', 'firstname', 'given', 'forename'],
    ['last', 'lname', 'lastname', 'surname', 'family'],
    ['middle', 'mname', 'middlename'],
    ['name', 'nm', 'fullname', 'title'],
    ['id', 'identifier', 'key', 'code', 'no', 'num', 'number', 'ref', 'reference'],
    ['email', 'mail', 'emailaddress', 'eaddr', 'emailid'],
    ['phone', 'tel', 'telephone', 'mobile', 'cell', 'msisdn', 'contact',
     'phonenumber', 'mobilephone', 'mobilenumber', 'telephonenumber', 'contactnumber', 'cellphone'],
    ['address', 'addr', 'street'],
    ['city', 'town', 'municipality'],
    ['state', 'province', 'stateprovince'],
    ['zip', 'zipcode', 'postal', 'postcode', 'postalcode', 'postcodezip'],
    ['country', 'nation'],
    ['dob', 'birthdate', 'birthday', 'dateofbirth', 'birthdt', 'dateborn'],
    ['date', 'dt', 'day'],
    ['qty', 'quantity', 'count', 'units', 'noofunits'],
    ['amount', 'amt', 'value', 'total', 'sum', 'totalamount', 'totalamt', 'grandtotal'],
    ['price', 'cost', 'rate', 'unitprice'],
    ['status', 'state', 'stat', 'flag'],
    ['created', 'createdon', 'createdat', 'creation', 'opened'],
    ['updated', 'updatedon', 'updatedat', 'modified', 'lastmodified'],
    ['company', 'org', 'organisation', 'organization', 'employer', 'business', 'account'],
    ['desc', 'description', 'notes', 'note', 'remarks', 'comment', 'comments'],
    ['active', 'enabled', 'isactive'],
    ['gender', 'sex'],
    ['customer', 'client', 'cust'],
    ['product', 'item', 'sku', 'prod'],
    ['invoice', 'inv', 'bill'],
    ['currency', 'curr', 'ccy'],
    ['percent', 'pct', 'percentage'],
    ['category', 'cat', 'type', 'kind', 'class'],
    ['region', 'territory', 'area', 'zone'],
    ['salary', 'wage', 'pay', 'compensation'],
    ['department', 'dept', 'div', 'division'],
    ['start', 'begin', 'from'],
    ['end', 'finish', 'to', 'until'],
    ['legacy', 'old', 'source', 'src'],
    ['target', 'new', 'dest', 'destination', 'tgt']
  ];

  var CANON = (function () {
    var m = {};
    SYNONYMS.forEach(function (group) {
      group.forEach(function (w) { if (!(w in m)) m[w] = group[0]; });
    });
    return m;
  })();

  var NOISE = { 'the': 1, 'a': 1, 'of': 1, 'and': 1, 'col': 1, 'column': 1, 'field': 1, 'f': 1 };

  function squash(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  /* a whole header can itself be a known phrase: "Date of Birth" -> dob */
  function wholeCanon(header) {
    var sq = squash(header);
    return sq && CANON[sq] ? CANON[sq] : null;
  }

  function tokenize(header) {
    var whole = wholeCanon(header);
    if (whole) return [whole];
    var s = String(header == null ? '' : header);
    s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');            // camelCase -> camel Case
    s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');          // HTTPServer -> HTTP Server
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!s) return [];
    var raw = s.split(/\s+/);
    var out = [];
    raw.forEach(function (t) {
      if (NOISE[t]) return;
      out.push(CANON[t] || t);
    });
    return out.length ? out : raw;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1), cur = new Array(b.length + 1), i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  function levRatio(a, b) {
    if (!a && !b) return 1;
    var max = Math.max(a.length, b.length);
    if (!max) return 1;
    return 1 - levenshtein(a, b) / max;
  }

  function jaccard(aTokens, bTokens) {
    if (!aTokens.length || !bTokens.length) return 0;
    var setA = {}, setB = {}, inter = 0, union = 0, k;
    aTokens.forEach(function (t) { setA[t] = 1; });
    bTokens.forEach(function (t) { setB[t] = 1; });
    for (k in setA) { union++; if (setB[k]) inter++; }
    for (k in setB) { if (!setA[k]) union++; }
    return union ? inter / union : 0;
  }

  /* ---------- header similarity ---------- */

  function scoreHeaderPair(a, b) {
    var sa = squash(a), sb = squash(b);
    if (!sa && !sb) return { score: 0, reason: 'both headers blank' };
    if (sa === sb) return { score: 1, reason: 'exact header match' };

    var wa = wholeCanon(a), wb = wholeCanon(b);
    if (wa && wb && wa === wb) return { score: 0.97, reason: 'known equivalent names' };

    var ta = tokenize(a), tb = tokenize(b);
    var ja = ta.join(''), jb = tb.join('');
    if (ja && ja === jb) return { score: 0.97, reason: 'same words, different formatting' };

    var jac = jaccard(ta, tb);
    var lev = levRatio(sa, sb);
    var canonLev = levRatio(ja, jb);

    // containment: "name" vs "customer name"
    var contain = 0;
    if (ja && jb) {
      if (ja.indexOf(jb) >= 0 || jb.indexOf(ja) >= 0) {
        contain = Math.min(ja.length, jb.length) / Math.max(ja.length, jb.length);
      }
    }

    var score = Math.max(jac * 0.94, lev * 0.88, canonLev * 0.9, contain * 0.86);
    var reason;
    if (score === jac * 0.94) reason = 'shared words (' + Math.round(jac * 100) + '% overlap)';
    else if (score === contain * 0.86) reason = 'one name contains the other';
    else reason = 'similar spelling (' + Math.round(Math.max(lev, canonLev) * 100) + '%)';
    return { score: Math.min(score, 0.95), reason: reason };
  }

  /* ---------- value profiling ---------- */

  var RE = {
    email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
    phone: /^[+()\-.\s0-9]{7,}$/,
    number: /^-?\$?\s?-?[0-9][0-9,]*(\.[0-9]+)?%?$/,
    date: /^(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})(\s.*)?$/,
    bool: /^(true|false|yes|no|y|n|0|1|active|inactive)$/i
  };

  function sampleValues(rows, header, limit) {
    var out = [], i, v;
    limit = limit || 300;
    for (i = 0; i < rows.length && out.length < limit; i++) {
      v = rows[i] ? rows[i][header] : undefined;
      if (v === undefined || v === null) continue;
      v = String(v).trim();
      if (v !== '') out.push(v);
    }
    return out;
  }

  function profileColumn(values) {
    var n = values.length;
    if (!n) return { type: 'empty', unique: 0, n: 0 };
    var hit = { email: 0, phone: 0, number: 0, date: 0, bool: 0 };
    var seen = {}, uniq = 0, lenSum = 0;
    values.forEach(function (v) {
      if (!seen[v]) { seen[v] = 1; uniq++; }
      lenSum += v.length;
      if (RE.email.test(v)) hit.email++;
      if (RE.bool.test(v)) hit.bool++;
      else if (RE.date.test(v) && !RE.number.test(v)) hit.date++;
      else if (RE.number.test(v)) hit.number++;
      if (RE.phone.test(v) && /\d{7,}/.test(v.replace(/\D/g, ''))) hit.phone++;
    });
    var type = 'text', best = 0;
    ['email', 'bool', 'date', 'number', 'phone'].forEach(function (t) {
      if (hit[t] / n > 0.8 && hit[t] > best) { best = hit[t]; type = t; }
    });
    return { type: type, unique: uniq / n, n: n, avgLen: lenSum / n };
  }

  function valueOverlap(aVals, bVals) {
    if (!aVals.length || !bVals.length) return 0;
    var setB = {}, inter = 0, seenA = {}, countA = 0;
    bVals.forEach(function (v) { setB[squash(v) || v.toLowerCase()] = 1; });
    aVals.forEach(function (v) {
      var k = squash(v) || v.toLowerCase();
      if (seenA[k]) return;
      seenA[k] = 1; countA++;
      if (setB[k]) inter++;
    });
    return countA ? inter / countA : 0;
  }

  function scoreColumnPair(aHeader, aVals, bHeader, bVals) {
    var h = scoreHeaderPair(aHeader, bHeader);
    if (h.score >= 1) return { score: 1, reason: h.reason, header: h.score, data: null };

    var pa = profileColumn(aVals), pb = profileColumn(bVals);
    var dataScore = null, bits = [];

    if (pa.type !== 'empty' && pb.type !== 'empty') {
      var ov = valueOverlap(aVals, bVals);
      var typeMatch = pa.type === pb.type ? 1 : 0;
      dataScore = ov * 0.8 + typeMatch * 0.2;
      if (ov > 0.5) bits.push(Math.round(ov * 100) + '% of values also appear there');
      else if (typeMatch && pa.type !== 'text') bits.push('both look like ' + pa.type);
    }

    var score = h.score;
    if (dataScore !== null) {
      score = h.score * 0.65 + dataScore * 0.35;
      // strong data evidence should rescue a weak header match
      if (dataScore > 0.7) score = Math.max(score, 0.62 + dataScore * 0.3);
      score = Math.min(score, 0.96);
    }

    var reason = h.reason;
    if (bits.length) reason += ' + ' + bits.join(', ');
    return { score: score, reason: reason, header: h.score, data: dataScore };
  }

  /* ---------- mapping file (File C) ---------- */

  function parseMappingFile(headers, rows) {
    if (!headers || headers.length < 2 || !rows || !rows.length) return [];
    var srcCol = null, tgtCol = null;
    headers.forEach(function (hRaw) {
      var t = tokenize(hRaw).join(' ');
      if (srcCol === null && /\b(legacy|source)\b/.test(t)) srcCol = hRaw;
      if (tgtCol === null && /\b(target)\b/.test(t)) tgtCol = hRaw;
    });
    if (srcCol === null || tgtCol === null || srcCol === tgtCol) {
      srcCol = headers[0]; tgtCol = headers[1];
    }
    var pairs = [];
    rows.forEach(function (r) {
      var a = r[srcCol], b = r[tgtCol];
      if (a == null || b == null) return;
      a = String(a).trim(); b = String(b).trim();
      if (a && b) pairs.push({ a: a, b: b });
    });
    return pairs;
  }

  /* ---------- auto mapping ---------- */

  function autoMap(aHeaders, aRows, bHeaders, bRows, mappingPairs, threshold) {
    threshold = threshold == null ? 0.45 : threshold;
    var aSamples = {}, bSamples = {};
    aHeaders.forEach(function (h) { aSamples[h] = sampleValues(aRows, h); });
    bHeaders.forEach(function (h) { bSamples[h] = sampleValues(bRows, h); });

    var result = {}, usedB = {};
    aHeaders.forEach(function (h) { result[h] = { a: h, b: null, score: 0, reason: 'no match found', source: 'none' }; });

    // 1) explicit mapping file wins
    (mappingPairs || []).forEach(function (p) {
      var ah = findHeader(aHeaders, p.a), bh = findHeader(bHeaders, p.b);
      if (ah && bh && !usedB[bh]) {
        result[ah] = { a: ah, b: bh, score: 1, reason: 'from mapping file', source: 'file' };
        usedB[bh] = 1;
      }
    });

    // 2) score every remaining pair, assign greedily best-first (one-to-one)
    var cands = [];
    aHeaders.forEach(function (ah) {
      if (result[ah].source === 'file') return;
      bHeaders.forEach(function (bh) {
        if (usedB[bh]) return;
        var s = scoreColumnPair(ah, aSamples[ah], bh, bSamples[bh]);
        if (s.score >= threshold) cands.push({ a: ah, b: bh, score: s.score, reason: s.reason });
      });
    });
    cands.sort(function (x, y) { return y.score - x.score; });
    cands.forEach(function (c) {
      if (usedB[c.b]) return;
      if (result[c.a].source !== 'none') return;
      result[c.a] = { a: c.a, b: c.b, score: c.score, reason: c.reason, source: 'auto' };
      usedB[c.b] = 1;
    });

    var list = aHeaders.map(function (h) { return result[h]; });
    var unmatchedB = bHeaders.filter(function (h) { return !usedB[h]; });
    return { mapping: list, unmatchedTargetColumns: unmatchedB };
  }

  function findHeader(headers, name) {
    var want = squash(name), i;
    for (i = 0; i < headers.length; i++) if (squash(headers[i]) === want) return headers[i];
    for (i = 0; i < headers.length; i++) if (tokenize(headers[i]).join('') === tokenize(name).join('')) return headers[i];
    return null;
  }

  /* ---------- value comparison ---------- */

  function numify(v) {
    var s = String(v).trim().replace(/[$,\s]/g, '');
    var pct = /%$/.test(s);
    if (pct) s = s.slice(0, -1);
    if (s === '' || !/^-?[0-9]*\.?[0-9]+$/.test(s)) return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : (pct ? n / 100 : n);
  }

  /* dayFirst=false (default) reads 03/05/2024 as 5 March; true reads it as 3 May.
     ISO (2024-03-05) is unambiguous and always read year-first. */
  function dateify(v, dayFirst) {
    var s = String(v).trim();
    var m = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/);
    if (!m) return null;
    var a = +m[1], b = +m[2], c = +m[3], y, mo, d;
    if (a > 31) { y = a; mo = b; d = c; }
    else if (dayFirst) { d = a; mo = b; y = c; }
    else { mo = a; d = b; y = c; }
    if (y < 100) y += y < 50 ? 2000 : 1900;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return y * 10000 + mo * 100 + d;
  }

  function valuesEqual(x, y, opts) {
    opts = opts || {};
    var sx = x == null ? '' : String(x).trim();
    var sy = y == null ? '' : String(y).trim();
    if (sx === '' && sy === '') return true;
    if (sx === sy) return true;
    if (opts.ignoreCase !== false && sx.toLowerCase() === sy.toLowerCase()) return true;
    if (opts.trimInner !== false && sx.replace(/\s+/g, ' ').toLowerCase() === sy.replace(/\s+/g, ' ').toLowerCase()) return true;
    var nx = numify(sx), ny = numify(sy);
    if (nx !== null && ny !== null) {
      var tol = opts.tolerance || 0;
      return Math.abs(nx - ny) <= tol;
    }
    var dx = dateify(sx, opts.dayFirst), dy = dateify(sy, opts.dayFirst);
    if (dx !== null && dy !== null) return dx === dy;
    return false;
  }

  /* ---------- row comparison ---------- */

  function displayKey(row, cols) {
    return cols.map(function (c) {
      var v = row ? row[c] : '';
      return (v == null ? '' : String(v).trim());
    }).join(' | ');
  }

  function buildKey(row, cols) {
    return cols.map(function (c) {
      var v = row ? row[c] : '';
      return (v == null ? '' : String(v).trim().toLowerCase());
    }).join(' ␟ ');
  }

  function indexRows(rows, cols) {
    var map = {}, dupes = 0;
    rows.forEach(function (r, i) {
      var k = buildKey(r, cols);
      if (map[k]) { dupes++; map[k].extra.push(i); }
      else map[k] = { row: r, i: i, extra: [] };
    });
    return { map: map, dupes: dupes };
  }

  /* mapping: [{a,b}], keyColsA / keyColsB: arrays of header names */
  function compare(a, b, mapping, keyColsA, keyColsB, opts) {
    opts = opts || {};
    var pairs = mapping.filter(function (m) { return m.b; });
    var ia = indexRows(a.rows, keyColsA);
    var ib = indexRows(b.rows, keyColsB);

    var rows = [], stats = {
      matchedKeys: 0, missingInTarget: 0, onlyInTarget: 0,
      rowsWithMismatch: 0, cellsCompared: 0, cellsMismatched: 0,
      duplicateKeysA: ia.dupes, duplicateKeysB: ib.dupes,
      perColumn: {}
    };
    pairs.forEach(function (p) { stats.perColumn[p.a] = { target: p.b, mismatched: 0, compared: 0 }; });

    Object.keys(ia.map).forEach(function (k) {
      var ra = ia.map[k].row;
      var hit = ib.map[k];
      if (!hit) {
        stats.missingInTarget++;
        rows.push({ key: k, keyDisplay: displayKey(ra, keyColsA), status: 'missing-in-target', cells: pairs.map(function (p) {
          return { col: p.a, target: p.b, a: pick(ra, p.a), b: '', match: false };
        }) });
        return;
      }
      var rb = hit.row, mism = 0;
      var cells = pairs.map(function (p) {
        var va = pick(ra, p.a), vb = pick(rb, p.b);
        var eq = valuesEqual(va, vb, opts);
        stats.cellsCompared++;
        stats.perColumn[p.a].compared++;
        if (!eq) { mism++; stats.cellsMismatched++; stats.perColumn[p.a].mismatched++; }
        return { col: p.a, target: p.b, a: va, b: vb, match: eq };
      });
      stats.matchedKeys++;
      if (mism > 0) stats.rowsWithMismatch++;
      rows.push({ key: k, keyDisplay: displayKey(ra, keyColsA), status: mism ? 'mismatch' : 'match', mismatchCount: mism, cells: cells });
    });

    Object.keys(ib.map).forEach(function (k) {
      if (ia.map[k]) return;
      var rb = ib.map[k].row;
      stats.onlyInTarget++;
      rows.push({ key: k, keyDisplay: displayKey(rb, keyColsB), status: 'only-in-target', cells: pairs.map(function (p) {
        return { col: p.a, target: p.b, a: '', b: pick(rb, p.b), match: false };
      }) });
    });

    var order = { 'mismatch': 0, 'missing-in-target': 1, 'only-in-target': 2, 'match': 3 };
    rows.sort(function (x, y) {
      var d = order[x.status] - order[y.status];
      return d !== 0 ? d : (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
    });

    return { rows: rows, stats: stats, pairs: pairs };
  }

  function pick(row, col) {
    var v = row ? row[col] : '';
    return v == null ? '' : v;
  }

  root.FCEngine = {
    squash: squash,
    wholeCanon: wholeCanon,
    dateify: dateify,
    tokenize: tokenize,
    levRatio: levRatio,
    scoreHeaderPair: scoreHeaderPair,
    profileColumn: profileColumn,
    valueOverlap: valueOverlap,
    scoreColumnPair: scoreColumnPair,
    parseMappingFile: parseMappingFile,
    autoMap: autoMap,
    valuesEqual: valuesEqual,
    buildKey: buildKey,
    displayKey: displayKey,
    compare: compare,
    sampleValues: sampleValues
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
