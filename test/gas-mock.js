// Apps Script の最小限の模擬環境。Code.gs をそのまま読み込んで動かす。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  const data = []; // 2次元配列（1始まりで扱う）
  const sheet = {
    name,
    data,
    getName: () => name,
    getLastRow: () => data.length,
    appendRow: (row) => { data.push(row.slice()); },
    setFrozenRows: () => sheet,
    clear: () => { data.length = 0; return sheet; },
    getDataRange: () => ({
      getValues: () => data.map((r) => r.slice()),
      getDisplayValues: () => data.map((r) => r.map((v) =>
        v === true ? 'TRUE' : v === false ? 'FALSE' : v instanceof Date ? v.toISOString() : String(v)))
    }),
    getRange: (a, b, c, d) => {
      if (typeof a === 'string') {
        // 'A1' や 'A1:E1'、'G:G' のような指定
        const m = a.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
        const colOf = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        const r1 = m[2] ? Number(m[2]) : 1;
        const c1 = colOf(m[1]);
        const c2 = m[3] ? colOf(m[3]) : c1;
        return rangeObj(r1, c1, 1, c2 - c1 + 1);
      }
      return rangeObj(a, b, c || 1, d || 1);
    }
  };
  function ensure(r, c) {
    while (data.length < r) data.push([]);
    while (data[r - 1].length < c) data[r - 1].push('');
  }
  function rangeObj(r, c, nr, nc) {
    const ro = {
      setValues: (vals) => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
          ensure(r + i, c + j);
          data[r + i - 1][c + j - 1] = vals[i][j];
        }
        return ro;
      },
      setValue: (v) => { ensure(r, c); data[r - 1][c - 1] = v; return ro; },
      setFormula: (f) => { ensure(r, c); data[r - 1][c - 1] = f; return ro; },
      setFontWeight: () => ro,
      setNumberFormat: () => ro
    };
    return ro;
  }
  return sheet;
}

// Apps Script が予約している URL パラメータ。使うと本番では「ファイルを開くことができません」になる
const RESERVED = ['c', 'sid'];
function checkReserved(params) {
  for (const k of Object.keys(params)) {
    if (RESERVED.includes(k)) throw new Error('Apps Script の予約パラメータは使えません: ' + k);
  }
}

function createEnv() {
  const sheets = {};
  const triggers = [];
  const cache = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n))
  };
  const fmt = (d, tz, pattern) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(d).map((p) => [p.type, p.value]));
    if (pattern === 'H') return String(Number(parts.hour));
    return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
      .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
  };
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Error,
    isFinite,
    isNaN,
    encodeURIComponent,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => { throw new Error('UI is not available in tests'); }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache[k] === undefined ? null : cache[k]),
        put: (k, v) => { cache[k] = v; }
      })
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Apps Script と同じく、符号つきのバイト（-128〜127）の配列を返す
      computeDigest: (alg, text) => Array.from(crypto.createHash(alg).update(String(text), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      formatDate: fmt
    },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger: (fn) => ({
        timeBased: () => ({
          everyDays: () => ({
            atHour: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) })
          })
        })
      })
    }
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'Code.gs' });

  const call = (resp) => JSON.parse(resp.text);
  return {
    sandbox,
    sheets,
    triggers,
    get: (params) => {
      checkReserved(params);
      return call(sandbox.doGet({ parameter: params }));
    },
    post: (body) => call(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }))
  };
}

module.exports = { createEnv, checkReserved };
