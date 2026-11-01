/* AI File Compare — UI layer. Depends on XLSX (read), ExcelJS (write), FCEngine (logic). */
(function () {
  'use strict';
  var E = window.FCEngine;
  var MAX_RENDER = 400;

  var S = { files: {}, data: {}, mapping: [], mapPairs: [], pk: [], result: null, view: 'all' };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function msg(el, text, isErr) {
    el.innerHTML = text ? '<div class="note' + (isErr ? ' err' : '') + '">' + esc(text) + '</div>' : '';
  }

  /* ---------- reading spreadsheets ---------- */

  function dedupeHeaders(raw) {
    var seen = {}, out = [];
    raw.forEach(function (h, i) {
      var name = String(h == null ? '' : h).trim();
      if (!name) name = 'Column ' + (i + 1);
      if (seen[name]) { seen[name]++; name = name + ' (' + seen[name] + ')'; }
      else seen[name] = 1;
      out.push(name);
    });
    return out;
  }

  function parseWorkbook(buf) {
    var wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: false });
    var ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('that file has no readable sheet');
    var matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
    if (!matrix.length) throw new Error('that sheet is empty');
    var headers = dedupeHeaders(matrix[0]);
    var rows = [];
    for (var i = 1; i < matrix.length; i++) {
      var r = matrix[i], o = {}, any = false;
      for (var c = 0; c < headers.length; c++) {
        var v = r[c] == null ? '' : r[c];
        o[headers[c]] = v;
        if (String(v).trim() !== '') any = true;
      }
      if (any) rows.push(o);
    }
    return { headers: headers, rows: rows, sheet: wb.SheetNames[0], sheetCount: wb.SheetNames.length };
  }

  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        try { res(parseWorkbook(new Uint8Array(fr.result))); }
        catch (e) { rej(e); }
      };
      fr.onerror = function () { rej(new Error('could not read that file')); };
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------- step 1: upload ---------- */

  var ROLE = { a: 'File A — legacy', b: 'File B — target', c: 'File C — mapping (optional)' };

  function paintDrop(k) {
    var el = $('d-' + k), f = S.files[k], d = S.data[k];
    if (!f) {
      el.className = 'drop';
      el.querySelector('.role').nextElementSibling.outerHTML = '<div class="ph">Click or drop a file</div>';
      return;
    }
    el.className = 'drop filled';
    var meta = d ? fmt(d.rows.length) + ' rows · ' + d.headers.length + ' columns' +
      (d.sheetCount > 1 ? ' · sheet “' + d.sheet + '”' : '') : 'reading…';
    el.querySelector('.role').nextElementSibling.outerHTML =
      '<div class="fname">' + esc(f.name) + '</div><div class="meta">' + esc(meta) + '</div>';
  }

  function paintCounts() {
    var a = S.data.a, b = S.data.b, box = $('counts');
    if (!a || !b) { box.className = 'tiles hidden'; return; }
    var shared = a.headers.filter(function (h) {
      return b.headers.some(function (g) { return E.squash(g) === E.squash(h); });
    }).length;
    box.className = 'tiles';
    box.innerHTML = [
      ['Rows in A', fmt(a.rows.length), ''],
      ['Rows in B', fmt(b.rows.length), a.rows.length === b.rows.length ? 'good' : 'bad'],
      ['Row difference', (b.rows.length - a.rows.length > 0 ? '+' : '') + fmt(b.rows.length - a.rows.length),
        a.rows.length === b.rows.length ? 'good' : 'bad'],
      ['Columns in A', fmt(a.headers.length), ''],
      ['Columns in B', fmt(b.headers.length), ''],
      ['Identical header names', fmt(shared) + ' of ' + a.headers.length, '']
    ].map(function (t) {
      return '<div class="tile ' + t[2] + '"><div class="n">' + esc(t[1]) + '</div><div class="l">' + esc(t[0]) + '</div></div>';
    }).join('');
  }

  function refreshUpload() {
    paintCounts();
    $('go-map').disabled = !(S.data.a && S.data.b);
  }

  function takeFile(k, file) {
    S.files[k] = file; S.data[k] = null; paintDrop(k); msg($('up-msg'), '');
    readFile(file).then(function (d) {
      if (k === 'c') {
        S.mapPairs = E.parseMappingFile(d.headers, d.rows);
        if (!S.mapPairs.length) msg($('up-msg'), 'The mapping file was read but no source → target pairs were found in it. It needs two columns: the legacy name and the target name. Matching will fall back to automatic.', true);
      }
      S.data[k] = d; paintDrop(k); refreshUpload();
    }).catch(function (e) {
      delete S.files[k]; delete S.data[k]; paintDrop(k); refreshUpload();
      msg($('up-msg'), ROLE[k] + ': ' + e.message, true);
    });
  }

  ['a', 'b', 'c'].forEach(function (k) {
    var zone = $('d-' + k), input = zone.querySelector('input');
    input.addEventListener('change', function () { if (input.files[0]) takeFile(k, input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) takeFile(k, f);
    });
  });

  /* ---------- step 2: mapping ---------- */

  function conf(score) {
    if (!score) return ['b-none', 'no match'];
    if (score >= 0.9) return ['b-high', Math.round(score * 100) + '%'];
    if (score >= 0.65) return ['b-mid', Math.round(score * 100) + '%'];
    return ['b-low', Math.round(score * 100) + '%'];
  }

  function paintMapping() {
    var a = S.data.a, b = S.data.b;
    var out = E.autoMap(a.headers, a.rows, b.headers, b.rows, S.mapPairs);
    S.mapping = out.mapping;

    var opts = function (sel) {
      return '<option value="">— not compared —</option>' + b.headers.map(function (h) {
        return '<option value="' + esc(h) + '"' + (h === sel ? ' selected' : '') + '>' + esc(h) + '</option>';
      }).join('');
    };
    var html = '<div class="scroll" style="max-height:none"><table class="grid"><thead><tr>' +
      '<th style="width:24%">File A column</th><th style="width:26%">File B column</th>' +
      '<th style="width:12%">Confidence</th><th>Why</th></tr></thead><tbody>';
    S.mapping.forEach(function (m, i) {
      var c = conf(m.score);
      html += '<tr><td><strong>' + esc(m.a) + '</strong></td>' +
        '<td><select data-i="' + i + '" class="m-sel">' + opts(m.b) + '</select></td>' +
        '<td><span class="badge ' + c[0] + '">' + c[1] + '</span>' +
        (m.source === 'file' ? ' <span class="badge b-high">mapping file</span>' : '') + '</td>' +
        '<td class="why">' + esc(m.reason) + '</td></tr>';
    });
    html += '</tbody></table></div>';

    if (out.unmatchedTargetColumns.length) {
      html += '<div class="note">Columns in File B with nothing pointing at them: ' +
        out.unmatchedTargetColumns.map(function (h) { return '<code>' + esc(h) + '</code>'; }).join(', ') +
        '. Assign them above if they should be compared.</div>';
    }
    $('map-table').innerHTML = html;

    Array.prototype.forEach.call(document.querySelectorAll('.m-sel'), function (sel) {
      sel.addEventListener('change', function () {
        var i = +sel.getAttribute('data-i'), val = sel.value;
        if (val) {
          S.mapping.forEach(function (m, j) {
            if (j !== i && m.b === val) { m.b = null; m.score = 0; m.reason = 'freed up by a manual change'; m.source = 'none'; }
          });
        }
        S.mapping[i].b = val || null;
        S.mapping[i].score = val ? 1 : 0;
        S.mapping[i].reason = val ? 'set by hand' : 'excluded by hand';
        S.mapping[i].source = val ? 'manual' : 'none';
        paintMapping(); paintPK();
      });
    });
  }

  function paintPK() {
    var a = S.data.a;
    if (!S.pk.length && a.headers.length) S.pk = [a.headers[0]];
    $('pk-list').innerHTML = a.headers.map(function (h) {
      var on = S.pk.indexOf(h) >= 0;
      return '<label class="' + (on ? 'sel' : '') + '"><input type="checkbox" value="' + esc(h) + '"' +
        (on ? ' checked' : '') + (!on && S.pk.length >= 4 ? ' disabled' : '') + '> ' + esc(h) + '</label>';
    }).join('');

    Array.prototype.forEach.call($('pk-list').querySelectorAll('input'), function (cb) {
      cb.addEventListener('change', function () {
        var h = cb.value, i = S.pk.indexOf(h);
        if (cb.checked && i < 0) S.pk.push(h);
        else if (!cb.checked && i >= 0) S.pk.splice(i, 1);
        if (!S.pk.length) S.pk = [h];
        paintPK();
      });
    });

    var mapOf = {}; S.mapping.forEach(function (m) { mapOf[m.a] = m.b; });
    var bKeys = S.pk.map(function (h) { return mapOf[h]; });
    var missing = S.pk.filter(function (h) { return !mapOf[h]; });
    var out = 'Rows are paired on ' + S.pk.map(function (h) { return '<code>' + esc(h) + '</code>'; }).join(' + ') +
      ' in File A, matched against ' +
      bKeys.map(function (h) { return '<code>' + esc(h || '???') + '</code>'; }).join(' + ') + ' in File B.';
    if (missing.length) out += ' <strong>Those key columns need a File B column assigned above first.</strong>';
    $('pk-out').innerHTML = out;
    $('go-run').disabled = missing.length > 0;
  }

  /* ---------- step 3: compare ---------- */

  function options() {
    return {
      ignoreCase: $('o-case').checked,
      trimInner: $('o-space').checked,
      tolerance: parseFloat($('o-tol').value) || 0,
      dayFirst: $('o-date').value === '1'
    };
  }

  function run() {
    var mapOf = {}; S.mapping.forEach(function (m) { mapOf[m.a] = m.b; });
    var bKeys = S.pk.map(function (h) { return mapOf[h]; });
    if (bKeys.some(function (x) { return !x; })) return;
    try {
      S.result = E.compare(S.data.a, S.data.b, S.mapping, S.pk, bKeys, options());
    } catch (e) {
      msg($('map-msg'), 'Comparison failed: ' + e.message, true); return;
    }
    msg($('map-msg'), '');
    paintResult(); step(3);
  }

  function paintResult() {
    var st = S.result.stats;
    $('r-tiles').innerHTML = [
      ['Rows paired', fmt(st.matchedKeys), ''],
      ['Rows with a difference', fmt(st.rowsWithMismatch), st.rowsWithMismatch ? 'bad' : 'good'],
      ['Cells different', fmt(st.cellsMismatched) + ' / ' + fmt(st.cellsCompared), st.cellsMismatched ? 'bad' : 'good'],
      ['Missing in target', fmt(st.missingInTarget), st.missingInTarget ? 'bad' : 'good'],
      ['Only in target', fmt(st.onlyInTarget), st.onlyInTarget ? 'bad' : 'good'],
      ['Columns compared', fmt(S.result.pairs.length), '']
    ].map(function (t) {
      return '<div class="tile ' + t[2] + '"><div class="n">' + esc(t[1]) + '</div><div class="l">' + esc(t[0]) + '</div></div>';
    }).join('');

    var warn = [];
    if (st.duplicateKeysA) warn.push(fmt(st.duplicateKeysA) + ' duplicate key(s) in File A');
    if (st.duplicateKeysB) warn.push(fmt(st.duplicateKeysB) + ' duplicate key(s) in File B');
    var unmapped = S.mapping.filter(function (m) { return !m.b; });
    if (unmapped.length) warn.push(unmapped.length + ' column(s) in A not compared (' +
      unmapped.slice(0, 4).map(function (m) { return m.a; }).join(', ') + (unmapped.length > 4 ? '…' : '') + ')');
    msg($('r-msg'), warn.length ? 'Worth knowing: ' + warn.join('; ') + '. Duplicate keys mean only the first row of each key was compared — add a column to the primary key to make it unique.' : '', !!st.duplicateKeysA || !!st.duplicateKeysB);

    paintTable();
  }

  var STATUS = {
    'mismatch': ['st-mismatch', 'Different'],
    'match': ['st-match', 'Identical'],
    'missing-in-target': ['st-missing', 'Missing in B'],
    'only-in-target': ['st-only', 'Only in B']
  };

  function paintTable() {
    var pairs = S.result.pairs;
    var find = ($('r-find').value || '').trim().toLowerCase();
    var rows = S.result.rows.filter(function (r) {
      if (S.view === 'diff' && r.status === 'match') return false;
      if (!find) return true;
      if ((r.keyDisplay || r.key).toLowerCase().indexOf(find) >= 0) return true;
      return r.cells.some(function (c) {
        return String(c.a).toLowerCase().indexOf(find) >= 0 || String(c.b).toLowerCase().indexOf(find) >= 0;
      });
    });

    var head = '<tr><th>Status</th><th>Key</th>' + pairs.map(function (p) {
      return '<th>' + esc(p.a) + ' <span style="color:var(--muted);font-weight:400">(A)</span></th>' +
        '<th>' + esc(p.b) + ' <span style="color:var(--muted);font-weight:400">(B)</span></th>';
    }).join('') + '</tr>';

    var body = rows.slice(0, MAX_RENDER).map(function (r) {
      var s = STATUS[r.status];
      return '<tr><td class="st ' + s[0] + '">' + s[1] + '</td><td>' + esc((r.keyDisplay || r.key)) + '</td>' +
        r.cells.map(function (c) {
          var cls = c.match ? '' : ' class="diff"';
          return '<td' + cls + '>' + esc(c.a) + '</td><td' + cls + '>' + esc(c.b) + '</td>';
        }).join('') + '</tr>';
    }).join('');

    var more = rows.length > MAX_RENDER
      ? '<p class="fineprint" style="margin:10px 0 0">Showing the first ' + fmt(MAX_RENDER) + ' of ' + fmt(rows.length) +
        ' rows on screen. The Excel download contains all of them.</p>' : '';

    $('r-table').innerHTML = rows.length
      ? '<table class="grid"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>'
      : '<p class="fineprint" style="padding:18px">No rows to show' + (find ? ' for that filter.' : '.') + '</p>';
    $('r-table').insertAdjacentHTML('afterend', '');
    var old = document.getElementById('more-note'); if (old) old.remove();
    if (more) $('r-table').insertAdjacentHTML('afterend', '<div id="more-note">' + more + '</div>');
  }

  /* ---------- Excel export ---------- */

  var RED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } };
  var RED_FONT = { color: { argb: 'FFA5281B' }, bold: true };
  var THIN = { style: 'thin', color: { argb: 'FFD8D4CD' } };
  var BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

  function addSheet(wb, name, rows, pairs) {
    var ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
    var header = ['Status', 'Key'];
    pairs.forEach(function (p) { header.push(p.a + ' (A)'); header.push(p.b + ' (B)'); });
    var hr = ws.addRow(header);
    hr.font = { bold: true };
    hr.eachCell(function (c) {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2EFEA' } };
      c.border = BORDER;
      c.alignment = { vertical: 'middle', wrapText: true };
    });
    rows.forEach(function (r) {
      var vals = [STATUS[r.status][1], (r.keyDisplay || r.key)];
      r.cells.forEach(function (c) { vals.push(c.a); vals.push(c.b); });
      var row = ws.addRow(vals);
      row.eachCell(function (c) { c.border = BORDER; });
      r.cells.forEach(function (c, i) {
        if (c.match) return;
        [3 + i * 2, 4 + i * 2].forEach(function (col) {
          var cell = row.getCell(col);
          cell.fill = RED_FILL; cell.font = RED_FONT;
        });
      });
      if (r.status !== 'match' && r.status !== 'mismatch') {
        row.getCell(1).font = { bold: true, color: { argb: 'FF8A5A12' } };
      }
    });
    ws.columns.forEach(function (col, i) { col.width = i < 2 ? 18 : 20; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
    return ws;
  }

  function addSummary(wb) {
    var st = S.result.stats, ws = wb.addWorksheet('Summary');
    var title = ws.addRow(['AI File Compare — summary']);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    ws.addRow(['Generated', new Date().toLocaleString()]);
    ws.addRow(['File A (legacy)', S.files.a ? S.files.a.name : '—', fmt(S.data.a.rows.length) + ' rows']);
    ws.addRow(['File B (target)', S.files.b ? S.files.b.name : '—', fmt(S.data.b.rows.length) + ' rows']);
    ws.addRow(['Mapping file', S.files.c ? S.files.c.name : 'not used']);
    ws.addRow(['Primary key', S.pk.join(' + ')]);
    ws.addRow([]);
    [['Rows paired', st.matchedKeys], ['Rows with a difference', st.rowsWithMismatch],
     ['Cells compared', st.cellsCompared], ['Cells different', st.cellsMismatched],
     ['Missing in target', st.missingInTarget], ['Only in target', st.onlyInTarget],
     ['Duplicate keys in A', st.duplicateKeysA], ['Duplicate keys in B', st.duplicateKeysB]
    ].forEach(function (r) { ws.addRow(r); });
    ws.addRow([]);
    var h = ws.addRow(['Column (A)', 'Column (B)', 'Compared', 'Different']);
    h.font = { bold: true };
    S.mapping.forEach(function (m) {
      var pc = st.perColumn[m.a];
      var row = ws.addRow([m.a, m.b || '— not compared —', pc ? pc.compared : 0, pc ? pc.mismatched : 0]);
      if (pc && pc.mismatched) { row.getCell(4).font = RED_FONT; row.getCell(4).fill = RED_FILL; }
    });
    ws.columns.forEach(function (c, i) { c.width = i === 0 || i === 1 ? 28 : 16; });
  }

  function download() {
    if (!S.result || !window.ExcelJS) return;
    var btn = $('dl'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Building…';
    var wb = new ExcelJS.Workbook();
    wb.creator = 'AI File Compare';
    wb.created = new Date();
    addSummary(wb);
    addSheet(wb, 'All Rows', S.result.rows, S.result.pairs);
    addSheet(wb, 'Differences Only', S.result.rows.filter(function (r) { return r.status !== 'match'; }), S.result.pairs);
    wb.xlsx.writeBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url;
      a.download = 'file-comparison-' + new Date().toISOString().slice(0, 10) + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      btn.disabled = false; btn.textContent = label;
    }).catch(function (e) {
      msg($('r-msg'), 'Could not build the Excel file: ' + e.message, true);
      btn.disabled = false; btn.textContent = label;
    });
  }

  /* ---------- steps ---------- */

  function step(n) {
    $('p-upload').className = n === 1 ? 'panel' : 'panel hidden';
    $('p-map').className = n === 2 ? 'panel' : 'panel hidden';
    $('p-result').className = n === 3 ? 'panel' : 'panel hidden';
    Array.prototype.forEach.call($('steps').children, function (li) {
      var s = +li.getAttribute('data-s');
      li.className = s === n ? 'on' : (s < n ? 'done' : '');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('go-map').addEventListener('click', function () {
    S.pk = []; paintMapping(); paintPK(); step(2);
  });
  $('go-run').addEventListener('click', run);
  $('back-1').addEventListener('click', function () { step(1); });
  $('back-2').addEventListener('click', function () { step(2); });
  $('t-all').addEventListener('click', function () {
    S.view = 'all'; $('t-all').className = 'tab on'; $('t-diff').className = 'tab'; paintTable();
  });
  $('t-diff').addEventListener('click', function () {
    S.view = 'diff'; $('t-diff').className = 'tab on'; $('t-all').className = 'tab'; paintTable();
  });
  $('r-find').addEventListener('input', function () { paintTable(); });
  $('dl').addEventListener('click', download);

  /* ---------- sample files ---------- */

  function csvToFile(name, text) {
    return new File([text], name, { type: 'text/csv' });
  }

  $('load-sample').addEventListener('click', function () {
    var s = window.FCSamples;
    if (!s) return;
    takeFile('a', csvToFile('legacy_customers.csv', s.a));
    takeFile('b', csvToFile('target_customers.csv', s.b));
    takeFile('c', csvToFile('column_mapping.csv', s.c));
    msg($('up-msg'), 'Sample files loaded: 60 customer records exported from an old system, the same records after migration, and a partial mapping sheet. Eleven of them were changed on purpose, one row was dropped and one was added.');
  });
})();
