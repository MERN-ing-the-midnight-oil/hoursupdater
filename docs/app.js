var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/qrcode/lib/can-promise.js
var require_can_promise = __commonJS({
  "node_modules/qrcode/lib/can-promise.js"(exports, module) {
    module.exports = function() {
      return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
    };
  }
});

// node_modules/qrcode/lib/core/utils.js
var require_utils = __commonJS({
  "node_modules/qrcode/lib/core/utils.js"(exports) {
    var toSJISFunction;
    var CODEWORDS_COUNT = [
      0,
      // Not used
      26,
      44,
      70,
      100,
      134,
      172,
      196,
      242,
      292,
      346,
      404,
      466,
      532,
      581,
      655,
      733,
      815,
      901,
      991,
      1085,
      1156,
      1258,
      1364,
      1474,
      1588,
      1706,
      1828,
      1921,
      2051,
      2185,
      2323,
      2465,
      2611,
      2761,
      2876,
      3034,
      3196,
      3362,
      3532,
      3706
    ];
    exports.getSymbolSize = function getSymbolSize(version) {
      if (!version) throw new Error('"version" cannot be null or undefined');
      if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
      return version * 4 + 17;
    };
    exports.getSymbolTotalCodewords = function getSymbolTotalCodewords(version) {
      return CODEWORDS_COUNT[version];
    };
    exports.getBCHDigit = function(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    };
    exports.setToSJISFunction = function setToSJISFunction(f) {
      if (typeof f !== "function") {
        throw new Error('"toSJISFunc" is not a valid function.');
      }
      toSJISFunction = f;
    };
    exports.isKanjiModeEnabled = function() {
      return typeof toSJISFunction !== "undefined";
    };
    exports.toSJIS = function toSJIS(kanji) {
      return toSJISFunction(kanji);
    };
  }
});

// node_modules/qrcode/lib/core/error-correction-level.js
var require_error_correction_level = __commonJS({
  "node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
    exports.L = { bit: 1 };
    exports.M = { bit: 0 };
    exports.Q = { bit: 3 };
    exports.H = { bit: 2 };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "l":
        case "low":
          return exports.L;
        case "m":
        case "medium":
          return exports.M;
        case "q":
        case "quartile":
          return exports.Q;
        case "h":
        case "high":
          return exports.H;
        default:
          throw new Error("Unknown EC Level: " + string);
      }
    }
    exports.isValid = function isValid(level) {
      return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
    };
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// node_modules/qrcode/lib/core/bit-buffer.js
var require_bit_buffer = __commonJS({
  "node_modules/qrcode/lib/core/bit-buffer.js"(exports, module) {
    function BitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    BitBuffer.prototype = {
      get: function(index) {
        const bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
      },
      put: function(num, length) {
        for (let i = 0; i < length; i++) {
          this.putBit((num >>> length - i - 1 & 1) === 1);
        }
      },
      getLengthInBits: function() {
        return this.length;
      },
      putBit: function(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }
    };
    module.exports = BitBuffer;
  }
});

// node_modules/qrcode/lib/core/bit-matrix.js
var require_bit_matrix = __commonJS({
  "node_modules/qrcode/lib/core/bit-matrix.js"(exports, module) {
    function BitMatrix(size) {
      if (!size || size < 1) {
        throw new Error("BitMatrix size must be defined and greater than 0");
      }
      this.size = size;
      this.data = new Uint8Array(size * size);
      this.reservedBit = new Uint8Array(size * size);
    }
    BitMatrix.prototype.set = function(row, col, value, reserved) {
      const index = row * this.size + col;
      this.data[index] = value;
      if (reserved) this.reservedBit[index] = true;
    };
    BitMatrix.prototype.get = function(row, col) {
      return this.data[row * this.size + col];
    };
    BitMatrix.prototype.xor = function(row, col, value) {
      this.data[row * this.size + col] ^= value;
    };
    BitMatrix.prototype.isReserved = function(row, col) {
      return this.reservedBit[row * this.size + col];
    };
    module.exports = BitMatrix;
  }
});

// node_modules/qrcode/lib/core/alignment-pattern.js
var require_alignment_pattern = __commonJS({
  "node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    exports.getRowColCoords = function getRowColCoords(version) {
      if (version === 1) return [];
      const posCount = Math.floor(version / 7) + 2;
      const size = getSymbolSize(version);
      const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
      const positions = [size - 7];
      for (let i = 1; i < posCount - 1; i++) {
        positions[i] = positions[i - 1] - intervals;
      }
      positions.push(6);
      return positions.reverse();
    };
    exports.getPositions = function getPositions(version) {
      const coords = [];
      const pos = exports.getRowColCoords(version);
      const posLength = pos.length;
      for (let i = 0; i < posLength; i++) {
        for (let j = 0; j < posLength; j++) {
          if (i === 0 && j === 0 || // top-left
          i === 0 && j === posLength - 1 || // bottom-left
          i === posLength - 1 && j === 0) {
            continue;
          }
          coords.push([pos[i], pos[j]]);
        }
      }
      return coords;
    };
  }
});

// node_modules/qrcode/lib/core/finder-pattern.js
var require_finder_pattern = __commonJS({
  "node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    var FINDER_PATTERN_SIZE = 7;
    exports.getPositions = function getPositions(version) {
      const size = getSymbolSize(version);
      return [
        // top-left
        [0, 0],
        // top-right
        [size - FINDER_PATTERN_SIZE, 0],
        // bottom-left
        [0, size - FINDER_PATTERN_SIZE]
      ];
    };
  }
});

// node_modules/qrcode/lib/core/mask-pattern.js
var require_mask_pattern = __commonJS({
  "node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
    exports.Patterns = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var PenaltyScores = {
      N1: 3,
      N2: 3,
      N3: 40,
      N4: 10
    };
    exports.isValid = function isValid(mask) {
      return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
    };
    exports.from = function from(value) {
      return exports.isValid(value) ? parseInt(value, 10) : void 0;
    };
    exports.getPenaltyN1 = function getPenaltyN1(data) {
      const size = data.size;
      let points = 0;
      let sameCountCol = 0;
      let sameCountRow = 0;
      let lastCol = null;
      let lastRow = null;
      for (let row = 0; row < size; row++) {
        sameCountCol = sameCountRow = 0;
        lastCol = lastRow = null;
        for (let col = 0; col < size; col++) {
          let module2 = data.get(row, col);
          if (module2 === lastCol) {
            sameCountCol++;
          } else {
            if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
            lastCol = module2;
            sameCountCol = 1;
          }
          module2 = data.get(col, row);
          if (module2 === lastRow) {
            sameCountRow++;
          } else {
            if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
            lastRow = module2;
            sameCountRow = 1;
          }
        }
        if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
        if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
      }
      return points;
    };
    exports.getPenaltyN2 = function getPenaltyN2(data) {
      const size = data.size;
      let points = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
          if (last === 4 || last === 0) points++;
        }
      }
      return points * PenaltyScores.N2;
    };
    exports.getPenaltyN3 = function getPenaltyN3(data) {
      const size = data.size;
      let points = 0;
      let bitsCol = 0;
      let bitsRow = 0;
      for (let row = 0; row < size; row++) {
        bitsCol = bitsRow = 0;
        for (let col = 0; col < size; col++) {
          bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
          if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
          bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
          if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
        }
      }
      return points * PenaltyScores.N3;
    };
    exports.getPenaltyN4 = function getPenaltyN4(data) {
      let darkCount = 0;
      const modulesCount = data.data.length;
      for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
      const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
      return k * PenaltyScores.N4;
    };
    function getMaskAt(maskPattern, i, j) {
      switch (maskPattern) {
        case exports.Patterns.PATTERN000:
          return (i + j) % 2 === 0;
        case exports.Patterns.PATTERN001:
          return i % 2 === 0;
        case exports.Patterns.PATTERN010:
          return j % 3 === 0;
        case exports.Patterns.PATTERN011:
          return (i + j) % 3 === 0;
        case exports.Patterns.PATTERN100:
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case exports.Patterns.PATTERN101:
          return i * j % 2 + i * j % 3 === 0;
        case exports.Patterns.PATTERN110:
          return (i * j % 2 + i * j % 3) % 2 === 0;
        case exports.Patterns.PATTERN111:
          return (i * j % 3 + (i + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    }
    exports.applyMask = function applyMask(pattern, data) {
      const size = data.size;
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          if (data.isReserved(row, col)) continue;
          data.xor(row, col, getMaskAt(pattern, row, col));
        }
      }
    };
    exports.getBestMask = function getBestMask(data, setupFormatFunc) {
      const numPatterns = Object.keys(exports.Patterns).length;
      let bestPattern = 0;
      let lowerPenalty = Infinity;
      for (let p = 0; p < numPatterns; p++) {
        setupFormatFunc(p);
        exports.applyMask(p, data);
        const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
        exports.applyMask(p, data);
        if (penalty < lowerPenalty) {
          lowerPenalty = penalty;
          bestPattern = p;
        }
      }
      return bestPattern;
    };
  }
});

// node_modules/qrcode/lib/core/error-correction-code.js
var require_error_correction_code = __commonJS({
  "node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
    var ECLevel = require_error_correction_level();
    var EC_BLOCKS_TABLE = [
      // L  M  Q  H
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      2,
      1,
      2,
      2,
      4,
      1,
      2,
      4,
      4,
      2,
      4,
      4,
      4,
      2,
      4,
      6,
      5,
      2,
      4,
      6,
      6,
      2,
      5,
      8,
      8,
      4,
      5,
      8,
      8,
      4,
      5,
      8,
      11,
      4,
      8,
      10,
      11,
      4,
      9,
      12,
      16,
      4,
      9,
      16,
      16,
      6,
      10,
      12,
      18,
      6,
      10,
      17,
      16,
      6,
      11,
      16,
      19,
      6,
      13,
      18,
      21,
      7,
      14,
      21,
      25,
      8,
      16,
      20,
      25,
      8,
      17,
      23,
      25,
      9,
      17,
      23,
      34,
      9,
      18,
      25,
      30,
      10,
      20,
      27,
      32,
      12,
      21,
      29,
      35,
      12,
      23,
      34,
      37,
      12,
      25,
      34,
      40,
      13,
      26,
      35,
      42,
      14,
      28,
      38,
      45,
      15,
      29,
      40,
      48,
      16,
      31,
      43,
      51,
      17,
      33,
      45,
      54,
      18,
      35,
      48,
      57,
      19,
      37,
      51,
      60,
      19,
      38,
      53,
      63,
      20,
      40,
      56,
      66,
      21,
      43,
      59,
      70,
      22,
      45,
      62,
      74,
      24,
      47,
      65,
      77,
      25,
      49,
      68,
      81
    ];
    var EC_CODEWORDS_TABLE = [
      // L  M  Q  H
      7,
      10,
      13,
      17,
      10,
      16,
      22,
      28,
      15,
      26,
      36,
      44,
      20,
      36,
      52,
      64,
      26,
      48,
      72,
      88,
      36,
      64,
      96,
      112,
      40,
      72,
      108,
      130,
      48,
      88,
      132,
      156,
      60,
      110,
      160,
      192,
      72,
      130,
      192,
      224,
      80,
      150,
      224,
      264,
      96,
      176,
      260,
      308,
      104,
      198,
      288,
      352,
      120,
      216,
      320,
      384,
      132,
      240,
      360,
      432,
      144,
      280,
      408,
      480,
      168,
      308,
      448,
      532,
      180,
      338,
      504,
      588,
      196,
      364,
      546,
      650,
      224,
      416,
      600,
      700,
      224,
      442,
      644,
      750,
      252,
      476,
      690,
      816,
      270,
      504,
      750,
      900,
      300,
      560,
      810,
      960,
      312,
      588,
      870,
      1050,
      336,
      644,
      952,
      1110,
      360,
      700,
      1020,
      1200,
      390,
      728,
      1050,
      1260,
      420,
      784,
      1140,
      1350,
      450,
      812,
      1200,
      1440,
      480,
      868,
      1290,
      1530,
      510,
      924,
      1350,
      1620,
      540,
      980,
      1440,
      1710,
      570,
      1036,
      1530,
      1800,
      570,
      1064,
      1590,
      1890,
      600,
      1120,
      1680,
      1980,
      630,
      1204,
      1770,
      2100,
      660,
      1260,
      1860,
      2220,
      720,
      1316,
      1950,
      2310,
      750,
      1372,
      2040,
      2430
    ];
    exports.getBlocksCount = function getBlocksCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    exports.getTotalCodewordsCount = function getTotalCodewordsCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
  }
});

// node_modules/qrcode/lib/core/galois-field.js
var require_galois_field = __commonJS({
  "node_modules/qrcode/lib/core/galois-field.js"(exports) {
    var EXP_TABLE = new Uint8Array(512);
    var LOG_TABLE = new Uint8Array(256);
    (function initTables() {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        EXP_TABLE[i] = x;
        LOG_TABLE[x] = i;
        x <<= 1;
        if (x & 256) {
          x ^= 285;
        }
      }
      for (let i = 255; i < 512; i++) {
        EXP_TABLE[i] = EXP_TABLE[i - 255];
      }
    })();
    exports.log = function log(n) {
      if (n < 1) throw new Error("log(" + n + ")");
      return LOG_TABLE[n];
    };
    exports.exp = function exp(n) {
      return EXP_TABLE[n];
    };
    exports.mul = function mul(x, y) {
      if (x === 0 || y === 0) return 0;
      return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
    };
  }
});

// node_modules/qrcode/lib/core/polynomial.js
var require_polynomial = __commonJS({
  "node_modules/qrcode/lib/core/polynomial.js"(exports) {
    var GF = require_galois_field();
    exports.mul = function mul(p1, p2) {
      const coeff = new Uint8Array(p1.length + p2.length - 1);
      for (let i = 0; i < p1.length; i++) {
        for (let j = 0; j < p2.length; j++) {
          coeff[i + j] ^= GF.mul(p1[i], p2[j]);
        }
      }
      return coeff;
    };
    exports.mod = function mod(divident, divisor) {
      let result = new Uint8Array(divident);
      while (result.length - divisor.length >= 0) {
        const coeff = result[0];
        for (let i = 0; i < divisor.length; i++) {
          result[i] ^= GF.mul(divisor[i], coeff);
        }
        let offset = 0;
        while (offset < result.length && result[offset] === 0) offset++;
        result = result.slice(offset);
      }
      return result;
    };
    exports.generateECPolynomial = function generateECPolynomial(degree) {
      let poly = new Uint8Array([1]);
      for (let i = 0; i < degree; i++) {
        poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
      }
      return poly;
    };
  }
});

// node_modules/qrcode/lib/core/reed-solomon-encoder.js
var require_reed_solomon_encoder = __commonJS({
  "node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module) {
    var Polynomial = require_polynomial();
    function ReedSolomonEncoder(degree) {
      this.genPoly = void 0;
      this.degree = degree;
      if (this.degree) this.initialize(this.degree);
    }
    ReedSolomonEncoder.prototype.initialize = function initialize(degree) {
      this.degree = degree;
      this.genPoly = Polynomial.generateECPolynomial(this.degree);
    };
    ReedSolomonEncoder.prototype.encode = function encode(data) {
      if (!this.genPoly) {
        throw new Error("Encoder not initialized");
      }
      const paddedData = new Uint8Array(data.length + this.degree);
      paddedData.set(data);
      const remainder = Polynomial.mod(paddedData, this.genPoly);
      const start = this.degree - remainder.length;
      if (start > 0) {
        const buff = new Uint8Array(this.degree);
        buff.set(remainder, start);
        return buff;
      }
      return remainder;
    };
    module.exports = ReedSolomonEncoder;
  }
});

// node_modules/qrcode/lib/core/version-check.js
var require_version_check = __commonJS({
  "node_modules/qrcode/lib/core/version-check.js"(exports) {
    exports.isValid = function isValid(version) {
      return !isNaN(version) && version >= 1 && version <= 40;
    };
  }
});

// node_modules/qrcode/lib/core/regex.js
var require_regex = __commonJS({
  "node_modules/qrcode/lib/core/regex.js"(exports) {
    var numeric = "[0-9]+";
    var alphanumeric = "[A-Z $%*+\\-./:]+";
    var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
    kanji = kanji.replace(/u/g, "\\u");
    var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
    exports.KANJI = new RegExp(kanji, "g");
    exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
    exports.BYTE = new RegExp(byte, "g");
    exports.NUMERIC = new RegExp(numeric, "g");
    exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
    var TEST_KANJI = new RegExp("^" + kanji + "$");
    var TEST_NUMERIC = new RegExp("^" + numeric + "$");
    var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
    exports.testKanji = function testKanji(str) {
      return TEST_KANJI.test(str);
    };
    exports.testNumeric = function testNumeric(str) {
      return TEST_NUMERIC.test(str);
    };
    exports.testAlphanumeric = function testAlphanumeric(str) {
      return TEST_ALPHANUMERIC.test(str);
    };
  }
});

// node_modules/qrcode/lib/core/mode.js
var require_mode = __commonJS({
  "node_modules/qrcode/lib/core/mode.js"(exports) {
    var VersionCheck = require_version_check();
    var Regex = require_regex();
    exports.NUMERIC = {
      id: "Numeric",
      bit: 1 << 0,
      ccBits: [10, 12, 14]
    };
    exports.ALPHANUMERIC = {
      id: "Alphanumeric",
      bit: 1 << 1,
      ccBits: [9, 11, 13]
    };
    exports.BYTE = {
      id: "Byte",
      bit: 1 << 2,
      ccBits: [8, 16, 16]
    };
    exports.KANJI = {
      id: "Kanji",
      bit: 1 << 3,
      ccBits: [8, 10, 12]
    };
    exports.MIXED = {
      bit: -1
    };
    exports.getCharCountIndicator = function getCharCountIndicator(mode, version) {
      if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid version: " + version);
      }
      if (version >= 1 && version < 10) return mode.ccBits[0];
      else if (version < 27) return mode.ccBits[1];
      return mode.ccBits[2];
    };
    exports.getBestModeForData = function getBestModeForData(dataStr) {
      if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
      else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
      else if (Regex.testKanji(dataStr)) return exports.KANJI;
      else return exports.BYTE;
    };
    exports.toString = function toString(mode) {
      if (mode && mode.id) return mode.id;
      throw new Error("Invalid mode");
    };
    exports.isValid = function isValid(mode) {
      return mode && mode.bit && mode.ccBits;
    };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "numeric":
          return exports.NUMERIC;
        case "alphanumeric":
          return exports.ALPHANUMERIC;
        case "kanji":
          return exports.KANJI;
        case "byte":
          return exports.BYTE;
        default:
          throw new Error("Unknown mode: " + string);
      }
    }
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// node_modules/qrcode/lib/core/version.js
var require_version = __commonJS({
  "node_modules/qrcode/lib/core/version.js"(exports) {
    var Utils = require_utils();
    var ECCode = require_error_correction_code();
    var ECLevel = require_error_correction_level();
    var Mode = require_mode();
    var VersionCheck = require_version_check();
    var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    var G18_BCH = Utils.getBCHDigit(G18);
    function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    function getReservedBitsCount(mode, version) {
      return Mode.getCharCountIndicator(mode, version) + 4;
    }
    function getTotalBitsFromDataArray(segments, version) {
      let totalBits = 0;
      segments.forEach(function(data) {
        const reservedBits = getReservedBitsCount(data.mode, version);
        totalBits += reservedBits + data.getBitsLength();
      });
      return totalBits;
    }
    function getBestVersionForMixedData(segments, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        const length = getTotalBitsFromDataArray(segments, currentVersion);
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    exports.from = function from(value, defaultValue) {
      if (VersionCheck.isValid(value)) {
        return parseInt(value, 10);
      }
      return defaultValue;
    };
    exports.getCapacity = function getCapacity(version, errorCorrectionLevel, mode) {
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid QR Code version");
      }
      if (typeof mode === "undefined") mode = Mode.BYTE;
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (mode === Mode.MIXED) return dataTotalCodewordsBits;
      const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
      switch (mode) {
        case Mode.NUMERIC:
          return Math.floor(usableBits / 10 * 3);
        case Mode.ALPHANUMERIC:
          return Math.floor(usableBits / 11 * 2);
        case Mode.KANJI:
          return Math.floor(usableBits / 13);
        case Mode.BYTE:
        default:
          return Math.floor(usableBits / 8);
      }
    };
    exports.getBestVersionForData = function getBestVersionForData(data, errorCorrectionLevel) {
      let seg;
      const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
      if (Array.isArray(data)) {
        if (data.length > 1) {
          return getBestVersionForMixedData(data, ecl);
        }
        if (data.length === 0) {
          return 1;
        }
        seg = data[0];
      } else {
        seg = data;
      }
      return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
    };
    exports.getEncodedBits = function getEncodedBits(version) {
      if (!VersionCheck.isValid(version) || version < 7) {
        throw new Error("Invalid QR Code version");
      }
      let d = version << 12;
      while (Utils.getBCHDigit(d) - G18_BCH >= 0) {
        d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
      }
      return version << 12 | d;
    };
  }
});

// node_modules/qrcode/lib/core/format-info.js
var require_format_info = __commonJS({
  "node_modules/qrcode/lib/core/format-info.js"(exports) {
    var Utils = require_utils();
    var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    var G15_BCH = Utils.getBCHDigit(G15);
    exports.getEncodedBits = function getEncodedBits(errorCorrectionLevel, mask) {
      const data = errorCorrectionLevel.bit << 3 | mask;
      let d = data << 10;
      while (Utils.getBCHDigit(d) - G15_BCH >= 0) {
        d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
      }
      return (data << 10 | d) ^ G15_MASK;
    };
  }
});

// node_modules/qrcode/lib/core/numeric-data.js
var require_numeric_data = __commonJS({
  "node_modules/qrcode/lib/core/numeric-data.js"(exports, module) {
    var Mode = require_mode();
    function NumericData(data) {
      this.mode = Mode.NUMERIC;
      this.data = data.toString();
    }
    NumericData.getBitsLength = function getBitsLength(length) {
      return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
    };
    NumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    NumericData.prototype.getBitsLength = function getBitsLength() {
      return NumericData.getBitsLength(this.data.length);
    };
    NumericData.prototype.write = function write(bitBuffer) {
      let i, group, value;
      for (i = 0; i + 3 <= this.data.length; i += 3) {
        group = this.data.substr(i, 3);
        value = parseInt(group, 10);
        bitBuffer.put(value, 10);
      }
      const remainingNum = this.data.length - i;
      if (remainingNum > 0) {
        group = this.data.substr(i);
        value = parseInt(group, 10);
        bitBuffer.put(value, remainingNum * 3 + 1);
      }
    };
    module.exports = NumericData;
  }
});

// node_modules/qrcode/lib/core/alphanumeric-data.js
var require_alphanumeric_data = __commonJS({
  "node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module) {
    var Mode = require_mode();
    var ALPHA_NUM_CHARS = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      " ",
      "$",
      "%",
      "*",
      "+",
      "-",
      ".",
      "/",
      ":"
    ];
    function AlphanumericData(data) {
      this.mode = Mode.ALPHANUMERIC;
      this.data = data;
    }
    AlphanumericData.getBitsLength = function getBitsLength(length) {
      return 11 * Math.floor(length / 2) + 6 * (length % 2);
    };
    AlphanumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    AlphanumericData.prototype.getBitsLength = function getBitsLength() {
      return AlphanumericData.getBitsLength(this.data.length);
    };
    AlphanumericData.prototype.write = function write(bitBuffer) {
      let i;
      for (i = 0; i + 2 <= this.data.length; i += 2) {
        let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
        value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]);
        bitBuffer.put(value, 11);
      }
      if (this.data.length % 2) {
        bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
      }
    };
    module.exports = AlphanumericData;
  }
});

// node_modules/qrcode/lib/core/byte-data.js
var require_byte_data = __commonJS({
  "node_modules/qrcode/lib/core/byte-data.js"(exports, module) {
    var Mode = require_mode();
    function ByteData(data) {
      this.mode = Mode.BYTE;
      if (typeof data === "string") {
        this.data = new TextEncoder().encode(data);
      } else {
        this.data = new Uint8Array(data);
      }
    }
    ByteData.getBitsLength = function getBitsLength(length) {
      return length * 8;
    };
    ByteData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    ByteData.prototype.getBitsLength = function getBitsLength() {
      return ByteData.getBitsLength(this.data.length);
    };
    ByteData.prototype.write = function(bitBuffer) {
      for (let i = 0, l = this.data.length; i < l; i++) {
        bitBuffer.put(this.data[i], 8);
      }
    };
    module.exports = ByteData;
  }
});

// node_modules/qrcode/lib/core/kanji-data.js
var require_kanji_data = __commonJS({
  "node_modules/qrcode/lib/core/kanji-data.js"(exports, module) {
    var Mode = require_mode();
    var Utils = require_utils();
    function KanjiData(data) {
      this.mode = Mode.KANJI;
      this.data = data;
    }
    KanjiData.getBitsLength = function getBitsLength(length) {
      return length * 13;
    };
    KanjiData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    KanjiData.prototype.getBitsLength = function getBitsLength() {
      return KanjiData.getBitsLength(this.data.length);
    };
    KanjiData.prototype.write = function(bitBuffer) {
      let i;
      for (i = 0; i < this.data.length; i++) {
        let value = Utils.toSJIS(this.data[i]);
        if (value >= 33088 && value <= 40956) {
          value -= 33088;
        } else if (value >= 57408 && value <= 60351) {
          value -= 49472;
        } else {
          throw new Error(
            "Invalid SJIS character: " + this.data[i] + "\nMake sure your charset is UTF-8"
          );
        }
        value = (value >>> 8 & 255) * 192 + (value & 255);
        bitBuffer.put(value, 13);
      }
    };
    module.exports = KanjiData;
  }
});

// node_modules/dijkstrajs/dijkstra.js
var require_dijkstra = __commonJS({
  "node_modules/dijkstrajs/dijkstra.js"(exports, module) {
    "use strict";
    var dijkstra = {
      single_source_shortest_paths: function(graph, s, d) {
        var predecessors = {};
        var costs = {};
        costs[s] = 0;
        var open = dijkstra.PriorityQueue.make();
        open.push(s, 0);
        var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
        while (!open.empty()) {
          closest = open.pop();
          u = closest.value;
          cost_of_s_to_u = closest.cost;
          adjacent_nodes = graph[u] || {};
          for (v in adjacent_nodes) {
            if (adjacent_nodes.hasOwnProperty(v)) {
              cost_of_e = adjacent_nodes[v];
              cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
              cost_of_s_to_v = costs[v];
              first_visit = typeof costs[v] === "undefined";
              if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                costs[v] = cost_of_s_to_u_plus_cost_of_e;
                open.push(v, cost_of_s_to_u_plus_cost_of_e);
                predecessors[v] = u;
              }
            }
          }
        }
        if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
          var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
          throw new Error(msg);
        }
        return predecessors;
      },
      extract_shortest_path_from_predecessor_list: function(predecessors, d) {
        var nodes = [];
        var u = d;
        var predecessor;
        while (u) {
          nodes.push(u);
          predecessor = predecessors[u];
          u = predecessors[u];
        }
        nodes.reverse();
        return nodes;
      },
      find_path: function(graph, s, d) {
        var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
        return dijkstra.extract_shortest_path_from_predecessor_list(
          predecessors,
          d
        );
      },
      /**
       * A very naive priority queue implementation.
       */
      PriorityQueue: {
        make: function(opts) {
          var T = dijkstra.PriorityQueue, t = {}, key;
          opts = opts || {};
          for (key in T) {
            if (T.hasOwnProperty(key)) {
              t[key] = T[key];
            }
          }
          t.queue = [];
          t.sorter = opts.sorter || T.default_sorter;
          return t;
        },
        default_sorter: function(a, b) {
          return a.cost - b.cost;
        },
        /**
         * Add a new item to the queue and ensure the highest priority element
         * is at the front of the queue.
         */
        push: function(value, cost) {
          var item = { value, cost };
          this.queue.push(item);
          this.queue.sort(this.sorter);
        },
        /**
         * Return the highest priority element in the queue.
         */
        pop: function() {
          return this.queue.shift();
        },
        empty: function() {
          return this.queue.length === 0;
        }
      }
    };
    if (typeof module !== "undefined") {
      module.exports = dijkstra;
    }
  }
});

// node_modules/qrcode/lib/core/segments.js
var require_segments = __commonJS({
  "node_modules/qrcode/lib/core/segments.js"(exports) {
    var Mode = require_mode();
    var NumericData = require_numeric_data();
    var AlphanumericData = require_alphanumeric_data();
    var ByteData = require_byte_data();
    var KanjiData = require_kanji_data();
    var Regex = require_regex();
    var Utils = require_utils();
    var dijkstra = require_dijkstra();
    function getStringByteLength(str) {
      return unescape(encodeURIComponent(str)).length;
    }
    function getSegments(regex, mode, str) {
      const segments = [];
      let result;
      while ((result = regex.exec(str)) !== null) {
        segments.push({
          data: result[0],
          index: result.index,
          mode,
          length: result[0].length
        });
      }
      return segments;
    }
    function getSegmentsFromString(dataStr) {
      const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
      const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
      let byteSegs;
      let kanjiSegs;
      if (Utils.isKanjiModeEnabled()) {
        byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
        kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
      } else {
        byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
        kanjiSegs = [];
      }
      const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
      return segs.sort(function(s1, s2) {
        return s1.index - s2.index;
      }).map(function(obj) {
        return {
          data: obj.data,
          mode: obj.mode,
          length: obj.length
        };
      });
    }
    function getSegmentBitsLength(length, mode) {
      switch (mode) {
        case Mode.NUMERIC:
          return NumericData.getBitsLength(length);
        case Mode.ALPHANUMERIC:
          return AlphanumericData.getBitsLength(length);
        case Mode.KANJI:
          return KanjiData.getBitsLength(length);
        case Mode.BYTE:
          return ByteData.getBitsLength(length);
      }
    }
    function mergeSegments(segs) {
      return segs.reduce(function(acc, curr) {
        const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
        if (prevSeg && prevSeg.mode === curr.mode) {
          acc[acc.length - 1].data += curr.data;
          return acc;
        }
        acc.push(curr);
        return acc;
      }, []);
    }
    function buildNodes(segs) {
      const nodes = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        switch (seg.mode) {
          case Mode.NUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.ALPHANUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.KANJI:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
            break;
          case Mode.BYTE:
            nodes.push([
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
        }
      }
      return nodes;
    }
    function buildGraph(nodes, version) {
      const table = {};
      const graph = { start: {} };
      let prevNodeIds = ["start"];
      for (let i = 0; i < nodes.length; i++) {
        const nodeGroup = nodes[i];
        const currentNodeIds = [];
        for (let j = 0; j < nodeGroup.length; j++) {
          const node = nodeGroup[j];
          const key = "" + i + j;
          currentNodeIds.push(key);
          table[key] = { node, lastCount: 0 };
          graph[key] = {};
          for (let n = 0; n < prevNodeIds.length; n++) {
            const prevNodeId = prevNodeIds[n];
            if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
              graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
              table[prevNodeId].lastCount += node.length;
            } else {
              if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
              graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
            }
          }
        }
        prevNodeIds = currentNodeIds;
      }
      for (let n = 0; n < prevNodeIds.length; n++) {
        graph[prevNodeIds[n]].end = 0;
      }
      return { map: graph, table };
    }
    function buildSingleSegment(data, modesHint) {
      let mode;
      const bestMode = Mode.getBestModeForData(data);
      mode = Mode.from(modesHint, bestMode);
      if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
        throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
      }
      if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
        mode = Mode.BYTE;
      }
      switch (mode) {
        case Mode.NUMERIC:
          return new NumericData(data);
        case Mode.ALPHANUMERIC:
          return new AlphanumericData(data);
        case Mode.KANJI:
          return new KanjiData(data);
        case Mode.BYTE:
          return new ByteData(data);
      }
    }
    exports.fromArray = function fromArray(array) {
      return array.reduce(function(acc, seg) {
        if (typeof seg === "string") {
          acc.push(buildSingleSegment(seg, null));
        } else if (seg.data) {
          acc.push(buildSingleSegment(seg.data, seg.mode));
        }
        return acc;
      }, []);
    };
    exports.fromString = function fromString(data, version) {
      const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
      const nodes = buildNodes(segs);
      const graph = buildGraph(nodes, version);
      const path = dijkstra.find_path(graph.map, "start", "end");
      const optimizedSegs = [];
      for (let i = 1; i < path.length - 1; i++) {
        optimizedSegs.push(graph.table[path[i]].node);
      }
      return exports.fromArray(mergeSegments(optimizedSegs));
    };
    exports.rawSplit = function rawSplit(data) {
      return exports.fromArray(
        getSegmentsFromString(data, Utils.isKanjiModeEnabled())
      );
    };
  }
});

// node_modules/qrcode/lib/core/qrcode.js
var require_qrcode = __commonJS({
  "node_modules/qrcode/lib/core/qrcode.js"(exports) {
    var Utils = require_utils();
    var ECLevel = require_error_correction_level();
    var BitBuffer = require_bit_buffer();
    var BitMatrix = require_bit_matrix();
    var AlignmentPattern = require_alignment_pattern();
    var FinderPattern = require_finder_pattern();
    var MaskPattern = require_mask_pattern();
    var ECCode = require_error_correction_code();
    var ReedSolomonEncoder = require_reed_solomon_encoder();
    var Version = require_version();
    var FormatInfo = require_format_info();
    var Mode = require_mode();
    var Segments = require_segments();
    function setupFinderPattern(matrix, version) {
      const size = matrix.size;
      const pos = FinderPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -1; r <= 7; r++) {
          if (row + r <= -1 || size <= row + r) continue;
          for (let c = -1; c <= 7; c++) {
            if (col + c <= -1 || size <= col + c) continue;
            if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupTimingPattern(matrix) {
      const size = matrix.size;
      for (let r = 8; r < size - 8; r++) {
        const value = r % 2 === 0;
        matrix.set(r, 6, value, true);
        matrix.set(6, r, value, true);
      }
    }
    function setupAlignmentPattern(matrix, version) {
      const pos = AlignmentPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupVersionInfo(matrix, version) {
      const size = matrix.size;
      const bits = Version.getEncodedBits(version);
      let row, col, mod;
      for (let i = 0; i < 18; i++) {
        row = Math.floor(i / 3);
        col = i % 3 + size - 8 - 3;
        mod = (bits >> i & 1) === 1;
        matrix.set(row, col, mod, true);
        matrix.set(col, row, mod, true);
      }
    }
    function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
      const size = matrix.size;
      const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
      let i, mod;
      for (i = 0; i < 15; i++) {
        mod = (bits >> i & 1) === 1;
        if (i < 6) {
          matrix.set(i, 8, mod, true);
        } else if (i < 8) {
          matrix.set(i + 1, 8, mod, true);
        } else {
          matrix.set(size - 15 + i, 8, mod, true);
        }
        if (i < 8) {
          matrix.set(8, size - i - 1, mod, true);
        } else if (i < 9) {
          matrix.set(8, 15 - i - 1 + 1, mod, true);
        } else {
          matrix.set(8, 15 - i - 1, mod, true);
        }
      }
      matrix.set(size - 8, 8, 1, true);
    }
    function setupData(matrix, data) {
      const size = matrix.size;
      let inc = -1;
      let row = size - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!matrix.isReserved(row, col - c)) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              matrix.set(row, col - c, dark);
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || size <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    function createData(version, errorCorrectionLevel, segments) {
      const buffer = new BitBuffer();
      segments.forEach(function(data) {
        buffer.put(data.mode.bit, 4);
        buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
        data.write(buffer);
      });
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(0);
      }
      const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
      for (let i = 0; i < remainingByte; i++) {
        buffer.put(i % 2 ? 17 : 236, 8);
      }
      return createCodewords(buffer, version, errorCorrectionLevel);
    }
    function createCodewords(bitBuffer, version, errorCorrectionLevel) {
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewords = totalCodewords - ecTotalCodewords;
      const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
      const blocksInGroup2 = totalCodewords % ecTotalBlocks;
      const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
      const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
      const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
      const rs = new ReedSolomonEncoder(ecCount);
      let offset = 0;
      const dcData = new Array(ecTotalBlocks);
      const ecData = new Array(ecTotalBlocks);
      let maxDataSize = 0;
      const buffer = new Uint8Array(bitBuffer.buffer);
      for (let b = 0; b < ecTotalBlocks; b++) {
        const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
        dcData[b] = buffer.slice(offset, offset + dataSize);
        ecData[b] = rs.encode(dcData[b]);
        offset += dataSize;
        maxDataSize = Math.max(maxDataSize, dataSize);
      }
      const data = new Uint8Array(totalCodewords);
      let index = 0;
      let i, r;
      for (i = 0; i < maxDataSize; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          if (i < dcData[r].length) {
            data[index++] = dcData[r][i];
          }
        }
      }
      for (i = 0; i < ecCount; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          data[index++] = ecData[r][i];
        }
      }
      return data;
    }
    function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
      let segments;
      if (Array.isArray(data)) {
        segments = Segments.fromArray(data);
      } else if (typeof data === "string") {
        let estimatedVersion = version;
        if (!estimatedVersion) {
          const rawSegments = Segments.rawSplit(data);
          estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
        }
        segments = Segments.fromString(data, estimatedVersion || 40);
      } else {
        throw new Error("Invalid data");
      }
      const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
      if (!bestVersion) {
        throw new Error("The amount of data is too big to be stored in a QR Code");
      }
      if (!version) {
        version = bestVersion;
      } else if (version < bestVersion) {
        throw new Error(
          "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
        );
      }
      const dataBits = createData(version, errorCorrectionLevel, segments);
      const moduleCount = Utils.getSymbolSize(version);
      const modules = new BitMatrix(moduleCount);
      setupFinderPattern(modules, version);
      setupTimingPattern(modules);
      setupAlignmentPattern(modules, version);
      setupFormatInfo(modules, errorCorrectionLevel, 0);
      if (version >= 7) {
        setupVersionInfo(modules, version);
      }
      setupData(modules, dataBits);
      if (isNaN(maskPattern)) {
        maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        );
      }
      MaskPattern.applyMask(maskPattern, modules);
      setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
      return {
        modules,
        version,
        errorCorrectionLevel,
        maskPattern,
        segments
      };
    }
    exports.create = function create(data, options) {
      if (typeof data === "undefined" || data === "") {
        throw new Error("No input text");
      }
      let errorCorrectionLevel = ECLevel.M;
      let version;
      let mask;
      if (typeof options !== "undefined") {
        errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
        version = Version.from(options.version);
        mask = MaskPattern.from(options.maskPattern);
        if (options.toSJISFunc) {
          Utils.setToSJISFunction(options.toSJISFunc);
        }
      }
      return createSymbol(data, version, errorCorrectionLevel, mask);
    };
  }
});

// node_modules/qrcode/lib/renderer/utils.js
var require_utils2 = __commonJS({
  "node_modules/qrcode/lib/renderer/utils.js"(exports) {
    function hex2rgba(hex) {
      if (typeof hex === "number") {
        hex = hex.toString();
      }
      if (typeof hex !== "string") {
        throw new Error("Color should be defined as hex string");
      }
      let hexCode = hex.slice().replace("#", "").split("");
      if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
        throw new Error("Invalid hex color: " + hex);
      }
      if (hexCode.length === 3 || hexCode.length === 4) {
        hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
          return [c, c];
        }));
      }
      if (hexCode.length === 6) hexCode.push("F", "F");
      const hexValue = parseInt(hexCode.join(""), 16);
      return {
        r: hexValue >> 24 & 255,
        g: hexValue >> 16 & 255,
        b: hexValue >> 8 & 255,
        a: hexValue & 255,
        hex: "#" + hexCode.slice(0, 6).join("")
      };
    }
    exports.getOptions = function getOptions(options) {
      if (!options) options = {};
      if (!options.color) options.color = {};
      const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
      const width = options.width && options.width >= 21 ? options.width : void 0;
      const scale = options.scale || 4;
      return {
        width,
        scale: width ? 4 : scale,
        margin,
        color: {
          dark: hex2rgba(options.color.dark || "#000000ff"),
          light: hex2rgba(options.color.light || "#ffffffff")
        },
        type: options.type,
        rendererOpts: options.rendererOpts || {}
      };
    };
    exports.getScale = function getScale(qrSize, opts) {
      return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
    };
    exports.getImageWidth = function getImageWidth(qrSize, opts) {
      const scale = exports.getScale(qrSize, opts);
      return Math.floor((qrSize + opts.margin * 2) * scale);
    };
    exports.qrToImageData = function qrToImageData(imgData, qr, opts) {
      const size = qr.modules.size;
      const data = qr.modules.data;
      const scale = exports.getScale(size, opts);
      const symbolSize = Math.floor((size + opts.margin * 2) * scale);
      const scaledMargin = opts.margin * scale;
      const palette = [opts.color.light, opts.color.dark];
      for (let i = 0; i < symbolSize; i++) {
        for (let j = 0; j < symbolSize; j++) {
          let posDst = (i * symbolSize + j) * 4;
          let pxColor = opts.color.light;
          if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
            const iSrc = Math.floor((i - scaledMargin) / scale);
            const jSrc = Math.floor((j - scaledMargin) / scale);
            pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
          }
          imgData[posDst++] = pxColor.r;
          imgData[posDst++] = pxColor.g;
          imgData[posDst++] = pxColor.b;
          imgData[posDst] = pxColor.a;
        }
      }
    };
  }
});

// node_modules/qrcode/lib/renderer/canvas.js
var require_canvas = __commonJS({
  "node_modules/qrcode/lib/renderer/canvas.js"(exports) {
    var Utils = require_utils2();
    function clearCanvas(ctx, canvas, size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!canvas.style) canvas.style = {};
      canvas.height = size;
      canvas.width = size;
      canvas.style.height = size + "px";
      canvas.style.width = size + "px";
    }
    function getCanvasElement() {
      try {
        return document.createElement("canvas");
      } catch (e) {
        throw new Error("You need to specify a canvas element");
      }
    }
    exports.render = function render(qrData, canvas, options) {
      let opts = options;
      let canvasEl = canvas;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!canvas) {
        canvasEl = getCanvasElement();
      }
      opts = Utils.getOptions(opts);
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      const ctx = canvasEl.getContext("2d");
      const image = ctx.createImageData(size, size);
      Utils.qrToImageData(image.data, qrData, opts);
      clearCanvas(ctx, canvasEl, size);
      ctx.putImageData(image, 0, 0);
      return canvasEl;
    };
    exports.renderToDataURL = function renderToDataURL(qrData, canvas, options) {
      let opts = options;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!opts) opts = {};
      const canvasEl = exports.render(qrData, canvas, opts);
      const type = opts.type || "image/png";
      const rendererOpts = opts.rendererOpts || {};
      return canvasEl.toDataURL(type, rendererOpts.quality);
    };
  }
});

// node_modules/qrcode/lib/renderer/svg-tag.js
var require_svg_tag = __commonJS({
  "node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
    var Utils = require_utils2();
    function getColorAttrib(color, attrib) {
      const alpha = color.a / 255;
      const str = attrib + '="' + color.hex + '"';
      return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
    }
    function svgCmd(cmd, x, y) {
      let str = cmd + x;
      if (typeof y !== "undefined") str += " " + y;
      return str;
    }
    function qrToPath(data, size, margin) {
      let path = "";
      let moveBy = 0;
      let newRow = false;
      let lineLength = 0;
      for (let i = 0; i < data.length; i++) {
        const col = Math.floor(i % size);
        const row = Math.floor(i / size);
        if (!col && !newRow) newRow = true;
        if (data[i]) {
          lineLength++;
          if (!(i > 0 && col > 0 && data[i - 1])) {
            path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
            moveBy = 0;
            newRow = false;
          }
          if (!(col + 1 < size && data[i + 1])) {
            path += svgCmd("h", lineLength);
            lineLength = 0;
          }
        } else {
          moveBy++;
        }
      }
      return path;
    }
    exports.render = function render(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const qrcodesize = size + opts.margin * 2;
      const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
      const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
      const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
      const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
      const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path + "</svg>\n";
      if (typeof cb === "function") {
        cb(null, svgTag);
      }
      return svgTag;
    };
  }
});

// node_modules/qrcode/lib/browser.js
var require_browser = __commonJS({
  "node_modules/qrcode/lib/browser.js"(exports) {
    var canPromise = require_can_promise();
    var QRCode2 = require_qrcode();
    var CanvasRenderer = require_canvas();
    var SvgRenderer = require_svg_tag();
    function renderCanvas(renderFunc, canvas, text, opts, cb) {
      const args = [].slice.call(arguments, 1);
      const argsNum = args.length;
      const isLastArgCb = typeof args[argsNum - 1] === "function";
      if (!isLastArgCb && !canPromise()) {
        throw new Error("Callback required as last argument");
      }
      if (isLastArgCb) {
        if (argsNum < 2) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 2) {
          cb = text;
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 3) {
          if (canvas.getContext && typeof cb === "undefined") {
            cb = opts;
            opts = void 0;
          } else {
            cb = opts;
            opts = text;
            text = canvas;
            canvas = void 0;
          }
        }
      } else {
        if (argsNum < 1) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 1) {
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 2 && !canvas.getContext) {
          opts = text;
          text = canvas;
          canvas = void 0;
        }
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode2.create(text, opts);
            resolve(renderFunc(data, canvas, opts));
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode2.create(text, opts);
        cb(null, renderFunc(data, canvas, opts));
      } catch (e) {
        cb(e);
      }
    }
    exports.create = QRCode2.create;
    exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
    exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
    exports.toString = renderCanvas.bind(null, function(data, _, opts) {
      return SvgRenderer.render(data, opts);
    });
  }
});

// src/logic/constants.js
var BID_THRESHOLD_MINUTES = 30;
var WINDOW_SCHOOL_DAYS = 15;
var MONTHLY_BID_POSTING_MONTHS = [10, 11, 12, 1, 2, 3, 4];
var BUMP_DECISION_SCHOOL_DAYS = 2;
var BID_RESPONSE_SCHOOL_DAYS = 2;
var SEGMENTS = ["AM", "MIDDAY", "PM"];

// src/logic/createId.js
function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === "x" ? random : random & 3 | 8;
    return value.toString(16);
  });
}

// src/logic/timeUtils.js
function parseClockTime(time) {
  const trimmed = time.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid time format: "${time}". Expected H:MM or HH:MM.`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes < 0 || minutes > 59 || hours < 0 || hours > 23) {
    throw new Error(`Invalid time value: "${time}".`);
  }
  return hours * 60 + minutes;
}
function parseTimeRange(range) {
  const trimmed = range.trim();
  const parts = trimmed.split("-");
  if (parts.length !== 2) {
    throw new Error(
      `Invalid time range format: "${range}". Expected "H:MM-H:MM".`
    );
  }
  const startMinutes = parseClockTime(parts[0]);
  const endMinutes = parseClockTime(parts[1]);
  if (endMinutes <= startMinutes) {
    throw new Error(
      `Invalid time range: end must be after start in "${range}".`
    );
  }
  return {
    startMinutes,
    endMinutes,
    durationMinutes: endMinutes - startMinutes
  };
}
function computeDeltaMinutes(previousTime, newTime) {
  const previous = parseTimeRange(previousTime);
  const next = parseTimeRange(newTime);
  return next.durationMinutes - previous.durationMinutes;
}
function computeExactRouteDailyTotalMinutes(segments) {
  let total = 0;
  for (
    const key of
    /** @type {const} */
    ["AM", "MIDDAY", "PM"]
  ) {
    const range = segments?.[key];
    if (!range) continue;
    total += parseTimeRange(range).durationMinutes;
  }
  return total;
}
function roundToQuarterHourForPayroll(minutes) {
  if (typeof minutes !== "number" || Number.isNaN(minutes)) {
    throw new Error(`Expected a number of minutes, got: ${minutes}`);
  }
  return Math.round(minutes / 15) * 15 || 0;
}
function buildPayrollRoundingBreakdown(segments) {
  const detail = (
    /** @type {const} */
    ["AM", "MIDDAY", "PM"].map((segment) => {
      const time = segments?.[segment] ?? null;
      if (!time) {
        return { segment, time: null, duration_minutes: null, rounded_minutes: null };
      }
      const duration_minutes = parseTimeRange(time).durationMinutes;
      return {
        segment,
        time,
        duration_minutes,
        rounded_minutes: roundToQuarterHourForPayroll(duration_minutes)
      };
    })
  );
  const exact_total_minutes = computeExactRouteDailyTotalMinutes(segments);
  const rounded_piece_total = detail.reduce(
    (sum, segment) => sum + (segment.rounded_minutes ?? 0),
    0
  );
  return {
    segments: detail,
    exact_total_minutes,
    payroll_rounded_total_minutes: roundToQuarterHourForPayroll(rounded_piece_total)
  };
}
function scheduleDateForMath(value, anchor) {
  const text = value == null ? "" : String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(anchor ?? ""))) return anchor;
  return toDateString(/* @__PURE__ */ new Date());
}
function toDateString(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: "${value}".`);
  }
  return parsed.toISOString().slice(0, 10);
}

// src/logic/calendar.js
function getSchoolDays(calendarOrDays) {
  if (Array.isArray(calendarOrDays)) {
    if (calendarOrDays.length === 0) {
      throw new Error("School calendar must include school days.");
    }
    if (typeof calendarOrDays[0] === "string") {
      return [...calendarOrDays].map(toDateString).sort();
    }
    return extractSchoolDaysFromDayList(
      /** @type {SchoolCalendarDay[]} */
      calendarOrDays
    );
  }
  if (Array.isArray(calendarOrDays?.days) && calendarOrDays.days.length > 0) {
    return extractSchoolDaysFromDayList(calendarOrDays.days);
  }
  const legacy = calendarOrDays?.school_days;
  if (!Array.isArray(legacy) || legacy.length === 0) {
    throw new Error(
      "School calendar must include a non-empty days[] (with is_school_day) or school_days[] array."
    );
  }
  return [...legacy].map(toDateString).sort();
}
function extractSchoolDaysFromDayList(days) {
  const schoolDays = days.filter((entry) => entry && entry.is_school_day === true && entry.date).map((entry) => toDateString(entry.date));
  if (schoolDays.length === 0) {
    throw new Error(
      "School calendar days[] has no entries with is_school_day: true."
    );
  }
  return [...new Set(schoolDays)].sort();
}
function addSchoolDays(calendarOrDays, fromDate, count) {
  if (count < 0) {
    throw new Error("School day count must be non-negative.");
  }
  if (count === 0) {
    return toDateString(fromDate);
  }
  const schoolDays = getSchoolDays(calendarOrDays);
  const start = toDateString(fromDate);
  let remaining = count;
  for (const day of schoolDays) {
    if (day <= start) {
      continue;
    }
    remaining -= 1;
    if (remaining === 0) {
      return day;
    }
  }
  const last = schoolDays[schoolDays.length - 1] ?? "(empty)";
  throw new Error(
    `School calendar ends at ${last}; cannot count ${count} school day(s) after ${start} (only ${count - remaining} available). Extend school-calendar.json coverage.`
  );
}
function daysRemainingInWindow(calendarOrDays, asOfDate, windowExpiresDate) {
  if (!windowExpiresDate) {
    return null;
  }
  const today = toDateString(asOfDate);
  const expires = toDateString(windowExpiresDate);
  if (today > expires) {
    return 0;
  }
  const schoolDays = getSchoolDays(calendarOrDays);
  return schoolDays.filter((day) => day >= today && day <= expires).length;
}
function isWindowExpired(asOfDate, windowExpiresDate) {
  if (!windowExpiresDate) {
    return false;
  }
  return toDateString(asOfDate) > toDateString(windowExpiresDate);
}
function shiftCalendarDate(date, days) {
  const iso = toDateString(date);
  const utc = /* @__PURE__ */ new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(utc.getTime())) {
    throw new Error(`Invalid date: ${iso}`);
  }
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}
function previousCalendarDate(date) {
  return shiftCalendarDate(date, -1);
}
function nextCalendarDate(date) {
  return shiftCalendarDate(date, 1);
}

// src/logic/contractWindows.js
var BID_POSTING_MONTH_SET = new Set(MONTHLY_BID_POSTING_MONTHS);
function isForcedOctober1Contract(value) {
  if (value === true || value === 1) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "on" || text === "yes" || text === "true" || text === "1";
}
function forcedOctober1ContractPlan(changeDate) {
  const start = toDateString(changeDate);
  const oct1 = october1ForDate(start);
  return {
    regime: start < oct1 ? "pre_october_1" : "post_october_1",
    rule: "forced_october_1_contract",
    citation: "office override",
    ...openThroughDayBefore(oct1)
  };
}
function october1ForDate(date) {
  const iso = toDateString(date);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-10-01`;
}
function monthlyBidPostingDays(calendar) {
  const byMonth = /* @__PURE__ */ new Map();
  for (const day of getSchoolDays(calendar)) {
    const month = Number(day.slice(5, 7));
    if (!BID_POSTING_MONTH_SET.has(month)) {
      continue;
    }
    const key = day.slice(0, 7);
    const group = byMonth.get(key);
    if (group) {
      group.push(day);
    } else {
      byMonth.set(key, [day]);
    }
  }
  const posting = [];
  for (const group of byMonth.values()) {
    posting.push(...group.slice(-5));
  }
  return posting.sort();
}
function firstMonthlyBidPostingOnOrAfter(calendar, date) {
  const start = toDateString(date);
  const found = monthlyBidPostingDays(calendar).find((day) => day >= start);
  if (!found) {
    throw new Error(
      `No October\u2013April last-five-school-day bid posting date on or after ${start}. Extend school-calendar.json coverage.`
    );
  }
  return found;
}
function openThroughDayBefore(effectiveOn) {
  return {
    window_expires_date: previousCalendarDate(effectiveOn),
    becomes_effective_on: effectiveOn
  };
}
function contractWindowPlan(calendar, changeDate, drift) {
  const start = toDateString(changeDate);
  const oct1 = october1ForDate(start);
  const preOctober1 = start < oct1;
  const magnitude = Math.abs(drift);
  if (magnitude >= BID_THRESHOLD_MINUTES && drift < 0) {
    if (preOctober1) {
      const dates2 = openThroughDayBefore(start);
      return {
        regime: "pre_october_1",
        rule: "pre_october_1_bump",
        citation: "3.08(a)(8)(b)",
        ...dates2
      };
    }
    const fifteenth2 = addSchoolDays(calendar, start, WINDOW_SCHOOL_DAYS);
    return {
      regime: "post_october_1",
      rule: "post_october_1_bump",
      citation: "3.08(b)(2)",
      window_expires_date: fifteenth2,
      becomes_effective_on: nextCalendarDate(fifteenth2)
    };
  }
  if (magnitude >= BID_THRESHOLD_MINUTES) {
    const fifteenth2 = addSchoolDays(calendar, start, WINDOW_SCHOOL_DAYS);
    if (fifteenth2 < oct1) {
      return {
        regime: "pre_october_1",
        rule: "pre_october_1_bid",
        citation: "3.08(a)(8)(a)",
        window_expires_date: fifteenth2,
        becomes_effective_on: nextCalendarDate(fifteenth2)
      };
    }
    const postingDay = firstMonthlyBidPostingOnOrAfter(
      calendar,
      nextCalendarDate(fifteenth2)
    );
    const dates2 = openThroughDayBefore(postingDay);
    return {
      regime: preOctober1 ? "pre_october_1" : "post_october_1",
      rule: "post_october_1_bid",
      citation: "3.08(b)(1)",
      ...dates2
    };
  }
  if (preOctober1) {
    const dates2 = openThroughDayBefore(oct1);
    return {
      regime: "pre_october_1",
      rule: "pre_october_1_lock",
      citation: "3.08(a)(8)(c)",
      ...dates2
    };
  }
  const fifteenth = addSchoolDays(calendar, start, WINDOW_SCHOOL_DAYS);
  const effective = addSchoolDays(calendar, fifteenth, 1);
  const dates = openThroughDayBefore(effective);
  if (drift < 0) {
    return {
      regime: "post_october_1",
      rule: "post_october_1_decrease_lock",
      citation: "3.08(b)(4)",
      ...dates
    };
  }
  return {
    regime: "post_october_1",
    rule: "post_october_1_increase_lock",
    citation: "3.08(b)(3)",
    ...dates
  };
}

// src/logic/schoolCalendarGenerate.js
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];
function assertDate(day, label = "date") {
  if (typeof day !== "string" || !DATE_RE.test(day.trim())) {
    throw new Error(`Invalid ${label}: ${day}`);
  }
  const normalized = day.trim();
  const parsed = /* @__PURE__ */ new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`Invalid ${label}: ${day}`);
  }
  return normalized;
}
function utcDate(iso) {
  return /* @__PURE__ */ new Date(`${iso}T00:00:00.000Z`);
}
function isoFromUtc(d) {
  return d.toISOString().slice(0, 10);
}
function dayOfWeekName(iso) {
  return WEEKDAY_NAMES[utcDate(iso).getUTCDay()];
}
function defaultCoverageWindow(firstDay, lastDay) {
  const first = utcDate(firstDay);
  const last = utcDate(lastDay);
  const firstYear = first.getUTCFullYear();
  const lastYear = last.getUTCFullYear();
  const coverage_start = first.getUTCMonth() >= 6 ? `${firstYear}-07-01` : `${firstYear - 1}-07-01`;
  const coverage_end = last.getUTCMonth() <= 5 ? `${lastYear}-06-30` : `${lastYear + 1}-06-30`;
  if (coverage_end < coverage_start) {
    throw new Error("Computed coverage window is inverted \u2014 check first/last day.");
  }
  return {
    coverage_start,
    coverage_end,
    boundary_rule: "July 1 on or before first day of school through June 30 on or after last day of school (matches district year files). Outside that window is not generated."
  };
}
function validateGenerateSchoolYearInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Generation input is required.");
  }
  const first_day = assertDate(input.first_day, "first day of school");
  const last_day = assertDate(input.last_day, "last day of school");
  if (last_day < first_day) {
    throw new Error("Last day of school must be on or after the first day.");
  }
  const breaks = [];
  for (const raw of input.breaks ?? []) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Each break must be an object with start and end.");
    }
    const start = assertDate(raw.start, "break start");
    const end = assertDate(raw.end, "break end");
    if (end < start) {
      throw new Error(`Break end ${end} is before start ${start}.`);
    }
    breaks.push({
      start,
      end,
      label: typeof raw.label === "string" ? raw.label.trim() : ""
    });
  }
  const holidays = [];
  const holidaySeen = /* @__PURE__ */ new Set();
  for (const raw of input.holidays ?? []) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Each holiday must be an object with date.");
    }
    const date = assertDate(raw.date, "holiday date");
    if (holidaySeen.has(date)) {
      throw new Error(`Duplicate holiday date: ${date}`);
    }
    holidaySeen.add(date);
    holidays.push({
      date,
      label: typeof raw.label === "string" ? raw.label.trim() : ""
    });
  }
  let school_year = null;
  if (input.school_year != null && String(input.school_year).trim()) {
    school_year = String(input.school_year).trim();
  } else {
    const startY = utcDate(first_day).getUTCFullYear();
    const endY = utcDate(last_day).getUTCFullYear();
    school_year = startY === endY ? String(startY) : `${startY}-${String(endY).slice(-2)}`;
  }
  return { first_day, last_day, breaks, holidays, school_year };
}
function generateSchoolYearCalendar(rawInput) {
  const input = validateGenerateSchoolYearInput(rawInput);
  const coverage = defaultCoverageWindow(input.first_day, input.last_day);
  const holidayByDate = new Map(
    input.holidays.map((h) => [h.date, { label: h.label || "Holiday" }])
  );
  const days = [];
  let cursor = utcDate(coverage.coverage_start);
  const end = utcDate(coverage.coverage_end);
  let school_day_count = 0;
  let weekend_count = 0;
  let break_day_count = 0;
  let holiday_day_count = 0;
  let summer_day_count = 0;
  while (cursor <= end) {
    const date = isoFromUtc(cursor);
    const dow = cursor.getUTCDay();
    const day_of_week = dayOfWeekName(date);
    const inSchoolYear = date >= input.first_day && date <= input.last_day;
    let entry;
    if (!inSchoolYear) {
      entry = {
        date,
        day_of_week,
        is_school_day: false,
        reason: "Outside school year (summer)"
      };
      summer_day_count += 1;
    } else if (dow === 0 || dow === 6) {
      entry = {
        date,
        day_of_week,
        is_school_day: false,
        reason: "Weekend"
      };
      weekend_count += 1;
    } else {
      const holiday = holidayByDate.get(date);
      const breakHit = input.breaks.find((b) => date >= b.start && date <= b.end);
      if (holiday) {
        entry = {
          date,
          day_of_week,
          is_school_day: false,
          reason: holiday.label
        };
        holiday_day_count += 1;
      } else if (breakHit) {
        entry = {
          date,
          day_of_week,
          is_school_day: false,
          reason: breakHit.label || "Break"
        };
        break_day_count += 1;
      } else {
        entry = {
          date,
          day_of_week,
          is_school_day: true,
          reason: ""
        };
        school_day_count += 1;
      }
    }
    days.push(entry);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const school_days = days.filter((d) => d.is_school_day).map((d) => d.date);
  return {
    calendar: {
      school_year: input.school_year,
      coverage_start: coverage.coverage_start,
      coverage_end: coverage.coverage_end,
      days,
      school_days
    },
    summary: {
      first_day: input.first_day,
      last_day: input.last_day,
      school_day_count,
      weekend_count,
      break_day_count,
      holiday_day_count,
      summer_day_count,
      civil_day_count: days.length,
      breaks_applied: input.breaks.map((b) => ({
        start: b.start,
        end: b.end,
        label: b.label || "Break"
      })),
      holidays_applied: input.holidays.map((h) => ({
        date: h.date,
        label: h.label || "Holiday"
      }))
    },
    coverage_boundary: coverage
  };
}

// employee-tracker/src/bpsCalendar2026.js
var BPS_2026_2027_SOURCE = {
  name: "Boston Public Schools",
  school_year: "2026-2027",
  document: "SY26-27 BPS District Calendar",
  url: "https://www.bostonpublicschools.org"
};
var BPS_2026_2027_INPUT = {
  school_year: "2026-2027",
  first_day: "2026-09-08",
  last_day: "2027-06-22",
  breaks: [
    { start: "2026-11-26", end: "2026-11-27", label: "Thanksgiving Recess" },
    { start: "2026-12-24", end: "2027-01-01", label: "Winter Recess" },
    { start: "2027-02-16", end: "2027-02-19", label: "February Recess" },
    { start: "2027-04-20", end: "2027-04-23", label: "Spring Recess" }
  ],
  holidays: [
    { date: "2026-09-07", label: "Labor Day" },
    { date: "2026-10-12", label: "Indigenous Peoples\u2019 Day" },
    { date: "2026-11-11", label: "Veterans Day" },
    { date: "2027-01-04", label: "Teachers/paras report (students off)" },
    { date: "2027-01-18", label: "Martin Luther King Jr. Day" },
    { date: "2027-02-15", label: "Presidents\u2019 Day" },
    { date: "2027-03-26", label: "Good Friday" },
    { date: "2027-04-19", label: "Patriots\u2019 Day" },
    { date: "2027-05-31", label: "Memorial Day" },
    { date: "2027-06-18", label: "Juneteenth (observed)" }
  ]
};
function buildBps2026_2027Calendar() {
  const { calendar, summary } = generateSchoolYearCalendar(BPS_2026_2027_INPUT);
  return {
    calendar: {
      ...calendar,
      district: BPS_2026_2027_SOURCE.name,
      source_document: BPS_2026_2027_SOURCE.document
    },
    summary,
    source: BPS_2026_2027_SOURCE
  };
}

// employee-tracker/src/clockTimes.js
function normalizeClockTime(time) {
  const minutes = parseClockTime(String(time ?? "").trim());
  return formatClockMinutes(minutes);
}
function formatClockMinutes(minutesSinceMidnight) {
  if (typeof minutesSinceMidnight !== "number" || Number.isNaN(minutesSinceMidnight) || minutesSinceMidnight < 0 || minutesSinceMidnight >= 24 * 60) {
    throw new Error(`Invalid minutes value: ${minutesSinceMidnight}`);
  }
  const hours = Math.floor(minutesSinceMidnight / 60);
  const minutes = minutesSinceMidnight % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
function formatSegmentRange(clockIn, clockOut) {
  return `${normalizeClockTime(clockIn)}-${normalizeClockTime(clockOut)}`;
}
function splitSegmentRange(range) {
  if (!range || !String(range).trim()) {
    return null;
  }
  const parsed = parseTimeRange(range);
  return {
    clock_in: formatClockMinutes(parsed.startMinutes),
    clock_out: formatClockMinutes(parsed.endMinutes),
    range: `${formatClockMinutes(parsed.startMinutes)}-${formatClockMinutes(parsed.endMinutes)}`,
    duration_minutes: parsed.durationMinutes
  };
}
function formatDurationLabel(minutes) {
  if (typeof minutes !== "number" || Number.isNaN(minutes)) {
    return "\u2014";
  }
  const sign = minutes < 0 ? "\u2212" : "";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (hours === 0) {
    return `${sign}${mins} min`;
  }
  if (mins === 0) {
    return `${sign}${hours} hr`;
  }
  return `${sign}${hours} hr ${mins} min`;
}
function dayAfter(iso) {
  const parsed = /* @__PURE__ */ new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${iso}`);
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}
function localDateString(date = /* @__PURE__ */ new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// src/logic/changeReport.js
function buildSeeTheMathFromSegments(before_segments, after_segments) {
  const before = buildPayrollRoundingBreakdown(before_segments);
  const after = buildPayrollRoundingBreakdown(after_segments);
  const contracted_hours_delta_minutes = after.payroll_rounded_total_minutes - before.payroll_rounded_total_minutes;
  const contracted_hours_changed = contracted_hours_delta_minutes !== 0;
  const schedule_changed = before.exact_total_minutes !== after.exact_total_minutes;
  let statement;
  if (contracted_hours_changed) {
    const sign = contracted_hours_delta_minutes > 0 ? "+" : "";
    statement = `Contracted hours changed by ${sign}${contracted_hours_delta_minutes} minutes (${before.payroll_rounded_total_minutes} \u2192 ${after.payroll_rounded_total_minutes}).`;
  } else if (schedule_changed) {
    statement = `Schedule changed (exact total ${before.exact_total_minutes} \u2192 ${after.exact_total_minutes} minutes), but contracted hours did not change because both totals round to the same quarter-hour figure (${after.payroll_rounded_total_minutes} minutes).`;
  } else {
    statement = `Contracted hours unchanged at ${after.payroll_rounded_total_minutes} minutes (schedule total also unchanged).`;
  }
  return {
    before,
    after,
    statement,
    contracted_hours_changed,
    contracted_hours_delta_minutes
  };
}
function buildChangeReport(input) {
  const math = buildSeeTheMathFromSegments(
    input.before_segments,
    input.after_segments
  );
  const changes = input.contributing_changes.map((change2) => ({
    id: change2.id,
    start_date: change2.effective_date,
    segment: change2.segment,
    previous_time: change2.previous_time,
    new_time: change2.new_time,
    delta_minutes: typeof change2.effective_delta_minutes === "number" ? change2.effective_delta_minutes : change2.delta_minutes,
    entered_by: change2.entered_by,
    note: change2.note
  }));
  return {
    id: createId(),
    route_id: input.route_id,
    driver_name: input.driver_name?.trim() || null,
    driver_id: input.driver_id ?? null,
    outcome: input.outcome,
    finalized_at: input.finalized_at,
    window_opened_date: input.window_opened_date,
    contributing_changes: changes,
    before: {
      segments: input.before_segments,
      math: math.before
    },
    after: {
      segments: input.after_segments,
      math: math.after
    },
    contracted_hours_changed: math.contracted_hours_changed,
    contracted_hours_delta_minutes: math.contracted_hours_delta_minutes,
    contracted_hours_statement: math.statement,
    ...input.forced_october_1 ? { forced_october_1: true } : {},
    // Alias for the shared "see the math" UI (after-state is the finalized schedule).
    see_the_math: {
      before: math.before,
      after: math.after,
      statement: math.statement
    }
  };
}
function changeReportMatchKey(report) {
  const ids = (report.contributing_changes ?? []).map((change2) => change2.id).filter(Boolean).sort().join(",");
  return `${report.outcome ?? ""}|${report.window_opened_date ?? ""}|${ids}`;
}

// src/logic/stateMachine.js
function isAdjustmentEvent(entry) {
  return entry?.type === "ADJUSTMENT";
}
function isReassignmentEvent(entry) {
  return entry?.type === "REASSIGNMENT";
}
function isBulkImportEvent(entry) {
  return entry?.type === "BULK_IMPORT";
}
function isNeedsReviewResolutionEvent(entry) {
  return entry?.type === "NEEDS_REVIEW_RESOLUTION";
}
function isBumpDecisionEvent(entry) {
  return entry?.type === "BUMP_DECISION";
}
function isSeniorityTieResolutionEvent(entry) {
  return entry?.type === "SENIORITY_TIE_RESOLUTION";
}
function isChangeEvent(entry) {
  return !isAdjustmentEvent(entry) && !isReassignmentEvent(entry) && !isBulkImportEvent(entry) && !isNeedsReviewResolutionEvent(entry) && !isBumpDecisionEvent(entry) && !isSeniorityTieResolutionEvent(entry);
}
function resolutionMatchesDiscrepancy(resolution, discrepancy) {
  return (resolution.causing_adjustment_id ?? null) === (discrepancy.causing_adjustment_id ?? null) && resolution.previous_finalized_status === discrepancy.previous_finalized_status && resolution.computed_status === discrepancy.computed_status;
}
function findMatchingNeedsReviewResolution(changeLog, routeId, discrepancy) {
  const matches = changeLog.filter(isNeedsReviewResolutionEvent).map((entry) => (
    /** @type {NeedsReviewResolutionEvent} */
    entry
  )).filter((entry) => entry.route_id === routeId).filter((entry) => resolutionMatchesDiscrepancy(entry, discrepancy)).sort((a, b) => a.resolved_at.localeCompare(b.resolved_at));
  return matches.at(-1) ?? null;
}
function resolveDriverAssignment(changeLog, routeId, asOfTimestamp) {
  let best = {
    found: false,
    driver_id: null,
    driver_name: null,
    at: null
  };
  for (const entry of changeLog) {
    if (isChangeEvent(entry)) {
      const change2 = (
        /** @type {ChangeEvent} */
        entry
      );
      if (change2.route_id !== routeId) continue;
      const at = change2.submitted_at;
      if (!at || at > asOfTimestamp) continue;
      if (!best.at || at >= best.at) {
        best = {
          found: true,
          driver_id: change2.driver_id ?? null,
          driver_name: change2.driver_name?.trim() || null,
          at
        };
      }
      continue;
    }
    if (isReassignmentEvent(entry)) {
      const reassignment = (
        /** @type {ReassignmentEvent} */
        entry
      );
      if (reassignment.route_id !== routeId) continue;
      const at = reassignment.reassigned_at;
      if (!at || at > asOfTimestamp) continue;
      if (!best.at || at >= best.at) {
        best = {
          found: true,
          driver_id: reassignment.new_driver_id ?? null,
          driver_name: reassignment.new_driver_name?.trim() || null,
          at
        };
      }
    }
  }
  return best;
}
function asOfInclusiveTimestamp(asOfDate) {
  if (asOfDate instanceof Date) {
    return asOfDate.toISOString();
  }
  const trimmed = String(asOfDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T23:59:59.999Z`;
  }
  return new Date(trimmed).toISOString();
}
function applyResolvedDrivers(routeStateMap, changeLog, asOfDate) {
  const asOfIso = asOfInclusiveTimestamp(asOfDate);
  const updated = {};
  for (const [routeId, entry] of Object.entries(routeStateMap)) {
    const resolved = resolveDriverAssignment(changeLog, routeId, asOfIso);
    if (!resolved.found) {
      updated[routeId] = entry;
      continue;
    }
    updated[routeId] = {
      ...cloneRouteState(entry),
      driver_id: resolved.driver_id,
      driver_name: resolved.driver_name
    };
  }
  return updated;
}
function emptySegments() {
  return { AM: null, MIDDAY: null, PM: null };
}
function cloneRouteState(routeState) {
  return {
    ...routeState,
    segments: { ...routeState.segments },
    baseline_segments: { ...routeState.baseline_segments },
    contributing_change_ids: [...routeState.contributing_change_ids],
    pending_change_ids: [...routeState.pending_change_ids ?? []],
    review_history: [...routeState.review_history ?? []],
    change_reports: [...routeState.change_reports ?? []],
    reconciliation: routeState.reconciliation ? { ...routeState.reconciliation } : null
  };
}
function createInitialRouteState(changeEvent) {
  const segments = emptySegments();
  const baseline_segments = emptySegments();
  segments[changeEvent.segment] = changeEvent.previous_time;
  baseline_segments[changeEvent.segment] = changeEvent.previous_time;
  return {
    driver_name: changeEvent.driver_name?.trim() || null,
    driver_id: changeEvent.driver_id ?? null,
    segments,
    baseline_segments,
    status: "STABLE",
    window_opened_date: null,
    window_expires_date: null,
    window_rule: null,
    cumulative_drift_minutes: 0,
    contributing_change_ids: [],
    payroll_rounded_total_minutes: null,
    bump_decision_due_date: null,
    bump_chain_id: null,
    bump_chain_link: null,
    bump_kind: null,
    bid_response_due_date: null,
    bid_signup: null,
    reconciliation: null,
    pending_change_ids: [],
    review_history: [],
    change_reports: [],
    last_updated: changeEvent.submitted_at
  };
}
function windowFinalizationOutcome(exactDrift) {
  if (Math.abs(exactDrift) < BID_THRESHOLD_MINUTES) {
    return "STABLE";
  }
  return exactDrift > 0 ? "BID_PENDING" : "BUMP_ELIGIBLE";
}
function applyWindowExpiration(routeState, asOfDate, options = {}) {
  if (routeState.status !== "ACCUMULATING" && routeState.status !== "BID_PENDING" && routeState.status !== "BUMP_ELIGIBLE") {
    return routeState;
  }
  if (!isWindowExpired(asOfDate, routeState.window_expires_date)) {
    return routeState;
  }
  const state = cloneRouteState(routeState);
  const exactDrift = state.cumulative_drift_minutes;
  const payrollBreakdown = buildPayrollRoundingBreakdown(state.segments);
  const payrollRoundedTotal = payrollBreakdown.payroll_rounded_total_minutes;
  const forcedOctober1 = state.window_rule === "forced_october_1_contract";
  const outcome = forcedOctober1 ? "STABLE" : windowFinalizationOutcome(exactDrift);
  const closedOn = nextCalendarDate(state.window_expires_date);
  if (options.changeLog && options.routeId) {
    const effectiveDeltas = options.effectiveDeltas ?? resolveEffectiveDeltas(options.changeLog);
    const byId = /* @__PURE__ */ new Map();
    for (const entry of options.changeLog) {
      if (isChangeEvent(entry)) {
        byId.set(
          entry.id,
          /** @type {ChangeEvent} */
          entry
        );
      }
    }
    const contributing_changes = state.contributing_change_ids.map((id) => {
      const change2 = byId.get(id);
      if (!change2) return null;
      return {
        ...change2,
        effective_delta_minutes: effectiveDeltas.has(id) ? effectiveDeltas.get(id) : change2.delta_minutes
      };
    }).filter(Boolean);
    const finalized_at = `${closedOn}T00:00:00.000Z`;
    const resolved = resolveDriverAssignment(
      options.changeLog,
      options.routeId,
      finalized_at
    );
    const reportDriverName = resolved.found ? resolved.driver_name : state.driver_name;
    const reportDriverId = resolved.found ? resolved.driver_id : state.driver_id ?? null;
    const report = buildChangeReport({
      route_id: options.routeId,
      driver_name: reportDriverName,
      driver_id: reportDriverId,
      outcome,
      finalized_at,
      window_opened_date: state.window_opened_date,
      before_segments: { ...state.baseline_segments },
      after_segments: { ...state.segments },
      contributing_changes,
      forced_october_1: forcedOctober1
    });
    state.change_reports = [...state.change_reports ?? [], report];
    if (resolved.found) {
      state.driver_id = resolved.driver_id;
      state.driver_name = resolved.driver_name;
    }
  }
  if (outcome === "STABLE") {
    state.baseline_segments = { ...state.segments };
    state.status = "STABLE";
    state.payroll_rounded_total_minutes = payrollRoundedTotal;
    state.cumulative_drift_minutes = 0;
    state.window_opened_date = null;
    state.window_expires_date = null;
    state.window_rule = null;
    state.contributing_change_ids = [];
    state.bump_decision_due_date = null;
    state.bump_chain_id = null;
    state.bump_chain_link = null;
    state.bump_kind = null;
    state.bid_response_due_date = null;
    state.bid_signup = null;
  } else if (outcome === "BID_PENDING") {
    state.status = "BID_PENDING";
    state.payroll_rounded_total_minutes = payrollRoundedTotal;
    state.window_opened_date = null;
    state.window_expires_date = null;
    state.window_rule = null;
    state.bump_decision_due_date = null;
    state.bump_chain_id = null;
    state.bump_chain_link = null;
    state.bump_kind = null;
    if (options.schoolCalendar) {
      state.bid_response_due_date = addSchoolDays(
        options.schoolCalendar,
        closedOn,
        BID_RESPONSE_SCHOOL_DAYS
      );
    } else {
      state.bid_response_due_date = null;
    }
  } else {
    state.status = "BUMP_ELIGIBLE";
    state.payroll_rounded_total_minutes = payrollRoundedTotal;
    state.window_opened_date = null;
    state.window_expires_date = null;
    state.window_rule = null;
    if (options.schoolCalendar) {
      state.bump_decision_due_date = addSchoolDays(
        options.schoolCalendar,
        closedOn,
        BUMP_DECISION_SCHOOL_DAYS
      );
    } else {
      state.bump_decision_due_date = null;
    }
    state.bid_response_due_date = null;
  }
  return state;
}
function hasOpenAccumulationWindow(routeState, asOfDate) {
  if (routeState.status !== "ACCUMULATING" && routeState.status !== "BID_PENDING" && routeState.status !== "BUMP_ELIGIBLE") {
    return false;
  }
  return !!routeState.window_expires_date && !isWindowExpired(asOfDate, routeState.window_expires_date);
}
function resolveEffectiveDeltas(changeLog) {
  const deltas = /* @__PURE__ */ new Map();
  for (const entry of changeLog) {
    if (isChangeEvent(entry)) {
      const change2 = (
        /** @type {ChangeEvent} */
        entry
      );
      deltas.set(change2.id, change2.delta_minutes);
    }
  }
  const adjustments = changeLog.filter(isAdjustmentEvent).map((entry) => (
    /** @type {AdjustmentEvent} */
    entry
  )).sort((a, b) => a.adjusted_at.localeCompare(b.adjusted_at));
  for (const adjustment of adjustments) {
    deltas.set(adjustment.target_change_id, adjustment.new_delta);
  }
  return deltas;
}
function forcesOctober1Contract(changeEvent) {
  return isForcedOctober1Contract(changeEvent?.force_oct1_contract);
}
function applyChangeToRoute(routeState, changeEvent, schoolCalendar, asOfDate = changeEvent.effective_date, deltaOverride = void 0, options = {}) {
  const changeDate = toDateString(asOfDate);
  const isFirstEvent = !routeState;
  let state = routeState ? cloneRouteState(routeState) : createInitialRouteState(changeEvent);
  state = applyWindowExpiration(state, changeDate, {
    routeId: changeEvent.route_id,
    changeLog: options.changeLog,
    effectiveDeltas: options.effectiveDeltas,
    schoolCalendar
  });
  state.driver_name = changeEvent.driver_name?.trim() || null;
  if (changeEvent.driver_id) {
    state.driver_id = changeEvent.driver_id;
  } else if (isFirstEvent) {
    state.driver_id = null;
  }
  state.segments[changeEvent.segment] = changeEvent.new_time;
  state.last_updated = changeEvent.submitted_at;
  const delta = typeof deltaOverride === "number" ? deltaOverride : changeEvent.delta_minutes;
  if (delta === 0 && changeEvent.previous_time === changeEvent.new_time) {
    if (state.status === "STABLE") {
      state.baseline_segments[changeEvent.segment] = changeEvent.new_time;
    }
    return state;
  }
  if (hasOpenAccumulationWindow(state, changeDate)) {
    state.cumulative_drift_minutes += delta;
    state.contributing_change_ids.push(changeEvent.id);
    if ((state.status === "BID_PENDING" || state.status === "BUMP_ELIGIBLE") && Math.abs(state.cumulative_drift_minutes) < BID_THRESHOLD_MINUTES) {
      state.status = "ACCUMULATING";
      state.bump_decision_due_date = null;
      state.bump_chain_id = null;
      state.bump_chain_link = null;
      state.bump_kind = null;
      state.bid_response_due_date = null;
      state.bid_signup = null;
    }
  } else {
    state.status = "ACCUMULATING";
    state.window_opened_date = changeDate;
    state.cumulative_drift_minutes = delta;
    state.contributing_change_ids = [changeEvent.id];
    state.bump_decision_due_date = null;
    state.bump_chain_id = null;
    state.bump_chain_link = null;
    state.bump_kind = null;
    state.bid_response_due_date = null;
    state.bid_signup = null;
  }
  const plan = forcesOctober1Contract(changeEvent) ? forcedOctober1ContractPlan(changeDate) : contractWindowPlan(
    schoolCalendar,
    changeDate,
    state.cumulative_drift_minutes
  );
  state.window_expires_date = plan.window_expires_date;
  state.window_rule = plan.rule;
  return applyWindowExpiration(state, changeDate, {
    routeId: changeEvent.route_id,
    changeLog: options.changeLog,
    effectiveDeltas: options.effectiveDeltas,
    schoolCalendar
  });
}
function applyAllWindowExpirations(routeStateMap, asOfDate, options = {}) {
  const updated = {};
  for (const [routeId, entry] of Object.entries(routeStateMap)) {
    updated[routeId] = applyWindowExpiration(entry, asOfDate, {
      routeId,
      changeLog: options.changeLog,
      effectiveDeltas: options.effectiveDeltas,
      schoolCalendar: options.schoolCalendar
    });
  }
  return updated;
}
function isFinalizedRouteEntry(entry) {
  if (!entry) {
    return false;
  }
  if (entry.status === "BID_PENDING" || entry.status === "BUMP_ELIGIBLE" || entry.status === "NEEDS_REVIEW") {
    return true;
  }
  return entry.status === "STABLE" && entry.payroll_rounded_total_minutes != null;
}
function getPreviousFinalizedStatus(entry) {
  if (entry.status === "NEEDS_REVIEW") {
    return entry.reconciliation?.previous_finalized_status ?? null;
  }
  if (entry.status === "BID_PENDING") {
    return "BID_PENDING";
  }
  if (entry.status === "BUMP_ELIGIBLE") {
    return "BUMP_ELIGIBLE";
  }
  if (entry.status === "STABLE" && entry.payroll_rounded_total_minutes != null) {
    return "STABLE";
  }
  return null;
}
function findCausingAdjustment(changeLog, routeId) {
  const changeIds = new Set(
    changeLog.filter(isChangeEvent).map((entry) => (
      /** @type {ChangeEvent} */
      entry
    )).filter((change2) => change2.route_id === routeId).map((change2) => change2.id)
  );
  const adjustments = changeLog.filter(isAdjustmentEvent).map((entry) => (
    /** @type {AdjustmentEvent} */
    entry
  )).filter((adjustment) => changeIds.has(adjustment.target_change_id)).sort((a, b) => a.adjusted_at.localeCompare(b.adjusted_at));
  return adjustments.at(-1) ?? null;
}
function getReviewHoldAfter(prior) {
  if (!prior || prior.status !== "NEEDS_REVIEW") {
    return null;
  }
  return prior.reconciliation?.raised_at ?? prior.last_updated;
}
function splitBaseAndPendingChanges(routeChanges, holdAfter) {
  if (!holdAfter) {
    return { base: routeChanges, pending: [] };
  }
  return {
    base: routeChanges.filter((change2) => change2.submitted_at <= holdAfter),
    pending: routeChanges.filter((change2) => change2.submitted_at > holdAfter)
  };
}
function applyPendingChanges(routeState, pendingChanges, schoolCalendar, effectiveDeltas = /* @__PURE__ */ new Map(), asOfDate = /* @__PURE__ */ new Date(), options = {}) {
  let state = cloneRouteState(routeState);
  state.pending_change_ids = [];
  state.reconciliation = null;
  const ordered = [...pendingChanges].sort(
    (a, b) => a.submitted_at.localeCompare(b.submitted_at)
  );
  const reportOptions = {
    changeLog: options.changeLog,
    effectiveDeltas
  };
  for (const change2 of ordered) {
    const delta = effectiveDeltas.has(change2.id) ? effectiveDeltas.get(change2.id) : change2.delta_minutes;
    state = applyChangeToRoute(
      state,
      change2,
      schoolCalendar,
      change2.effective_date,
      delta,
      reportOptions
    );
  }
  return applyWindowExpiration(state, asOfDate, {
    routeId: ordered[0]?.route_id,
    schoolCalendar,
    ...reportOptions
  });
}
function toIsoTimestamp(asOfDate) {
  if (asOfDate instanceof Date) {
    return asOfDate.toISOString();
  }
  const trimmed = String(asOfDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }
  return new Date(trimmed).toISOString();
}
function reconcileFinalizedStatusFlips(priorRouteState, computedRouteState, changeLog, options = {}) {
  const lettersByRouteId = options.lettersByRouteId ?? {};
  const pendingByRoute = options.pendingByRoute ?? {};
  const schoolCalendar = options.schoolCalendar;
  const effectiveDeltas = options.effectiveDeltas ?? /* @__PURE__ */ new Map();
  const asOfDate = options.asOfDate ?? /* @__PURE__ */ new Date();
  const resolvedAt = toIsoTimestamp(asOfDate);
  const result = { ...computedRouteState };
  const routeIds = /* @__PURE__ */ new Set([
    ...Object.keys(priorRouteState),
    ...Object.keys(computedRouteState)
  ]);
  for (const routeId of routeIds) {
    const prior = priorRouteState[routeId];
    const computed = computedRouteState[routeId];
    if (!prior || !computed) {
      continue;
    }
    if (!isFinalizedRouteEntry(prior)) {
      continue;
    }
    const previousFinalized = getPreviousFinalizedStatus(prior);
    const computedStatus = computed.status;
    if (!previousFinalized) {
      continue;
    }
    const pending = pendingByRoute[routeId] ?? [];
    const causing = findCausingAdjustment(changeLog, routeId);
    const discrepancy = {
      causing_adjustment_id: causing?.id ?? null,
      previous_finalized_status: previousFinalized,
      computed_status: computedStatus
    };
    const adminResolution = findMatchingNeedsReviewResolution(
      changeLog,
      routeId,
      discrepancy
    );
    if (computedStatus === previousFinalized) {
      let historyNote = null;
      if (prior.status === "NEEDS_REVIEW") {
        historyNote = {
          event: "NEEDS_REVIEW_SELF_RESOLVED",
          previous_flag_raised_at: prior.reconciliation?.raised_at ?? null,
          resolved_at: resolvedAt,
          causing_adjustment_id: causing?.id ?? prior.reconciliation?.causing_adjustment_id ?? null
        };
      }
      let next = {
        ...computed,
        reconciliation: null,
        pending_change_ids: [],
        review_history: [
          ...prior.review_history ?? [],
          ...historyNote ? [historyNote] : []
        ]
      };
      if (pending.length > 0 && schoolCalendar) {
        next = applyPendingChanges(
          next,
          pending,
          schoolCalendar,
          effectiveDeltas,
          asOfDate,
          { changeLog }
        );
        next.review_history = [
          ...prior.review_history ?? [],
          ...historyNote ? [historyNote] : []
        ];
      }
      result[routeId] = next;
      continue;
    }
    if (adminResolution?.resolution === "keep_prior") {
      const historyNote = historyNoteFromResolution(prior, adminResolution);
      result[routeId] = {
        ...cloneRouteState(prior),
        status: previousFinalized,
        reconciliation: null,
        pending_change_ids: [],
        review_history: withAdminHistory(prior, historyNote),
        bump_decision_due_date: previousFinalized === "BUMP_ELIGIBLE" ? prior.bump_decision_due_date ?? null : null,
        bump_chain_id: previousFinalized === "BUMP_ELIGIBLE" ? prior.bump_chain_id ?? null : null,
        bump_chain_link: previousFinalized === "BUMP_ELIGIBLE" ? prior.bump_chain_link ?? null : null,
        bump_kind: previousFinalized === "BUMP_ELIGIBLE" ? prior.bump_kind ?? "original_decrease" : null
      };
      continue;
    }
    if (adminResolution?.resolution === "accept_computed") {
      const historyNote = historyNoteFromResolution(prior, adminResolution);
      let next = {
        ...computed,
        reconciliation: null,
        pending_change_ids: [],
        review_history: withAdminHistory(prior, historyNote)
      };
      if (pending.length > 0 && schoolCalendar) {
        next = applyPendingChanges(
          next,
          pending,
          schoolCalendar,
          effectiveDeltas,
          asOfDate,
          { changeLog }
        );
        next.review_history = withAdminHistory(prior, historyNote);
      }
      result[routeId] = next;
      continue;
    }
    if (computedStatus !== "STABLE" && computedStatus !== "BID_PENDING" && computedStatus !== "BUMP_ELIGIBLE" && computedStatus !== "ACCUMULATING") {
      continue;
    }
    const letterOrActionExists = lettersByRouteId[routeId] === true;
    const raisedAt = prior.status === "NEEDS_REVIEW" ? prior.reconciliation?.raised_at ?? prior.last_updated : causing?.adjusted_at ?? resolvedAt;
    result[routeId] = {
      ...cloneRouteState(prior),
      status: "NEEDS_REVIEW",
      pending_change_ids: pending.map((change2) => change2.id),
      review_history: [...prior.review_history ?? []],
      reconciliation: {
        previous_finalized_status: previousFinalized,
        computed_status: computedStatus,
        computed_cumulative_drift_minutes: computed.cumulative_drift_minutes,
        computed_payroll_rounded_total_minutes: computed.payroll_rounded_total_minutes,
        causing_adjustment_id: causing?.id ?? null,
        letter_or_action_exists: letterOrActionExists,
        raised_at: raisedAt
      },
      last_updated: computed.last_updated
    };
  }
  return result;
}
function historyNoteFromResolution(prior, resolution) {
  return {
    event: "NEEDS_REVIEW_ADMIN_RESOLVED",
    resolution: resolution.resolution,
    previous_flag_raised_at: prior.status === "NEEDS_REVIEW" ? prior.reconciliation?.raised_at ?? null : null,
    resolved_at: resolution.resolved_at,
    causing_adjustment_id: resolution.causing_adjustment_id ?? null,
    resolved_by: resolution.resolved_by ?? null,
    resolution_event_id: resolution.id,
    note: resolution.note ?? null
  };
}
function withAdminHistory(prior, historyNote) {
  const existing = [...prior.review_history ?? []];
  if (historyNote.resolution_event_id && existing.some(
    (item) => item.resolution_event_id === historyNote.resolution_event_id
  )) {
    return existing;
  }
  return [...existing, historyNote];
}
function rebuildRouteStateFromChangeLog(changeLog, initialState = {}, schoolCalendar, asOfDate = /* @__PURE__ */ new Date(), options = {}) {
  const effectiveDeltas = resolveEffectiveDeltas(changeLog);
  const priorRouteState = options.priorRouteState ?? {};
  const changesByRoute = {};
  for (const entry of changeLog) {
    if (!isChangeEvent(entry)) continue;
    const change2 = (
      /** @type {ChangeEvent} */
      entry
    );
    if (!changesByRoute[change2.route_id]) changesByRoute[change2.route_id] = [];
    changesByRoute[change2.route_id].push(change2);
  }
  const anchorByRoute = {};
  for (const [routeId, routeChanges] of Object.entries(changesByRoute)) {
    const anchor = routeChanges.map((change2) => String(change2.effective_date ?? "").trim()).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()[0] || toDateString(asOfDate);
    anchorByRoute[routeId] = anchor;
    routeChanges.sort((a, b) => {
      const dateCompare = scheduleDateForMath(a.effective_date, anchor).localeCompare(
        scheduleDateForMath(b.effective_date, anchor)
      );
      if (dateCompare !== 0) return dateCompare;
      return a.submitted_at.localeCompare(b.submitted_at);
    });
  }
  const pendingByRoute = {};
  let state = { ...initialState };
  for (const [routeId, routeChanges] of Object.entries(changesByRoute)) {
    const holdAfter = getReviewHoldAfter(priorRouteState[routeId]);
    const { base, pending } = splitBaseAndPendingChanges(routeChanges, holdAfter);
    pendingByRoute[routeId] = pending;
    const reportOptions = { changeLog, effectiveDeltas };
    for (const change2 of base) {
      const effectiveDelta = effectiveDeltas.has(change2.id) ? effectiveDeltas.get(change2.id) : change2.delta_minutes;
      state[routeId] = applyChangeToRoute(
        state[routeId],
        change2,
        schoolCalendar,
        scheduleDateForMath(change2.effective_date, anchorByRoute[routeId]),
        effectiveDelta,
        reportOptions
      );
    }
  }
  const computed = applyAllWindowExpirations(state, asOfDate, {
    changeLog,
    effectiveDeltas,
    schoolCalendar
  });
  if (!options.priorRouteState) {
    return applyResolvedDrivers(computed, changeLog, asOfDate);
  }
  return applyResolvedDrivers(
    reconcileFinalizedStatusFlips(
      priorRouteState,
      computed,
      changeLog,
      {
        lettersByRouteId: options.lettersByRouteId,
        pendingByRoute,
        schoolCalendar,
        effectiveDeltas,
        asOfDate
      }
    ),
    changeLog,
    asOfDate
  );
}

// employee-tracker/src/snapshot.js
var EMPLOYEE_ROUTE_ID = "SELF";
var STATUS_COPY = {
  STABLE: {
    label: "Stable",
    summary: "No open review window. Your contracted hours match the last time they were automatically contracted (or your starting schedule)."
  },
  ACCUMULATING: {
    label: "Accumulating",
    summary: "A review window is open. Further changes reset it and add the exact minute difference. When it closes, these times become contracted \u2014 or go to bid/bump if the difference is 30 minutes or more."
  },
  BID_PENDING: {
    label: "Bid pending",
    summary: "The window closed with an increase of 30 minutes or more. Under the contract this assignment would be posted for bid."
  },
  BUMP_ELIGIBLE: {
    label: "Bump eligible",
    summary: "The window closed with a decrease of 30 minutes or more. Under the contract you would have a bump option."
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    summary: "A later correction would change an outcome that already finalized."
  },
  LOCKED_PENDING: {
    label: "Locked pending",
    summary: "Window closed; waiting on a lock-in outcome."
  }
};
var WINDOW_RULE_HEADLINE = {
  pre_october_1_lock: "Before October 1 a change under 30 minutes becomes contracted on October 1 (Art. 3.08(a)(8)(c)).",
  pre_october_1_bid: "Before October 1 a 30-minute increase that has lasted 15 school days is posted for bid (Art. 3.08(a)(8)(a)).",
  pre_october_1_bump: "Before October 1 a 30-minute decrease is bump-eligible on the written determination date (Art. 3.08(a)(8)(b)).",
  post_october_1_increase_lock: "After October 1 a 15-minute increase becomes contracted the workday after it has lasted 15 school days (Art. 3.08(b)(3)).",
  post_october_1_decrease_lock: "After October 1 a decrease under 30 minutes is counted with any other change in the same 15 school days, then becomes contracted the next school day (Art. 3.08(b)(4)).",
  post_october_1_bid: "After October 1 a 30-minute increase is posted for bid during the last five school days of the month, October through April (Art. 3.08(b)(1)).",
  post_october_1_bump: "After October 1 a 30-minute decrease is bump-eligible after it has lasted 15 school days (Art. 3.08(b)(2)).",
  forced_october_1_contract: "Force Oct 1 Contract is on, so this schedule becomes contracted on October 1. The size of the change and the 15-school-day countdown are not used."
};
var FORCED_OCT1_COPY = {
  label: "Contracted on October 1",
  detail: "Force Oct 1 Contract is on, so this schedule becomes contracted on October 1. The size of the change and the 15-school-day countdown are not used."
};
var OUTCOME_COPY = {
  STABLE: {
    label: "Automatically contracted",
    detail: "The accumulated difference is under 30 minutes, so the new clock times are automatically contracted. Each run is rounded to the nearest 15 minutes, those amounts are added, and that sum is rounded again."
  },
  BID_PENDING: {
    label: "Posted for bid",
    detail: "The accumulated difference is an increase of 30 minutes or more. The new contracted figure is calculated, but the assignment would be posted for bid."
  },
  BUMP_ELIGIBLE: {
    label: "Bump eligible",
    detail: "The accumulated difference is a decrease of 30 minutes or more. You would have a contract bump option."
  }
};
function rebuildEmployeeRouteState(changeLog, calendar, asOfDate, prior = {}) {
  const map = rebuildRouteStateFromChangeLog(
    changeLog,
    {},
    calendar,
    asOfDate,
    { priorRouteState: prior }
  );
  return map[EMPLOYEE_ROUTE_ID] ?? null;
}
function describeSchedule(segments) {
  const out = {};
  for (const segment of SEGMENTS) {
    out[segment] = splitSegmentRange(segments?.[segment] ?? null);
  }
  return out;
}
function isSeedChange(change2) {
  return change2 && change2.delta_minutes === 0 && change2.previous_time === change2.new_time;
}
function dateSortKey(value) {
  const text = value == null ? "" : String(value).trim();
  if (!text || text.toLowerCase() === "null") return "";
  return text;
}
function chronologicalChangeCompare(a, b) {
  const dateCompare = dateSortKey(a.effective_date).localeCompare(dateSortKey(b.effective_date));
  if (dateCompare !== 0) {
    return dateCompare;
  }
  return String(a.submitted_at).localeCompare(String(b.submitted_at));
}
function reportChangeIds(report) {
  return (report?.contributing_changes ?? []).map((item) => item.id);
}
function buildScheduleHistory(changeLog, entry, window2, startDate) {
  const events = (changeLog ?? []).filter((item) => !item.type || item.type === "CHANGE").slice().sort(chronologicalChangeCompare);
  const seeds = events.filter(isSeedChange);
  const later = events.filter((item) => !isSeedChange(item));
  if (!seeds.length && !later.length) {
    return [];
  }
  const running = { AM: null, MIDDAY: null, PM: null };
  const sources = { AM: null, MIDDAY: null, PM: null };
  for (const seed2 of seeds) {
    running[seed2.segment] = seed2.new_time;
    sources[seed2.segment] = "initial";
  }
  const reports = entry?.change_reports ?? [];
  const openIds = entry?.contributing_change_ids ?? [];
  const lastOpenId = openIds.at(-1) ?? null;
  const rows = [
    {
      id: "initial",
      kind: "initial",
      date: startDate || seeds[0]?.effective_date || null,
      change_id: null,
      segment: null,
      previous_time: null,
      new_time: null,
      previous: null,
      next: null,
      delta_minutes: null,
      delta_label: null,
      cumulative_drift_minutes: null,
      cumulative_drift_label: null,
      note: "",
      schedule: describeSchedule(running),
      time_sources: { ...sources },
      contracted: {
        status: "established",
        becomes_on: null,
        projected_outcome: null,
        projected_outcome_label: null,
        label: "Established starting schedule",
        detail: null
      }
    }
  ];
  const groups = [];
  for (const change2 of later) {
    const key = change2.schedule_id || change2.id;
    const current = groups.at(-1);
    if (current && current.key === key) current.changes.push(change2);
    else groups.push({ key, changes: [change2] });
  }
  for (const group of groups) {
    const segments = [];
    let last = group.changes[0];
    for (const change2 of group.changes) {
      running[change2.segment] = change2.new_time || null;
      sources[change2.segment] = change2.id;
      if (!segments.includes(change2.segment)) segments.push(change2.segment);
      last = change2;
    }
    const date = dateSortKey(last.effective_date) || null;
    rows.push({
      id: last.id,
      kind: "change",
      date,
      change_id: last.id,
      change_ids: group.changes.map((change2) => change2.id),
      segment: segments.length === 1 ? segments[0] : null,
      segments,
      previous_time: last.previous_time,
      new_time: last.new_time,
      previous: splitSegmentRange(last.previous_time),
      next: splitSegmentRange(last.new_time),
      delta_minutes: group.changes.reduce((sum, change2) => sum + (change2.delta_minutes || 0), 0),
      delta_label: formatSignedMinutes(
        group.changes.reduce((sum, change2) => sum + (change2.delta_minutes || 0), 0)
      ),
      cumulative_drift_minutes: null,
      cumulative_drift_label: null,
      note: group.changes.map((change2) => change2.note).filter(Boolean).filter((note, index, all) => all.indexOf(note) === index).join(" "),
      force_oct1_contract: group.changes.some((change2) => isForcedOctober1Contract(change2.force_oct1_contract)),
      schedule: describeSchedule(running),
      time_sources: { ...sources },
      contracted: contractedStatusForChange(last, {
        reports,
        openIds,
        lastOpenId,
        entry,
        window: window2
      })
    });
  }
  annotateCumulativeDrift(rows, entry);
  return rows;
}
function annotateCumulativeDrift(rows, entry) {
  const byId = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (row.kind === "change" && row.change_id) {
      byId.set(row.change_id, row);
    }
  }
  if (!byId.size) return;
  const groups = [];
  const covered = /* @__PURE__ */ new Set();
  for (const report of entry?.change_reports ?? []) {
    const ids = (report.contributing_changes ?? []).map((item) => item.id).filter((id) => byId.has(id) && !covered.has(id));
    if (!ids.length) continue;
    groups.push(ids);
    for (const id of ids) covered.add(id);
  }
  const openIds = (entry?.contributing_change_ids ?? []).filter(
    (id) => byId.has(id) && !covered.has(id)
  );
  if (openIds.length) groups.push(openIds);
  for (const ids of groups) {
    let sum = 0;
    for (const id of ids) {
      const row = byId.get(id);
      sum += row.delta_minutes ?? 0;
      row.cumulative_drift_minutes = sum;
      row.cumulative_drift_label = formatSignedMinutes(sum);
    }
  }
}
function contractedStatusForChange(change2, { reports, openIds, lastOpenId, entry, window: window2 }) {
  for (const report of reports) {
    const ids = reportChangeIds(report);
    if (!ids.includes(change2.id)) {
      continue;
    }
    if (ids.at(-1) === change2.id) {
      const becomesOn = String(report.finalized_at || "").slice(0, 10) || null;
      const outcomeCopy = OUTCOME_COPY[report.outcome];
      if (report.outcome === "STABLE") {
        const forced = Boolean(report.forced_october_1);
        const copy = forced ? FORCED_OCT1_COPY : outcomeCopy;
        return {
          status: "became_contracted",
          becomes_on: becomesOn,
          projected_outcome: report.outcome,
          projected_outcome_label: copy?.label ?? null,
          label: becomesOn ? `Became contracted on ${prettyDate(becomesOn)}` : "Became contracted",
          detail: copy?.detail ?? report.contracted_hours_statement ?? null
        };
      }
      return {
        status: report.outcome === "BID_PENDING" ? "bid_pending" : report.outcome === "BUMP_ELIGIBLE" ? "bump_eligible" : String(report.outcome).toLowerCase(),
        becomes_on: becomesOn,
        projected_outcome: report.outcome,
        projected_outcome_label: outcomeCopy?.label ?? null,
        label: becomesOn ? `Window closed ${prettyDate(becomesOn)} \xB7 ${outcomeCopy?.label?.toLowerCase() ?? report.outcome}` : outcomeCopy?.label ?? report.outcome,
        detail: outcomeCopy?.detail ?? report.contracted_hours_statement ?? null
      };
    }
    return {
      status: "superseded",
      becomes_on: null,
      projected_outcome: null,
      projected_outcome_label: null,
      label: "Replaced by a later change in that window",
      detail: null
    };
  }
  if (entry?.status === "ACCUMULATING" && openIds.includes(change2.id)) {
    if (change2.id === lastOpenId) {
      const becomesOn = window2?.becomes_contracted_on ?? null;
      const forced = window2?.window_rule === "forced_october_1_contract";
      return {
        status: "predicted",
        becomes_on: becomesOn,
        projected_outcome: window2?.projected_outcome ?? null,
        projected_outcome_label: forced ? FORCED_OCT1_COPY.label : window2?.projected_outcome_label ?? null,
        label: becomesOn ? `Predicted to become contracted on ${prettyDate(becomesOn)}` : "Predicted to become contracted",
        detail: forced ? FORCED_OCT1_COPY.detail : window2?.projected_outcome_detail ?? null
      };
    }
    return {
      status: "superseded",
      becomes_on: null,
      projected_outcome: null,
      projected_outcome_label: null,
      label: "Later change reset this window",
      detail: null
    };
  }
  if ((entry?.status === "BID_PENDING" || entry?.status === "BUMP_ELIGIBLE") && change2.id === lastOpenId) {
    const outcomeCopy = OUTCOME_COPY[entry.status];
    return {
      status: entry.status === "BID_PENDING" ? "bid_pending" : "bump_eligible",
      becomes_on: null,
      projected_outcome: entry.status,
      projected_outcome_label: outcomeCopy?.label ?? null,
      label: outcomeCopy?.label ?? entry.status,
      detail: outcomeCopy?.detail ?? null
    };
  }
  return {
    status: "superseded",
    becomes_on: null,
    projected_outcome: null,
    projected_outcome_label: null,
    label: "Replaced by a later change",
    detail: null
  };
}
function officialContractedMinutes(entry) {
  if (!entry) {
    return null;
  }
  if (entry.payroll_rounded_total_minutes != null) {
    return entry.payroll_rounded_total_minutes;
  }
  const source = entry.status === "ACCUMULATING" ? entry.baseline_segments : entry.segments;
  return buildPayrollRoundingBreakdown(source).payroll_rounded_total_minutes;
}
function buildEmployeeSnapshot({
  profile,
  changeLog,
  entry,
  calendar,
  asOfDate,
  calendarSummary,
  calendarSource
}) {
  const asOf = toDateString(asOfDate);
  const setup_complete = Boolean(profile && entry);
  const changes = changeLog.filter((item) => !item.type || item.type === "CHANGE").map((change2) => ({
    id: change2.id,
    segment: change2.segment,
    change_date: change2.effective_date,
    previous_time: change2.previous_time,
    new_time: change2.new_time,
    previous: splitSegmentRange(change2.previous_time),
    next: splitSegmentRange(change2.new_time),
    delta_minutes: change2.delta_minutes,
    delta_label: formatSignedMinutes(change2.delta_minutes),
    note: change2.note || "",
    force_oct1_contract: isForcedOctober1Contract(change2.force_oct1_contract),
    is_seed: change2.delta_minutes === 0 && change2.previous_time === change2.new_time,
    submitted_at: change2.submitted_at
  })).sort((a, b) => {
    const dateCompare = dateSortKey(b.change_date).localeCompare(dateSortKey(a.change_date));
    if (dateCompare !== 0) return dateCompare;
    return String(b.submitted_at).localeCompare(String(a.submitted_at));
  });
  const schedule = describeSchedule(entry?.segments ?? {});
  const scheduledExact = entry ? buildPayrollRoundingBreakdown(entry.segments) : null;
  const contractedMinutes = officialContractedMinutes(entry);
  const window2 = entry ? buildWindowView(entry, calendar, asOf) : null;
  const schedule_history = buildScheduleHistory(
    changeLog,
    entry,
    window2,
    profile?.start_date ?? null
  );
  return {
    setup_complete,
    as_of: asOf,
    employee: {
      name: profile?.name?.trim() || "",
      start_date: profile?.start_date ?? null
    },
    calendar: {
      school_year: calendar.school_year ?? "2026-2027",
      first_day: calendarSummary?.first_day ?? "2026-09-08",
      last_day: calendarSummary?.last_day ?? "2027-06-22",
      school_day_count: calendarSummary?.school_day_count ?? calendar.school_days?.length ?? null,
      source: calendarSource ?? null
    },
    schedule,
    scheduled: scheduledExact ? {
      exact_minutes: scheduledExact.exact_total_minutes,
      exact_label: formatDurationLabel(scheduledExact.exact_total_minutes),
      if_locked_minutes: scheduledExact.payroll_rounded_total_minutes,
      if_locked_label: formatDurationLabel(
        scheduledExact.payroll_rounded_total_minutes
      )
    } : null,
    contracted: contractedMinutes == null ? null : {
      minutes: contractedMinutes,
      label: formatDurationLabel(contractedMinutes),
      source: entry?.payroll_rounded_total_minutes != null ? "last_finalization" : "starting_schedule"
    },
    window: window2,
    schedule_history,
    changes,
    reports: (entry?.change_reports ?? []).map(shapeReport).reverse(),
    bid_threshold_minutes: BID_THRESHOLD_MINUTES,
    window_length_school_days: 15
  };
}
function buildWindowView(entry, calendar, asOf) {
  const status = entry.status;
  const copy = STATUS_COPY[status] ?? {
    label: status,
    summary: ""
  };
  const open = status === "ACCUMULATING" && entry.window_expires_date;
  const drift = entry.cumulative_drift_minutes ?? 0;
  const forced = entry.window_rule === "forced_october_1_contract";
  const daysRemaining = open ? daysRemainingInWindow(calendar, asOf, entry.window_expires_date) : null;
  const becomesOn = open ? dayAfter(entry.window_expires_date) : null;
  const projectedOutcome = open ? forced ? "STABLE" : windowFinalizationOutcome(drift) : null;
  const outcomeCopy = forced ? FORCED_OCT1_COPY : projectedOutcome ? OUTCOME_COPY[projectedOutcome] : null;
  const math = open ? buildSeeTheMathFromSegments(entry.baseline_segments, entry.segments) : null;
  let headline = copy.summary;
  if (open && becomesOn && outcomeCopy) {
    const ruleNote = WINDOW_RULE_HEADLINE[entry.window_rule] ?? "If you do not log another change, these times become contracted on the date below.";
    headline = `${ruleNote} If you do not log another change, that date is ${prettyDate(becomesOn)}. Projected result: ${outcomeCopy.label.toLowerCase()}.`;
  } else if (status === "STABLE" && entry.payroll_rounded_total_minutes != null) {
    headline = "Your latest window was automatically contracted. The contracted hours below are official under the contract rules.";
  } else if (status === "STABLE") {
    headline = "These are your starting clock times. Log a change to open a review window.";
  }
  return {
    status,
    status_label: copy.label,
    headline,
    summary: copy.summary,
    opened_date: entry.window_opened_date ?? null,
    expires_date: entry.window_expires_date ?? null,
    window_rule: entry.window_rule ?? null,
    becomes_contracted_on: becomesOn,
    days_remaining: daysRemaining,
    cumulative_drift_minutes: drift,
    cumulative_drift_label: formatSignedMinutes(drift),
    projected_outcome: projectedOutcome,
    projected_outcome_label: outcomeCopy?.label ?? null,
    projected_outcome_detail: outcomeCopy?.detail ?? null,
    contracted_hours_would_change: math?.contracted_hours_changed ?? null,
    contracted_hours_delta_minutes: math?.contracted_hours_delta_minutes ?? null,
    contracted_hours_statement: math?.statement ?? null,
    see_the_math: math
  };
}
function shapeReport(report) {
  return {
    id: report.id,
    outcome: report.outcome,
    outcome_label: OUTCOME_COPY[report.outcome]?.label ?? report.outcome,
    finalized_at: report.finalized_at,
    window_opened_date: report.window_opened_date,
    contracted_hours_changed: report.contracted_hours_changed,
    contracted_hours_delta_minutes: report.contracted_hours_delta_minutes,
    contracted_hours_statement: report.contracted_hours_statement,
    see_the_math: report.see_the_math,
    before_segments: report.before?.segments ?? null,
    after_segments: report.after?.segments ?? null,
    contributing_changes: report.contributing_changes ?? []
  };
}
function formatSignedMinutes(minutes) {
  if (typeof minutes !== "number" || Number.isNaN(minutes)) {
    return "\u2014";
  }
  if (minutes === 0) {
    return "0 min";
  }
  const sign = minutes > 0 ? "+" : "\u2212";
  return `${sign}${formatDurationLabel(Math.abs(minutes))}`;
}
function previewEmployeeChange({
  entry,
  calendar,
  segment,
  clock_in,
  clock_out,
  change_date,
  force_oct1_contract = false,
  changeLog = null
}) {
  if (!entry) {
    throw new Error("Set up your starting schedule before previewing a change.");
  }
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`segment must be one of: ${SEGMENTS.join(", ")}.`);
  }
  const previous = entry.segments[segment];
  if (!previous) {
    throw new Error(
      `No ${segment} times on file yet. Add that run to your starting schedule first.`
    );
  }
  const newTime = formatSegmentRange(clock_in, clock_out);
  const delta = computeDeltaMinutes(previous, newTime);
  const changeDate = toDateString(change_date);
  const hypothetical = {
    id: "preview",
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: entry.driver_name ?? "",
    driver_id: entry.driver_id ?? null,
    segment,
    submitted_at: `${changeDate}T00:00:00.000Z`,
    effective_date: changeDate,
    previous_time: previous,
    new_time: newTime,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: "OTHER",
    note: "",
    entered_by: "Self",
    force_oct1_contract: isForcedOctober1Contract(force_oct1_contract)
  };
  const next = applyChangeToRoute(entry, hypothetical, calendar, changeDate, delta, {
    changeLog: [...changeLog ?? [], hypothetical]
  });
  const closedReport = (next.change_reports ?? []).find(
    (report) => report.forced_october_1 && (report.contributing_changes ?? []).some((item) => item.id === hypothetical.id)
  );
  const forced = next.window_rule === "forced_october_1_contract" || Boolean(closedReport);
  const nextDrift = closedReport ? (closedReport.contributing_changes ?? []).reduce(
    (sum, item) => sum + (item.delta_minutes || 0),
    0
  ) : next.cumulative_drift_minutes ?? delta;
  const plan = forced ? forcedOctober1ContractPlan(changeDate) : contractWindowPlan(calendar, changeDate, nextDrift);
  const outcome = forced ? "STABLE" : windowFinalizationOutcome(nextDrift);
  const outcomeCopy = forced ? FORCED_OCT1_COPY : OUTCOME_COPY[outcome];
  const math = closedReport ? {
    contracted_hours_changed: closedReport.contracted_hours_changed,
    contracted_hours_delta_minutes: closedReport.contracted_hours_delta_minutes,
    statement: closedReport.contracted_hours_statement
  } : buildSeeTheMathFromSegments(next.baseline_segments, next.segments);
  return {
    previous_time: previous,
    new_time: newTime,
    previous: splitSegmentRange(previous),
    next: splitSegmentRange(newTime),
    delta_minutes: delta,
    delta_label: formatSignedMinutes(delta),
    window_expires_date: plan.window_expires_date,
    becomes_contracted_on: plan.becomes_effective_on,
    cumulative_drift_minutes: nextDrift,
    cumulative_drift_label: formatSignedMinutes(nextDrift),
    projected_outcome: outcome,
    projected_outcome_label: outcomeCopy.label,
    projected_outcome_detail: outcomeCopy.detail,
    contracted_hours_would_change: math.contracted_hours_changed,
    contracted_hours_delta_minutes: math.contracted_hours_delta_minutes,
    contracted_hours_statement: math.statement
  };
}
function prettyDate(iso) {
  return (/* @__PURE__ */ new Date(`${iso}T12:00:00`)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
function groupCalendarByMonth(calendar) {
  const months = {};
  for (const day of calendar.days ?? []) {
    const month = day.date.slice(0, 7);
    if (!months[month]) {
      const [year, mon] = month.split("-");
      const label = new Date(Date.UTC(Number(year), Number(mon) - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      months[month] = { month, label, days: [] };
    }
    months[month].days.push(day);
  }
  return Object.values(months).filter(
    (month) => month.days.some((day) => day.is_school_day)
  );
}

// employee-tracker/web/store.js
var store_exports = {};
__export(store_exports, {
  DISMISSED_NOTIFICATIONS_KEY: () => DISMISSED_NOTIFICATIONS_KEY,
  STORAGE_KEY: () => STORAGE_KEY,
  deleteProfile: () => deleteProfile,
  dismissNotificationId: () => dismissNotificationId,
  emptyState: () => emptyState,
  exportState: () => exportState,
  getCurrentProfile: () => getCurrentProfile,
  importState: () => importState,
  listDismissedNotificationIds: () => listDismissedNotificationIds,
  listProfiles: () => listProfiles,
  loadState: () => loadState,
  saveProfile: () => saveProfile,
  saveState: () => saveState,
  setCurrentProfile: () => setCurrentProfile
});
var STORAGE_KEY = "my-hours-tracker.v1";
var DISMISSED_NOTIFICATIONS_KEY = "my-hours-tracker.notify-dismissed.v1";
function emptyState() {
  return {
    version: 1,
    currentProfileId: null,
    profiles: {}
  };
}
function loadState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyState();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.profiles !== "object") {
      return emptyState();
    }
    return {
      version: 1,
      currentProfileId: parsed.currentProfileId ?? null,
      profiles: parsed.profiles ?? {}
    };
  } catch {
    return emptyState();
  }
}
function saveState(state, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}
function listProfiles(storage = globalThis.localStorage) {
  const state = loadState(storage);
  return Object.values(state.profiles).sort((a, b) => {
    const nameCompare = String(a.name || "").localeCompare(String(b.name || ""));
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
}
function getCurrentProfile(storage = globalThis.localStorage) {
  const state = loadState(storage);
  if (!state.currentProfileId) {
    return null;
  }
  return state.profiles[state.currentProfileId] ?? null;
}
function setCurrentProfile(id, storage = globalThis.localStorage) {
  const state = loadState(storage);
  if (!state.profiles[id]) {
    throw new Error("That person is not saved in this browser.");
  }
  state.currentProfileId = id;
  saveState(state, storage);
  return state.profiles[id];
}
function saveProfile(profile, storage = globalThis.localStorage) {
  const state = loadState(storage);
  state.profiles[profile.id] = profile;
  state.currentProfileId = profile.id;
  saveState(state, storage);
  return profile;
}
function deleteProfile(id, storage = globalThis.localStorage) {
  const state = loadState(storage);
  delete state.profiles[id];
  if (state.currentProfileId === id) {
    const remaining = Object.keys(state.profiles);
    state.currentProfileId = remaining[0] ?? null;
  }
  saveState(state, storage);
  return state.currentProfileId ? state.profiles[state.currentProfileId] : null;
}
function exportState(storage = globalThis.localStorage) {
  return JSON.stringify(loadState(storage), null, 2);
}
function parseDismissedMap(raw) {
  try {
    const parsed = raw ? JSON.parse(String(raw)) : {};
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const map = {};
    for (const [profileId, ids] of Object.entries(parsed)) {
      if (!Array.isArray(ids)) continue;
      map[profileId] = ids.filter((id) => typeof id === "string" && id);
    }
    return map;
  } catch {
    return {};
  }
}
function listDismissedNotificationIds(profileId, storage = globalThis.localStorage) {
  if (!profileId) {
    return [];
  }
  const map = parseDismissedMap(storage?.getItem(DISMISSED_NOTIFICATIONS_KEY));
  return map[profileId] ?? [];
}
function dismissNotificationId(profileId, notificationId, storage = globalThis.localStorage) {
  if (!profileId || !notificationId) {
    return listDismissedNotificationIds(profileId, storage);
  }
  const map = parseDismissedMap(storage?.getItem(DISMISSED_NOTIFICATIONS_KEY));
  const current = map[profileId] ?? [];
  if (current.includes(notificationId)) {
    return current;
  }
  const next = [...current, notificationId];
  map[profileId] = next;
  storage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(map));
  return next;
}
function importState(json, storage = globalThis.localStorage) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || !parsed.profiles) {
    throw new Error("That file is not a My Teamster Contract Date Calculator backup.");
  }
  const next = {
    version: 1,
    currentProfileId: parsed.currentProfileId ?? null,
    profiles: parsed.profiles
  };
  if (next.currentProfileId && !next.profiles[next.currentProfileId]) {
    next.currentProfileId = Object.keys(next.profiles)[0] ?? null;
  }
  saveState(next, storage);
  return next;
}

// employee-tracker/web/engine.js
var store = store_exports;
var cachedCalendar = null;
function getAsOfDate(profile) {
  if (typeof globalThis.location?.search === "string") {
    const value = new URLSearchParams(globalThis.location.search).get("as_of");
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  }
  if (profile?.view_as_of && /^\d{4}-\d{2}-\d{2}$/.test(profile.view_as_of)) {
    return profile.view_as_of;
  }
  return localDateString();
}
function getCalendarPack() {
  if (!cachedCalendar) {
    const { calendar, summary, source } = buildBps2026_2027Calendar();
    cachedCalendar = {
      calendar,
      summary,
      source,
      months: groupCalendarByMonth(calendar),
      first_day: BPS_2026_2027_INPUT.first_day,
      last_day: BPS_2026_2027_INPUT.last_day
    };
  }
  return cachedCalendar;
}
function calendarMeta() {
  const pack = getCalendarPack();
  return {
    calendarSummary: pack.summary,
    calendarSource: pack.source ?? BPS_2026_2027_SOURCE
  };
}
function requireClockPair(clockIn, clockOut, label) {
  const inTrim = String(clockIn ?? "").trim();
  const outTrim = String(clockOut ?? "").trim();
  if (!inTrim && !outTrim) {
    return null;
  }
  if (!inTrim || !outTrim) {
    throw new Error(`${label} needs both a clock-in and a clock-out.`);
  }
  return formatSegmentRange(inTrim, outTrim);
}
function isSeedEvent(change2) {
  return change2 && change2.delta_minutes === 0 && change2.previous_time === change2.new_time;
}
function relinkChangeLog(changeLog, name = "") {
  const anchor = (changeLog ?? []).map((event) => String(event.effective_date ?? "").trim()).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()[0] || "1970-01-01";
  const events = [...changeLog ?? []].sort((a, b) => {
    const dateCompare = scheduleDateForMath(a.effective_date, anchor).localeCompare(
      scheduleDateForMath(b.effective_date, anchor)
    );
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return String(a.submitted_at).localeCompare(String(b.submitted_at));
  });
  const current = { AM: null, MIDDAY: null, PM: null };
  return events.map((event) => {
    const next = {
      ...event,
      driver_name: name || event.driver_name,
      entered_by: event.entered_by || name || "Self"
    };
    if (isSeedEvent(event)) {
      current[event.segment] = event.new_time;
      next.previous_time = event.new_time;
      next.computed_delta_minutes = 0;
      next.delta_minutes = 0;
      return next;
    }
    const previous = current[event.segment];
    if (!String(event.new_time ?? "").trim()) {
      if (previous) {
        const delta2 = -parseTimeRange(previous).durationMinutes;
        next.previous_time = previous;
        next.new_time = "";
        next.computed_delta_minutes = delta2;
        next.delta_minutes = delta2;
      }
      current[event.segment] = null;
      return next;
    }
    if (!previous) {
      next.previous_time = event.new_time;
      next.computed_delta_minutes = 0;
      next.delta_minutes = 0;
      current[event.segment] = event.new_time;
      return next;
    }
    const delta = computeDeltaMinutes(previous, event.new_time);
    next.previous_time = previous;
    next.computed_delta_minutes = delta;
    next.delta_minutes = delta;
    current[event.segment] = event.new_time;
    return next;
  });
}
function persistRelinked(profile, storage) {
  profile.changeLog = relinkChangeLog(profile.changeLog, profile.name?.trim() || "");
  store.saveProfile(profile, storage);
  return currentSnapshot(storage);
}
function makeSeedChange({ segment, range, startDate, name, submittedAt }) {
  return {
    id: createId(),
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: name,
    driver_id: null,
    segment,
    submitted_at: submittedAt,
    effective_date: startDate,
    previous_time: range,
    new_time: range,
    computed_delta_minutes: 0,
    delta_minutes: 0,
    routing_adjustment: null,
    reason_category: "OTHER",
    note: "Starting schedule",
    entered_by: name || "Self"
  };
}
function buildSnapshot(profile, asOfDate = getAsOfDate()) {
  const pack = getCalendarPack();
  const asOf = toDateString(asOfDate);
  if (!profile) {
    return buildEmployeeSnapshot({
      profile: null,
      changeLog: [],
      entry: null,
      calendar: pack.calendar,
      asOfDate: asOf,
      ...calendarMeta()
    });
  }
  const entry = rebuildEmployeeRouteState(
    profile.changeLog ?? [],
    pack.calendar,
    asOf
  );
  return buildEmployeeSnapshot({
    profile: {
      name: profile.name,
      start_date: profile.start_date
    },
    changeLog: profile.changeLog ?? [],
    entry,
    calendar: pack.calendar,
    asOfDate: asOf,
    ...calendarMeta()
  });
}
function currentSnapshot(storage, asOfDate) {
  const profile = store.getCurrentProfile(storage);
  return buildSnapshot(profile, asOfDate || getAsOfDate(profile));
}
function setupProfile(body, storage) {
  const name = String(body.name ?? "").trim();
  const startDate = toDateString(body.start_date || getAsOfDate());
  const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
  const segments = [];
  for (const segment of SEGMENTS) {
    const key = segment.toLowerCase();
    const range = requireClockPair(
      body[`${key}_in`] ?? body[`${key}_clock_in`],
      body[`${key}_out`] ?? body[`${key}_clock_out`],
      segment
    );
    if (range) {
      segments.push({ segment, range });
    }
  }
  if (!segments.length) {
    throw new Error(
      "Enter clock-in and clock-out for at least one run (AM, Midday, or PM)."
    );
  }
  const seeds = segments.map(
    (item, index) => makeSeedChange({
      segment: item.segment,
      range: item.range,
      startDate,
      name,
      submittedAt: new Date(new Date(submittedAt).getTime() + index).toISOString()
    })
  );
  const profile = {
    id: createId(),
    name,
    start_date: startDate,
    setup_at: submittedAt,
    created_at: submittedAt,
    changeLog: seeds
  };
  store.saveProfile(profile, storage);
  return currentSnapshot(storage);
}
function previewChange(body, storage) {
  const profile = store.getCurrentProfile(storage);
  const pack = getCalendarPack();
  const rawDate = body.change_date;
  const blankDate = rawDate == null || String(rawDate).trim() === "" || String(rawDate).trim().toLowerCase() === "null";
  const asOf = blankDate ? toDateString(profile?.start_date || getAsOfDate()) : toDateString(rawDate);
  const entry = rebuildEmployeeRouteState(
    profile?.changeLog ?? [],
    pack.calendar,
    asOf
  );
  return previewEmployeeChange({
    entry,
    calendar: pack.calendar,
    segment: String(body.segment || "").trim(),
    clock_in: normalizeClockTime(body.clock_in),
    clock_out: normalizeClockTime(body.clock_out),
    change_date: asOf,
    force_oct1_contract: body.force_oct1_contract,
    changeLog: profile?.changeLog ?? []
  });
}
function recordChange(body, storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    throw new Error("Set up a person first.");
  }
  const segment = String(body.segment || "").trim();
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`segment must be one of: ${SEGMENTS.join(", ")}.`);
  }
  const hasDate = Object.prototype.hasOwnProperty.call(body, "change_date") || Object.prototype.hasOwnProperty.call(body, "effective_date");
  const rawDate = hasDate ? body.change_date ?? body.effective_date : getAsOfDate();
  const changeDate = rawDate == null || String(rawDate).trim() === "" || String(rawDate).trim().toLowerCase() === "null" ? null : toDateString(rawDate);
  const mathDate = changeDate || profile.start_date || getAsOfDate();
  const pack = getCalendarPack();
  const entry = rebuildEmployeeRouteState(
    profile.changeLog,
    pack.calendar,
    mathDate
  );
  if (!entry) {
    throw new Error("Starting schedule is missing. Add this person again.");
  }
  const previous = entry.segments[segment];
  if (!previous) {
    throw new Error(
      `No ${segment} times on file. Add that run when you set up this person.`
    );
  }
  const newTime = formatSegmentRange(body.clock_in, body.clock_out);
  if (newTime === previous) {
    throw new Error("New times are the same as the current times.");
  }
  const delta = computeDeltaMinutes(previous, newTime);
  const name = profile.name?.trim() || "Self";
  profile.changeLog = [
    ...profile.changeLog,
    {
      id: createId(),
      route_id: EMPLOYEE_ROUTE_ID,
      driver_name: name,
      driver_id: null,
      segment,
      submitted_at: (/* @__PURE__ */ new Date()).toISOString(),
      effective_date: changeDate,
      previous_time: previous,
      new_time: newTime,
      computed_delta_minutes: delta,
      delta_minutes: delta,
      routing_adjustment: null,
      reason_category: "OTHER",
      note: String(body.note ?? "").trim(),
      entered_by: String(body.entered_by ?? "").trim() || name,
      entered_by_user_id: String(body.entered_by_user_id ?? "").trim() || null,
      force_oct1_contract: isForcedOctober1Contract(body.force_oct1_contract),
      schedule_id: body.schedule_id || null
    }
  ];
  store.saveProfile(profile, storage);
  return currentSnapshot(storage);
}
function updateChange(changeId, body, storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    throw new Error("Set up a person first.");
  }
  const index = profile.changeLog.findIndex((entry) => entry.id === changeId);
  if (index < 0) {
    throw new Error("That change was not found.");
  }
  const existing = profile.changeLog[index];
  if (isSeedEvent(existing)) {
    throw new Error(
      "Correct starting times from the established schedule row, not by editing a later change."
    );
  }
  const newTime = body.clock_in || body.clock_out ? formatSegmentRange(body.clock_in, body.clock_out) : existing.new_time;
  let changeDate = existing.effective_date ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "change_date")) {
    const raw = body.change_date;
    changeDate = raw == null || String(raw).trim() === "" || String(raw).trim().toLowerCase() === "null" ? null : toDateString(raw);
  }
  profile.changeLog[index] = {
    ...existing,
    effective_date: changeDate,
    new_time: newTime,
    note: body.note != null ? String(body.note).trim() : existing.note,
    force_oct1_contract: Object.prototype.hasOwnProperty.call(body, "force_oct1_contract") ? isForcedOctober1Contract(body.force_oct1_contract) : isForcedOctober1Contract(existing.force_oct1_contract)
  };
  profile.changeLog = relinkChangeLog(profile.changeLog, profile.name?.trim() || "");
  const updated = profile.changeLog.find((entry) => entry.id === changeId);
  if (updated && updated.previous_time === updated.new_time) {
    throw new Error("Those times match the previous times. Remove this change instead.");
  }
  store.saveProfile(profile, storage);
  return currentSnapshot(storage);
}
function deleteChange(changeId, storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    throw new Error("Set up a person first.");
  }
  const existing = profile.changeLog.find((entry) => entry.id === changeId);
  if (!existing) {
    throw new Error("That change was not found.");
  }
  if (isSeedEvent(existing)) {
    throw new Error("Starting times cannot be removed here.");
  }
  profile.changeLog = profile.changeLog.filter((entry) => entry.id !== changeId);
  return persistRelinked(profile, storage);
}
function updateStartingSchedule(body, storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    throw new Error("Set up a person first.");
  }
  const name = String(body.name ?? profile.name ?? "").trim();
  const startDate = toDateString(body.start_date || profile.start_date || getAsOfDate());
  const segments = [];
  for (const segment of SEGMENTS) {
    const key = segment.toLowerCase();
    const range = requireClockPair(
      body[`${key}_in`] ?? body[`${key}_clock_in`],
      body[`${key}_out`] ?? body[`${key}_clock_out`],
      segment
    );
    if (range) {
      segments.push({ segment, range });
    }
  }
  if (!segments.length) {
    throw new Error("Enter clock-in and clock-out for at least one run.");
  }
  const laterBySegment = new Set(
    profile.changeLog.filter((entry) => !isSeedEvent(entry)).map((entry) => entry.segment)
  );
  for (const segment of laterBySegment) {
    if (!segments.some((item) => item.segment === segment)) {
      throw new Error(
        `Keep ${segment} starting times \u2014 later changes still depend on that run.`
      );
    }
  }
  const seeds = profile.changeLog.filter(isSeedEvent);
  const nonSeeds = profile.changeLog.filter((entry) => !isSeedEvent(entry));
  const nextSeeds = segments.map((item, index) => {
    const existing = seeds.find((seed2) => seed2.segment === item.segment);
    if (existing) {
      return {
        ...existing,
        driver_name: name,
        entered_by: name || "Self",
        effective_date: startDate,
        previous_time: item.range,
        new_time: item.range,
        computed_delta_minutes: 0,
        delta_minutes: 0
      };
    }
    return makeSeedChange({
      segment: item.segment,
      range: item.range,
      startDate,
      name,
      submittedAt: new Date(Date.now() + index).toISOString()
    });
  });
  profile.name = name;
  profile.start_date = startDate;
  profile.changeLog = [...nextSeeds, ...nonSeeds];
  return persistRelinked(profile, storage);
}
function startingScheduleFields(storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    return { name: "", start_date: getAsOfDate(), segments: {} };
  }
  const segments = {};
  for (const seed2 of profile.changeLog.filter(isSeedEvent)) {
    segments[seed2.segment] = splitSegmentRange(seed2.new_time);
  }
  return {
    name: profile.name || "",
    start_date: profile.start_date || getAsOfDate(),
    segments
  };
}
function switchPerson(id, storage) {
  store.setCurrentProfile(id, storage);
  return currentSnapshot(storage);
}
function removeCurrentPerson(storage) {
  const profile = store.getCurrentProfile(storage);
  if (!profile) {
    return currentSnapshot(storage);
  }
  store.deleteProfile(profile.id, storage);
  return currentSnapshot(storage);
}
function peopleList(storage) {
  return store.listProfiles(storage).map((profile) => ({
    id: profile.id,
    name: profile.name || "Unnamed",
    start_date: profile.start_date
  }));
}
function calendarPayload() {
  const pack = getCalendarPack();
  return {
    ...pack.calendar,
    months: pack.months,
    source: pack.source,
    first_day: pack.first_day,
    last_day: pack.last_day
  };
}
function importBackup(json, storage) {
  store.importState(json, storage);
  return currentSnapshot(storage);
}

// employee-tracker/src/notifications.js
var SEGMENT_LABELS = {
  AM: "AM",
  MIDDAY: "Midday",
  PM: "PM"
};
function buildEmployeeNotifications(snapshot2) {
  const reports = snapshot2?.reports ?? [];
  const notifications = [];
  for (const report of reports) {
    if (report?.outcome !== "STABLE") {
      continue;
    }
    const id = changeReportMatchKey(report) || report.id;
    if (!id) {
      continue;
    }
    const contractedTimes = describeContractedTimes(report);
    const timeChanges = describeTimeChanges(report);
    const contractedMinutes = report.see_the_math?.after?.payroll_rounded_total_minutes ?? snapshot2?.contracted?.minutes ?? null;
    notifications.push({
      id,
      event_type: "TIMES_CONTRACTED",
      title: "Your clock times are now contracted",
      detail: "The review window closed. These clock-in and clock-out times have been automatically contracted.",
      finalized_on: report.finalized_at ? String(report.finalized_at).slice(0, 10) : null,
      contracted_hours_statement: report.contracted_hours_statement || "",
      contracted_hours_label: typeof contractedMinutes === "number" ? formatDurationLabel(contractedMinutes) : snapshot2?.contracted?.label ?? null,
      time_changes: timeChanges,
      contracted_times: contractedTimes
    });
  }
  return notifications;
}
function visibleEmployeeNotifications(notifications, dismissedIds = []) {
  const dismissed = new Set(
    (dismissedIds ?? []).filter((id) => typeof id === "string" && id)
  );
  return (notifications ?? []).filter((note) => note?.id && !dismissed.has(note.id));
}
function describeContractedTimes(report) {
  const segments = report.after_segments ?? {};
  const rows = [];
  for (const segment of SEGMENTS) {
    const split = splitSegmentRange(segments[segment] ?? null);
    if (!split) continue;
    rows.push({
      segment,
      clock_in: split.clock_in,
      clock_out: split.clock_out,
      label: `${SEGMENT_LABELS[segment] ?? segment} ${split.clock_in}\u2013${split.clock_out}`
    });
  }
  return rows;
}
function describeTimeChanges(report) {
  return (report.contributing_changes ?? []).filter(
    (change2) => change2?.previous_time && change2?.new_time && change2.previous_time !== change2.new_time
  ).map((change2) => ({
    segment: change2.segment,
    previous_time: change2.previous_time,
    new_time: change2.new_time,
    label: `${SEGMENT_LABELS[change2.segment] ?? change2.segment} ${change2.previous_time} \u2192 ${change2.new_time}`
  }));
}

// public/shared/contractCitations.js
var CONTRACT_PUBLISHED_INDEX_URL = "https://www.bellinghamschools.org/about/departments/human-resources/collective-bargaining-agreements-and-salary-schedules";
var CONTRACT_PUBLISHED_PDF_URL = "https://resources.finalsite.net/images/v1786397695/bellinghamschoolsorg/lvay23uw9hvrfirn65td/2024-2027TeamstersCBA.pdf";
var CONTRACT_PDF_PAGE_OFFSET = 2;
function publishedContractPdfUrl(printedPage) {
  return `${CONTRACT_PUBLISHED_PDF_URL}#page=${printedPage + CONTRACT_PDF_PAGE_OFFSET}`;
}
var contractCitations = {
  "3.01": {
    label: "Art. 3.01",
    page: 3,
    text: `Definition of Seniority Date -- the employee's seniority date shall be defined as the date the employee commences regular employment with the District. The seniority order of employees hired on the same date shall be established by drawing lots.`
  },
  "3.08": {
    label: "Art. 3.08",
    page: 3,
    text: `Bus Driver Classification Vacancies -- The principles of seniority shall prevail when filling all vacant bus routes at the beginning of the school year, and thereafter when vacancies occur; provided, however, any employee successfully bidding from one bus route to another shall not be permitted to bid back to their previous route when it is subsequently posted as a result of their successful bid. This position and all changes resulting from the posting will go into effect on the same day.`
  },
  "3.08(a)(8)": {
    label: "Art. 3.08(a)(8)",
    page: 4,
    text: `8. On or before October 1, routes will be reviewed by the Transportation Director or their designee.`
  },
  "3.08(a)(8)(a)": {
    label: "Art. 3.08(a)(8)(a)",
    page: 4,
    text: `a. If an individual route has increased by thirty (30) minutes or more for fifteen (15) school days from the time of the initial bid, the route will go up for bid. Drivers will receive a written determination of an increase in their route and the notification that it will go up for bid.`
  },
  "3.08(a)(8)(b)": {
    label: "Art. 3.08(a)(8)(b)",
    page: 4,
    text: `b. If the route is decreased by thirty (30) minutes or more, that driver has the option of using their seniority to "bump" a driver with less seniority. Drivers will receive a written determination of a decrease in their route. Upon receipt of this written determination, the driver has two (2) school days to exercise their option to bump or confirm that they choose to retain their current assignment.`
  },
  "3.08(a)(8)(c)": {
    label: "Art. 3.08(a)(8)(c)",
    page: 4,
    text: `c. If a route increases or decreases by fifteen (15) minutes from the time of the initial bid, the time change will be made effective October 1.`
  },
  "3.08(b)": {
    label: "Art. 3.08(b)",
    page: 5,
    text: `b. Posting Routes Monthly After October 1st`
  },
  "3.08(b)(1)": {
    label: "Art. 3.08(b)(1)",
    page: 5,
    text: `1. During the last five (5) school days in each month from October through April, reposting will occur if a bus route is increased thirty (30) minutes or more for fifteen (15) school days or more. Drivers will receive a written determination of an increase in their route and the notification that it will go up for bid.`
  },
  "3.08(b)(2)": {
    label: "Art. 3.08(b)(2)",
    page: 5,
    text: `2. Upon determination that a route decreased thirty (30) minutes or more for fifteen (15) school days, that driver has the option of using their seniority to "bump" a driver with less seniority. Drivers will receive a written determination of a decrease in their route. Upon receipt of this written determination, the driver has two (2) school days to exercise their option to bump or confirm that they choose to retain their current assignment.`
  },
  "3.08(b)(3)": {
    label: "Art. 3.08(b)(3)",
    page: 5,
    text: `3. If a route increases by fifteen (15) minutes for fifteen (15) school days, the time change will be made effective on the workday following the 15th day.`
  },
  "3.08(b)(4)": {
    label: "Art. 3.08(b)(4)",
    page: 5,
    text: `4. Upon determination that a route decreased by fifteen (15) minutes, the driver will receive a written determination of a decrease in their route. The time change will be made effective the workday following the written notice of determination.`
  }
};

// employee-tracker/web/citations.js
function initCitations() {
  const dialog = document.querySelector("#citation");
  const titleEl = document.querySelector("#citation-title");
  const pageEl = document.querySelector("#citation-page");
  const textEl = document.querySelector("#citation-text");
  const pdfLink = document.querySelector("#citation-pdf");
  const indexLink = document.querySelector("#citation-index");
  const closeBtn = document.querySelector("#citation-close");
  if (!dialog || !titleEl || !pageEl || !textEl || !pdfLink || !closeBtn) {
    return { openCitation() {
    } };
  }
  if (indexLink) {
    indexLink.href = CONTRACT_PUBLISHED_INDEX_URL;
  }
  function closeCitation() {
    if (dialog.open) {
      dialog.close();
    }
  }
  function openCitation(citationId) {
    const entry = contractCitations[citationId];
    if (!entry) return;
    titleEl.textContent = entry.label;
    pageEl.textContent = `Teamsters CBA 2024\u20132027 \xB7 p. ${entry.page}`;
    textEl.textContent = entry.text;
    pdfLink.href = publishedContractPdfUrl(entry.page);
    if (!dialog.open) {
      dialog.showModal();
    }
  }
  closeBtn.addEventListener("click", closeCitation);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeCitation();
    }
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-citation]");
    if (!link) return;
    const id = link.getAttribute("data-citation");
    if (!id || !contractCitations[id]) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    openCitation(id);
  });
  return { openCitation };
}

// employee-tracker/web/examplePerson.js
var EXAMPLE_PROFILE_ID = "example-morgan-hale";
var EXAMPLE_SEEDED_KEY = "my-hours-tracker.example-seeded.v4";
var PRIOR_EXAMPLE_SEEDED_KEYS = ["my-hours-tracker.example-seeded.v3"];
var NAME = "Morgan Hale (example)";
var START = "2026-09-08";
function change(input) {
  const delta = computeDeltaMinutes(input.previous_time, input.new_time);
  return {
    id: input.id,
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: NAME,
    driver_id: null,
    segment: input.segment,
    submitted_at: input.submitted_at,
    effective_date: input.effective_date,
    previous_time: input.previous_time,
    new_time: input.new_time,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: "OTHER",
    note: input.note,
    entered_by: NAME
  };
}
function seed(segment, range, submittedAt) {
  return change({
    id: `example-seed-${segment.toLowerCase()}`,
    segment,
    previous_time: range,
    new_time: range,
    submitted_at: submittedAt,
    effective_date: START,
    note: "Starting schedule"
  });
}
var EXAMPLE_VIEW_AS_OF = "2026-11-16";
function exampleProfile() {
  return {
    id: EXAMPLE_PROFILE_ID,
    name: NAME,
    start_date: START,
    setup_at: "2026-09-08T12:00:00.000Z",
    created_at: "2026-09-08T12:00:00.000Z",
    example: true,
    view_as_of: EXAMPLE_VIEW_AS_OF,
    changeLog: [
      seed("AM", "6:15-8:45", "2026-09-08T12:00:00.000Z"),
      seed("MIDDAY", "11:00-12:15", "2026-09-08T12:00:00.001Z"),
      seed("PM", "14:10-16:40", "2026-09-08T12:00:00.002Z"),
      change({
        id: "example-am-decrease",
        segment: "AM",
        previous_time: "6:15-8:45",
        new_time: "6:15-8:10",
        submitted_at: "2026-09-09T15:00:00.000Z",
        effective_date: "2026-09-09",
        note: "AM clock-out moved earlier. Thirty-five minutes taken off before October 1, so this is bump-eligible the day it is written."
      }),
      change({
        id: "example-pm-increase",
        segment: "PM",
        previous_time: "14:10-16:40",
        new_time: "13:58-16:40",
        submitted_at: "2026-09-15T15:00:00.000Z",
        effective_date: "2026-09-15",
        note: "PM clock-in moved earlier. Twelve minutes added. A later change in this window replaced it."
      }),
      change({
        id: "example-midday-decrease",
        segment: "MIDDAY",
        previous_time: "11:00-12:15",
        new_time: "11:00-12:07",
        submitted_at: "2026-09-18T15:00:00.000Z",
        effective_date: "2026-09-18",
        note: "Midday clock-out moved earlier. Eight minutes taken off and added to the open window. The total stays under 30 minutes, so it waits until October 1."
      }),
      change({
        id: "example-oct-am-increase",
        segment: "AM",
        previous_time: "6:15-8:10",
        new_time: "6:15-8:25",
        submitted_at: "2026-10-06T15:00:00.000Z",
        effective_date: "2026-10-06",
        note: "Fifteen minutes added after October 1. Count 15 school days, then the new times become contracted on October 29."
      }),
      change({
        id: "example-nov-pm-increase",
        segment: "PM",
        previous_time: "13:58-16:40",
        new_time: "13:46-16:40",
        submitted_at: "2026-11-02T15:00:00.000Z",
        effective_date: "2026-11-02",
        note: "Twelve minutes added in November. The next change resets this count."
      }),
      change({
        id: "example-nov-midday-increase",
        segment: "MIDDAY",
        previous_time: "11:00-12:07",
        new_time: "11:00-12:25",
        submitted_at: "2026-11-09T15:00:00.000Z",
        effective_date: "2026-11-09",
        note: "Eighteen more minutes. 12 + 18 = 30, so this is a 30-minute increase. On November 16 the count is on school day 4. The bid waits for December 17."
      })
    ]
  };
}
function scenarioProfile(input) {
  const running = { AM: "6:00-8:00", PM: "14:00-16:00" };
  const changeLog = ["AM", "PM"].map(
    (segment, index) => changeFor(input.name, {
      id: `${input.id}-seed-${segment.toLowerCase()}`,
      segment,
      date: START,
      previous_time: running[segment],
      new_time: running[segment],
      submitted_at: `2026-09-08T12:00:00.00${index}Z`,
      note: "Starting schedule"
    })
  );
  input.changes.forEach((item, index) => {
    const previous = running[item.segment];
    running[item.segment] = item.new_time;
    changeLog.push(
      changeFor(input.name, {
        id: item.id,
        segment: item.segment,
        date: item.date,
        previous_time: previous,
        new_time: item.new_time,
        submitted_at: `${item.date}T15:00:0${index}.000Z`,
        note: item.note
      })
    );
  });
  return {
    id: input.id,
    name: input.name,
    start_date: START,
    setup_at: "2026-09-08T12:00:00.000Z",
    created_at: "2026-09-08T12:00:00.000Z",
    example: true,
    changeLog
  };
}
function changeFor(name, item) {
  const delta = computeDeltaMinutes(item.previous_time, item.new_time);
  return {
    id: item.id,
    route_id: EMPLOYEE_ROUTE_ID,
    driver_name: name,
    driver_id: null,
    segment: item.segment,
    submitted_at: item.submitted_at,
    effective_date: item.date,
    previous_time: item.previous_time,
    new_time: item.new_time,
    computed_delta_minutes: delta,
    delta_minutes: delta,
    routing_adjustment: null,
    reason_category: "OTHER",
    note: item.note,
    entered_by: name
  };
}
function calendarExampleProfiles() {
  return [
    scenarioProfile({
      id: "example-before-small",
      name: "Ex before \xB7 small +12",
      changes: [
        {
          id: "before-small",
          segment: "AM",
          date: "2026-09-10",
          new_time: "5:48-8:00",
          note: "Twelve minutes added before October 1. Under 30, so this waits until October 1. No 15-day count."
        }
      ]
    }),
    scenarioProfile({
      id: "example-before-big-up",
      name: "Ex before \xB7 big +35",
      changes: [
        {
          id: "before-big-up",
          segment: "AM",
          date: "2026-09-08",
          new_time: "5:25-8:00",
          note: "Thirty-five minutes added on the first day. The 15 school days finish September 29, before October 1, so the route goes up for bid on September 30."
        }
      ]
    }),
    scenarioProfile({
      id: "example-before-big-down",
      name: "Ex before \xB7 big \u221235",
      changes: [
        {
          id: "before-big-down",
          segment: "AM",
          date: "2026-09-09",
          new_time: "6:35-8:00",
          note: "Thirty-five minutes taken off before October 1. Bump-eligible that same day. No 15-day count."
        }
      ]
    }),
    scenarioProfile({
      id: "example-before-add-up",
      name: "Ex before \xB7 +12 then +25",
      changes: [
        {
          id: "before-add-1",
          segment: "AM",
          date: "2026-09-09",
          new_time: "5:48-8:00",
          note: "Twelve minutes added. A later change in this window replaces it."
        },
        {
          id: "before-add-2",
          segment: "PM",
          date: "2026-09-16",
          new_time: "13:35-16:00",
          note: "Twenty-five more minutes. 12 + 25 = 37, so this is now a 30-minute increase. The 15 school days run past October 1, so the bid waits for the last five school days of October."
        }
      ]
    }),
    scenarioProfile({
      id: "example-after-small",
      name: "Ex after \xB7 small +15",
      changes: [
        {
          id: "after-small",
          segment: "AM",
          date: "2026-10-06",
          new_time: "5:45-8:00",
          note: "Fifteen minutes added after October 1. Count 15 school days, then the new times become contracted on the next school day. A 15-minute decrease uses this same calendar shape."
        }
      ]
    }),
    scenarioProfile({
      id: "example-after-big-up",
      name: "Ex after \xB7 big +40",
      changes: [
        {
          id: "after-big-up",
          segment: "AM",
          date: "2026-10-06",
          new_time: "5:20-8:00",
          note: "Forty minutes added after October 1. After 15 school days it is posted for bid. Day 15 is October 28, so the bid day is October 29, inside that month\u2019s bid week."
        }
      ]
    }),
    scenarioProfile({
      id: "example-after-big-down",
      name: "Ex after \xB7 big \u221240",
      changes: [
        {
          id: "after-big-down",
          segment: "AM",
          date: "2026-10-06",
          new_time: "6:40-8:00",
          note: "Forty minutes taken off after October 1. Bump-eligible the day after the 15th school day, October 29. That day is not a contracted-hours box."
        }
      ]
    }),
    scenarioProfile({
      id: "example-after-add-up",
      name: "Ex after \xB7 +12 then +20",
      changes: [
        {
          id: "after-add-up-1",
          segment: "AM",
          date: "2026-10-02",
          new_time: "5:48-8:00",
          note: "Twelve minutes added. The next change resets this count."
        },
        {
          id: "after-add-up-2",
          segment: "PM",
          date: "2026-10-08",
          new_time: "13:40-16:00",
          note: "Twenty more minutes. 12 + 20 = 32, so this is a 30-minute increase. The bid is the last five school days of November, starting November 20."
        }
      ]
    }),
    scenarioProfile({
      id: "example-after-add-down",
      name: "Ex after \xB7 \u221212 then \u221220",
      changes: [
        {
          id: "after-add-down-1",
          segment: "AM",
          date: "2026-10-02",
          new_time: "6:12-8:00",
          note: "Twelve minutes taken off. The next change resets this count."
        },
        {
          id: "after-add-down-2",
          segment: "PM",
          date: "2026-10-08",
          new_time: "14:20-16:00",
          note: "Twenty more minutes taken off. 12 + 20 = 32 the other way, so this is a 30-minute decrease. Bump-eligible the day after school day 15, October 31. No contracted-hours box."
        }
      ]
    }),
    scenarioProfile({
      id: "example-nov-small",
      name: "Ex Nov \xB7 small +15",
      changes: [
        {
          id: "nov-small",
          segment: "AM",
          date: "2026-11-02",
          new_time: "5:45-8:00",
          note: "Fifteen minutes added in November. Count 15 school days, then the new times become contracted on November 25. A 15-minute decrease uses this same shape."
        }
      ]
    }),
    scenarioProfile({
      id: "example-nov-big-up",
      name: "Ex Nov \xB7 big +40",
      changes: [
        {
          id: "nov-big-up",
          segment: "AM",
          date: "2026-11-09",
          new_time: "5:20-8:00",
          note: "Forty minutes added November 9. School day 15 is December 3. The bid waits for December 17, the first day of December\u2019s bid week."
        }
      ]
    }),
    scenarioProfile({
      id: "example-nov-big-down",
      name: "Ex Nov \xB7 big \u221240",
      changes: [
        {
          id: "nov-big-down",
          segment: "AM",
          date: "2026-11-09",
          new_time: "6:40-8:00",
          note: "Forty minutes taken off November 9. Bump-eligible December 4, the day after school day 15. No contracted-hours box."
        }
      ]
    }),
    scenarioProfile({
      id: "example-nov-add-up",
      name: "Ex Nov \xB7 +12 then +20",
      changes: [
        {
          id: "nov-add-up-1",
          segment: "AM",
          date: "2026-11-02",
          new_time: "5:48-8:00",
          note: "Twelve minutes added. The next change resets this count."
        },
        {
          id: "nov-add-up-2",
          segment: "PM",
          date: "2026-11-09",
          new_time: "13:40-16:00",
          note: "Twenty more minutes. 12 + 20 = 32, so this is a 30-minute increase. The arrow points at December 17."
        }
      ]
    }),
    scenarioProfile({
      id: "example-nov-add-down",
      name: "Ex Nov \xB7 \u221212 then \u221220",
      changes: [
        {
          id: "nov-add-down-1",
          segment: "AM",
          date: "2026-11-02",
          new_time: "6:12-8:00",
          note: "Twelve minutes taken off. The next change resets this count."
        },
        {
          id: "nov-add-down-2",
          segment: "PM",
          date: "2026-11-09",
          new_time: "14:20-16:00",
          note: "Twenty more minutes taken off. 12 + 20 = 32 the other way. Bump-eligible December 4. No contracted-hours box."
        }
      ]
    }),
    scenarioProfile({
      id: "example-dec-small",
      name: "Ex Dec \xB7 small +15",
      changes: [
        {
          id: "dec-small",
          segment: "AM",
          date: "2026-12-01",
          new_time: "5:45-8:00",
          note: "Fifteen minutes added December 1. On December 10 this count is still open. It becomes contracted December 23."
        }
      ]
    }),
    scenarioProfile({
      id: "example-dec-big-up",
      name: "Ex Dec \xB7 big +40",
      changes: [
        {
          id: "dec-big-up",
          segment: "AM",
          date: "2026-12-01",
          new_time: "5:20-8:00",
          note: "Forty minutes added December 1. School day 15 is December 22, so the bid day is December 23, inside December\u2019s bid week."
        }
      ]
    }),
    scenarioProfile({
      id: "example-dec-big-down",
      name: "Ex Dec \xB7 big \u221240",
      changes: [
        {
          id: "dec-big-down",
          segment: "AM",
          date: "2026-12-01",
          new_time: "6:40-8:00",
          note: "Forty minutes taken off December 1. Bump-eligible December 23. No contracted-hours box."
        }
      ]
    }),
    scenarioProfile({
      id: "example-dec-add-up",
      name: "Ex Dec \xB7 +12 then +25",
      changes: [
        {
          id: "dec-add-up-1",
          segment: "AM",
          date: "2026-12-01",
          new_time: "5:48-8:00",
          note: "Twelve minutes added. The next change resets this count."
        },
        {
          id: "dec-add-up-2",
          segment: "PM",
          date: "2026-12-07",
          new_time: "13:35-16:00",
          note: "Twenty-five more minutes. 12 + 25 = 37. School day 15 is January 7, so the bid waits for January 25."
        }
      ]
    })
  ];
}
function exampleProfiles() {
  return [exampleProfile(), ...calendarExampleProfiles()];
}
function ensureExamplePerson(storage = globalThis.localStorage) {
  if (!storage || storage.getItem(EXAMPLE_SEEDED_KEY) === "1") {
    return getCurrentProfile(storage);
  }
  const alreadySeeded = PRIOR_EXAMPLE_SEEDED_KEYS.some(
    (key) => storage.getItem(key) === "1"
  );
  const state = loadState(storage);
  let changed = false;
  for (const profile of exampleProfiles()) {
    const existing = state.profiles[profile.id];
    if (!existing) {
      if (alreadySeeded) continue;
      state.profiles[profile.id] = profile;
      changed = true;
    } else if (existing.example) {
      state.profiles[profile.id] = profile;
      changed = true;
    }
  }
  if (!state.currentProfileId && state.profiles[EXAMPLE_PROFILE_ID]) {
    state.currentProfileId = EXAMPLE_PROFILE_ID;
  }
  if (changed) {
    saveState(state, storage);
  }
  storage.setItem(EXAMPLE_SEEDED_KEY, "1");
  return getCurrentProfile(storage);
}

// employee-tracker/web/peoplePicker.js
function personLabel(person) {
  const name = String(person?.name || "").trim();
  return name || "Unnamed";
}
function peopleMenuItems(people, query) {
  const q = String(query || "").trim().toLowerCase();
  const labeled = people.map((person) => ({
    type: (
      /** @type {'person'} */
      "person"
    ),
    id: person.id,
    label: personLabel(person)
  }));
  const matches = q ? labeled.filter((item) => item.label.toLowerCase().includes(q)) : labeled;
  const exactCount = q ? labeled.filter((item) => item.label.toLowerCase() === q).length : 0;
  const items = matches.map((item) => ({ ...item }));
  if (q && exactCount === 0) {
    items.push({
      type: "add",
      id: null,
      label: String(query).trim()
    });
  }
  return items;
}
function defaultPeopleHighlight(items, query, currentId) {
  if (!items.length) return 0;
  const q = String(query || "").trim().toLowerCase();
  if (!q && currentId) {
    const currentIndex = items.findIndex((item) => item.id === currentId);
    if (currentIndex >= 0) return currentIndex;
  }
  const firstPerson = items.findIndex((item) => item.type === "person");
  if (!q || firstPerson >= 0 && items[firstPerson].label.toLowerCase().startsWith(q)) {
    return Math.max(firstPerson, 0);
  }
  const addIndex = items.findIndex((item) => item.type === "add");
  return addIndex >= 0 ? addIndex : 0;
}

// employee-tracker/src/clockHistory.js
var CLOCK_HISTORY_TONES = [
  "#1f5c4a",
  "#2f5f9e",
  "#a15c12",
  "#6b3f78",
  "#0e7490",
  "#9a3d4a",
  "#3f6b2f",
  "#8a5a2b"
];
function shiftIsoDate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}
function clockHistoryLabel(row) {
  if (row?.kind === "initial") return "Established";
  const segment = row?.segments?.length > 1 ? "Schedule" : row?.segment === "MIDDAY" ? "Midday" : row?.segment || "Schedule";
  const delta = row?.delta_label ? ` ${row.delta_label}` : "";
  return `${segment} change${delta}`;
}
function fifteenSchoolDaysAfter(schoolDays, from) {
  try {
    const end = addSchoolDays(schoolDays, from, WINDOW_SCHOOL_DAYS);
    return schoolDays.filter((day) => day > from && day <= end);
  } catch {
    return schoolDays.filter((day) => day > from).slice(0, WINDOW_SCHOOL_DAYS);
  }
}
function usesFifteenDayWindow(row, fifteen) {
  if (row?.force_oct1_contract) return false;
  if (row?.kind !== "change" || !row.date || !fifteen.length) return false;
  const fifteenth = fifteen[fifteen.length - 1];
  const october1 = october1ForDate(row.date);
  const becomes = row.contracted?.becomes_on;
  if (becomes) {
    if (becomes === october1 && row.date < october1) return false;
    return shiftIsoDate(becomes, -1) >= fifteenth;
  }
  if (row.contracted?.status !== "superseded") return false;
  if (row.date >= october1) return true;
  if ((row.delta_minutes ?? 0) >= BID_THRESHOLD_MINUTES) {
    return fifteenth < october1;
  }
  return false;
}
function bidPeriodRanges(schoolDays) {
  const byMonth = /* @__PURE__ */ new Map();
  for (const day of monthlyBidPostingDays(schoolDays)) {
    const key = day.slice(0, 7);
    const group = byMonth.get(key);
    if (group) group.push(day);
    else byMonth.set(key, [day]);
  }
  return [...byMonth.values()].map((days) => ({
    start: days[0],
    end: days[days.length - 1],
    schoolDays: days
  }));
}
function resolvesAsBid(row) {
  const outcome = row?.contracted?.projected_outcome;
  const status = row?.contracted?.status;
  return outcome === "BID_PENDING" || status === "bid_pending";
}
function locksInAsContracted(row) {
  if (row?.kind !== "change" || !row.contracted?.becomes_on) return false;
  const outcome = row.contracted?.projected_outcome;
  const status = row.contracted?.status;
  if (outcome === "BID_PENDING" || outcome === "BUMP_ELIGIBLE") return false;
  if (status === "bid_pending" || status === "bump_eligible") return false;
  return true;
}
function resolutionArrow(row, fifteen, nextDate) {
  if (nextDate || row?.kind !== "change") return null;
  const becomes = row.contracted?.becomes_on;
  if (!becomes) return null;
  const start = usesFifteenDayWindow(row, fifteen) ? shiftIsoDate(fifteen[fifteen.length - 1], 1) : shiftIsoDate(row.date, 1);
  if (becomes <= start) return null;
  return { start, end: becomes };
}
function changeHoverLines(mark) {
  if (!mark?.isChange) return [];
  const lines = [`Current change: ${mark.label}`];
  if (mark.cumulativeLabel) {
    lines.push(`Cumulative change: ${mark.cumulativeLabel}`);
  }
  return lines;
}
function changeDetailLines(row) {
  if (!row || row.kind !== "change") return [];
  const segment = row.segment === "MIDDAY" ? "Midday" : row.segment || "Run";
  const lines = [];
  if (row.previous_time || row.new_time) {
    lines.push(`${segment} ${row.previous_time || "\u2014"} \u2192 ${row.new_time || "\u2014"}`);
  }
  if (row.note) lines.push(row.note);
  const contracted = row.contracted || {};
  for (const line of [contracted.label, contracted.projected_outcome_label, contracted.detail]) {
    if (line && !lines.includes(line)) lines.push(line);
  }
  return lines;
}
function changeHoverFlags(row) {
  const isChange = row?.kind === "change";
  const cumulative = row?.cumulative_drift_minutes;
  const own = row?.delta_minutes;
  const applies = isChange && typeof cumulative === "number" && typeof own === "number" && cumulative !== own && Boolean(row.cumulative_drift_label);
  return {
    isChange,
    cumulativeLabel: applies ? row.cumulative_drift_label : null
  };
}
function historyMark(toneIndex, tone, label, flags = {}) {
  return {
    toneIndex,
    tone,
    label,
    isChange: flags.isChange ?? false,
    cumulativeLabel: flags.cumulativeLabel ?? null,
    sourceIndex: flags.sourceIndex ?? null,
    established: flags.established ?? false,
    window: flags.window ?? false,
    windowDay: flags.windowDay ?? null,
    arrow: flags.arrow ?? false,
    arrowHead: flags.arrowHead ?? false,
    resolvesOn: flags.resolvesOn ?? null,
    goesToBid: flags.goesToBid ?? false,
    contractedDay: flags.contractedDay ?? false,
    arrowOrigin: flags.arrowOrigin ?? false,
    arrowFromWindow: flags.arrowFromWindow ?? false
  };
}
function buildClockHistoryMarks(rows, { schoolDays, tones = CLOCK_HISTORY_TONES }) {
  const marks = /* @__PURE__ */ new Map();
  const days = [...schoolDays].sort();
  const list = rows ?? [];
  const palette = tones.length ? tones : CLOCK_HISTORY_TONES;
  list.forEach((row, index) => {
    if (!row?.date) return;
    const toneIndex = index % palette.length;
    const tone = palette[toneIndex];
    const label = clockHistoryLabel(row);
    const hover = { ...changeHoverFlags(row), sourceIndex: index };
    const nextDate = list[index + 1]?.date || null;
    const fifteen = fifteenSchoolDaysAfter(days, row.date);
    marks.set(
      row.date,
      historyMark(toneIndex, tone, label, {
        ...hover,
        established: true
      })
    );
    if (usesFifteenDayWindow(row, fifteen)) {
      let windowDay = 0;
      for (const day of fifteen) {
        if (nextDate && day >= nextDate) break;
        windowDay += 1;
        const existing = marks.get(day);
        marks.set(
          day,
          historyMark(toneIndex, tone, label, {
            ...hover,
            established: existing?.established ?? false,
            window: true,
            windowDay
          })
        );
      }
    }
    const arrow = resolutionArrow(row, fifteen, nextDate);
    if (arrow) {
      const originDay = shiftIsoDate(arrow.start, -1);
      const origin = marks.get(originDay);
      const fromWindow = Boolean(origin?.window);
      if (origin) {
        marks.set(
          originDay,
          historyMark(toneIndex, tone, origin.label, {
            isChange: origin.isChange,
            cumulativeLabel: origin.cumulativeLabel,
            sourceIndex: origin.sourceIndex,
            established: origin.established,
            window: origin.window,
            windowDay: origin.windowDay,
            contractedDay: origin.contractedDay,
            arrowOrigin: true,
            arrowFromWindow: fromWindow
          })
        );
      }
      const arrowLast = shiftIsoDate(arrow.end, -1);
      let cursor = arrow.start;
      while (cursor < arrow.end) {
        marks.set(
          cursor,
          historyMark(toneIndex, tone, label, {
            ...hover,
            arrow: true,
            arrowHead: cursor === arrowLast,
            resolvesOn: arrow.end,
            goesToBid: resolvesAsBid(row),
            arrowFromWindow: fromWindow
          })
        );
        cursor = shiftIsoDate(cursor, 1);
      }
    }
    if (!nextDate && locksInAsContracted(row)) {
      const day = row.contracted.becomes_on;
      const existing = marks.get(day);
      marks.set(
        day,
        historyMark(toneIndex, tone, label, {
          ...hover,
          established: existing?.established ?? false,
          window: existing?.window ?? false,
          windowDay: existing?.windowDay ?? null,
          arrow: existing?.arrow ?? false,
          arrowHead: existing?.arrowHead ?? false,
          resolvesOn: existing?.resolvesOn ?? null,
          contractedDay: true
        })
      );
    }
  });
  return marks;
}

// employee-tracker/src/changesCsv.js
var HEADERS = [
  "Name",
  "Date",
  "Run",
  "Previous times",
  "New times",
  "Change minutes",
  "Cumulative minutes",
  "Note",
  "Contracted status",
  "Becomes contracted on",
  "Result",
  "AM",
  "Midday",
  "PM"
];
function runLabel(segment) {
  if (segment === "MIDDAY") return "Midday";
  return segment || "";
}
function scheduleRange(schedule, segment) {
  const item = schedule?.[segment];
  if (!item) return "";
  if (item.range) return item.range;
  if (item.clock_in && item.clock_out) {
    return `${item.clock_in}-${item.clock_out}`;
  }
  return "";
}
function numberCell(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
function buildChangesCsv(snapshot2) {
  const name = snapshot2?.employee?.name?.trim() || "";
  const changes = (snapshot2?.schedule_history ?? []).filter(
    (row) => row?.kind === "change"
  );
  const lines = [
    HEADERS.map(csvCell).join(","),
    ...changes.map(
      (row) => [
        name,
        row.date || "",
        runLabel(row.segment),
        row.previous_time || "",
        row.new_time || "",
        numberCell(row.delta_minutes),
        numberCell(row.cumulative_drift_minutes),
        row.note || "",
        row.contracted?.label || "",
        row.contracted?.becomes_on || "",
        row.contracted?.projected_outcome_label || "",
        scheduleRange(row.schedule, "AM"),
        scheduleRange(row.schedule, "MIDDAY"),
        scheduleRange(row.schedule, "PM")
      ].map(csvCell).join(",")
    )
  ];
  return `\uFEFF${lines.join("\r\n")}\r
`;
}
function changesCsvFilename(name) {
  const slug = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `${slug}-clock-time-changes.csv` : "clock-time-changes.csv";
}

// employee-tracker/web/app.js
var import_qrcode = __toESM(require_browser(), 1);
var PAGE_TITLE = "My Teamster Contract Date Calculator";
var RUNS = [
  { id: "AM", label: "AM", inName: "am_in", outName: "am_out" },
  { id: "MIDDAY", label: "Midday", inName: "midday_in", outName: "midday_out" },
  { id: "PM", label: "PM", inName: "pm_in", outName: "pm_out" }
];
var setupView = document.querySelector("#setup-view");
var appView = document.querySelector("#app-view");
var setupRuns = document.querySelector("#setup-runs");
var setupForm = document.querySelector("#setup-form");
var setupStatus = document.querySelector("#setup-status");
var changeForm = document.querySelector("#change-form");
var changeDialog = document.querySelector("#change-dialog");
var changeStatus = document.querySelector("#change-status");
var scheduleStatus = document.querySelector("#schedule-status");
var previewBox = document.querySelector("#preview-box");
var hero = document.querySelector("#hero");
var scheduleLead = document.querySelector("#schedule-lead");
var scheduleHistory = document.querySelector("#schedule-history");
var notificationToasts = document.querySelector("#notification-toasts");
var calendarMonths = document.querySelector("#calendar-months");
var historyLegend = document.querySelector("#history-legend");
var calendarPill = document.querySelector("#calendar-pill");
var profileSelect = document.querySelector("#profile_select");
var profileOptions = document.querySelector("#profile_options");
var startEditForm = document.querySelector("#start-edit-form");
var startEditRuns = document.querySelector("#start-edit-runs");
var startEditStatus = document.querySelector("#start-edit-status");
var changeEditForm = document.querySelector("#change-edit-form");
var changeEditStatus = document.querySelector("#change-edit-status");
var snapshot = null;
var addingPerson = false;
var peopleMenuOpen = false;
var peopleQueryDirty = false;
var peopleHighlight = -1;
var suppressPeopleBlur = false;
function toTimeInput(clock) {
  if (!clock) return "";
  const [h, m] = String(clock).split(":");
  return `${String(h).padStart(2, "0")}:${m}`;
}
function prettyDate2(iso) {
  if (!iso) return "\u2014";
  return (/* @__PURE__ */ new Date(`${iso}T12:00:00`)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
function setStatus(el, message, kind = "") {
  el.hidden = !message;
  el.textContent = message || "";
  el.className = `status${kind ? ` is-${kind}` : ""}`;
}
function peopleMenuQuery() {
  return peopleQueryDirty ? profileSelect.value : "";
}
function syncProfileField() {
  if (document.activeElement === profileSelect && peopleQueryDirty) return;
  if (addingPerson) {
    profileSelect.value = document.querySelector("#setup_name").value || "";
    return;
  }
  profileSelect.value = getCurrentProfile()?.name || "";
}
function closePeopleMenu() {
  peopleMenuOpen = false;
  peopleQueryDirty = false;
  peopleHighlight = -1;
  profileOptions.hidden = true;
  profileOptions.innerHTML = "";
  profileOptions.style.top = "";
  profileOptions.style.left = "";
  profileOptions.style.width = "";
  profileOptions.style.maxHeight = "";
  profileSelect.setAttribute("aria-expanded", "false");
  profileSelect.removeAttribute("aria-activedescendant");
}
function placePeopleOptions() {
  if (profileOptions.hidden) return;
  const box = profileSelect.getBoundingClientRect();
  const room = window.innerHeight - box.bottom - 12;
  profileOptions.style.top = `${Math.round(box.bottom + 4)}px`;
  profileOptions.style.left = `${Math.round(box.left)}px`;
  profileOptions.style.width = `${Math.round(box.width)}px`;
  profileOptions.style.maxHeight = `${Math.max(120, Math.floor(room))}px`;
}
function renderPeopleMenu() {
  const query = peopleMenuQuery();
  const currentId = addingPerson ? null : getCurrentProfile()?.id;
  const items = peopleMenuItems(peopleList(), query);
  if (peopleHighlight < 0 || peopleHighlight >= items.length) {
    peopleHighlight = defaultPeopleHighlight(items, query, currentId);
  }
  profileOptions.innerHTML = "";
  items.forEach((item, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.id = `profile_option_${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === peopleHighlight ? "true" : "false");
    if (index === peopleHighlight) button.classList.add("is-active");
    if (item.type === "add") {
      button.classList.add("is-add");
      button.textContent = `Add ${item.label}`;
    } else {
      button.textContent = item.label;
    }
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      suppressPeopleBlur = true;
      if (item.type === "add") beginAddPerson(item.label);
      else choosePerson(item.id);
      suppressPeopleBlur = false;
    });
    li.append(button);
    profileOptions.append(li);
  });
  const active = profileOptions.querySelector(".is-active");
  if (active instanceof HTMLElement) {
    profileSelect.setAttribute("aria-activedescendant", active.id);
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < profileOptions.scrollTop) {
      profileOptions.scrollTop = top;
    } else if (bottom > profileOptions.scrollTop + profileOptions.clientHeight) {
      profileOptions.scrollTop = bottom - profileOptions.clientHeight;
    }
  } else {
    profileSelect.removeAttribute("aria-activedescendant");
  }
  profileSelect.setAttribute("aria-expanded", "true");
  profileOptions.hidden = items.length === 0;
  placePeopleOptions();
}
function openPeopleMenu() {
  peopleMenuOpen = true;
  renderPeopleMenu();
}
function renderPeople() {
  syncProfileField();
  if (peopleMenuOpen) renderPeopleMenu();
}
function choosePerson(id) {
  const current = getCurrentProfile();
  if (!addingPerson && current?.id === id) {
    closePeopleMenu();
    syncProfileField();
    return;
  }
  addingPerson = false;
  closePeopleMenu();
  snapshot = switchPerson(id);
  loadAll();
  profileSelect.value = getCurrentProfile()?.name || "";
}
function activatePeopleHighlight() {
  const query = peopleMenuQuery();
  const currentId = addingPerson ? null : getCurrentProfile()?.id;
  const items = peopleMenuItems(peopleList(), query);
  if (!items.length) return;
  let index = peopleHighlight;
  if (index < 0 || index >= items.length) {
    index = defaultPeopleHighlight(items, query, currentId);
  }
  const item = items[index];
  if (item.type === "add") beginAddPerson(item.label);
  else choosePerson(item.id);
}
function beginAddPerson(name) {
  const keepForm = addingPerson && !setupView.hidden;
  addingPerson = true;
  closePeopleMenu();
  showSetup(!keepForm);
  document.querySelector("#setup_name").value = name;
  profileSelect.value = name;
  document.querySelector("#setup_name").focus();
}
function renderSetupRuns() {
  setupRuns.innerHTML = RUNS.map(
    (run) => `
      <div class="run-card">
        <h3>${run.label}</h3>
        <div class="pair">
          <div class="field">
            <label for="${run.inName}">Clock-in</label>
            <input id="${run.inName}" name="${run.inName}" type="time" step="60" />
          </div>
          <div class="field">
            <label for="${run.outName}">Clock-out</label>
            <input id="${run.outName}" name="${run.outName}" type="time" step="60" />
          </div>
        </div>
      </div>`
  ).join("");
}
function fillChangeFormFromSegment() {
  if (!snapshot?.schedule) return;
  const segment = document.querySelector("#change_segment").value;
  const current = snapshot.schedule[segment];
  document.querySelector("#clock_in").value = current ? toTimeInput(current.clock_in) : "";
  document.querySelector("#clock_out").value = current ? toTimeInput(current.clock_out) : "";
}
function renderNotifications() {
  if (!notificationToasts) return;
  notificationToasts.innerHTML = "";
  const profile = getCurrentProfile();
  if (!snapshot?.setup_complete || addingPerson || !profile) {
    notificationToasts.hidden = true;
    document.title = PAGE_TITLE;
    return;
  }
  const pending = visibleEmployeeNotifications(
    buildEmployeeNotifications(snapshot),
    listDismissedNotificationIds(profile.id)
  );
  if (!pending.length) {
    notificationToasts.hidden = true;
    document.title = PAGE_TITLE;
    return;
  }
  notificationToasts.hidden = false;
  document.title = `(${pending.length}) ${PAGE_TITLE}`;
  for (const note of pending) {
    const toast = document.createElement("article");
    toast.className = "notification-toast is-flashing";
    toast.dataset.id = note.id;
    toast.addEventListener(
      "animationend",
      () => {
        toast.classList.remove("is-flashing");
      },
      { once: true }
    );
    const kicker = document.createElement("p");
    kicker.className = "notification-toast-kicker";
    kicker.textContent = note.finalized_on ? `Locked in ${prettyDate2(note.finalized_on)}` : "Locked in";
    const title = document.createElement("h2");
    title.className = "notification-toast-title";
    title.textContent = note.title;
    const detail = document.createElement("p");
    detail.className = "notification-toast-text";
    detail.textContent = note.detail;
    toast.append(kicker, title, detail);
    const timeLines = note.time_changes.length ? note.time_changes : note.contracted_times;
    if (timeLines.length) {
      const list = document.createElement("ul");
      list.className = "notification-toast-times";
      for (const row of timeLines) {
        const item = document.createElement("li");
        item.textContent = row.label;
        list.append(item);
      }
      toast.append(list);
    }
    if (note.contracted_hours_statement || note.contracted_hours_label) {
      const hours = document.createElement("p");
      hours.className = "notification-toast-hours";
      hours.textContent = note.contracted_hours_statement || `Contracted hours: ${note.contracted_hours_label}`;
      toast.append(hours);
    }
    const actions = document.createElement("div");
    actions.className = "notification-toast-actions";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "secondary js-dismiss-notification";
    dismiss.textContent = "Dismiss";
    actions.append(dismiss);
    toast.append(actions);
    notificationToasts.append(toast);
  }
}
function renderHero() {
  const windowInfo = snapshot.window;
  const contracted = snapshot.contracted;
  const name = snapshot.employee?.name;
  const outcome = windowInfo?.projected_outcome;
  hero.className = `hero panel${outcome === "BID_PENDING" ? " outcome-bid" : outcome === "BUMP_ELIGIBLE" ? " outcome-bump" : ""}`;
  const title = windowInfo?.becomes_contracted_on ? `Becomes contracted on ${prettyDate2(windowInfo.becomes_contracted_on)}` : windowInfo?.status === "STABLE" ? "No open window" : windowInfo?.status_label || "Your hours";
  hero.innerHTML = `
    <p class="hero-kicker">${name ? `${name} \xB7 ` : ""}${windowInfo?.status_label || "Not set up"}</p>
    <h1 class="hero-title">${title}</h1>
    <p class="hero-detail">${windowInfo?.headline || ""}</p>
    <ul class="stat-row">
      <li><span>Contracted hours</span><strong>${contracted?.label || "\u2014"}</strong></li>
      <li><span>Accumulated difference</span><strong>${windowInfo?.cumulative_drift_label || "0 min"}</strong></li>
      <li><span>School days left in window</span><strong>${windowInfo?.days_remaining == null ? "\u2014" : windowInfo.days_remaining}</strong></li>
    </ul>
    ${windowInfo?.projected_outcome_detail ? `<p class="hero-detail">${windowInfo.projected_outcome_detail}</p>` : ""}
    ${windowInfo?.contracted_hours_statement ? `<p class="hero-detail">${windowInfo.contracted_hours_statement}</p>` : ""}
  `;
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function formatRange(item) {
  if (!item) return "\u2014";
  return `${item.clock_in}\u2013${item.clock_out}`;
}
function renderScheduleHistory() {
  const start = snapshot.employee?.start_date;
  const rows = snapshot.schedule_history || [];
  scheduleLead.textContent = start ? `Each row is a full schedule. The first row is the established starting times from ${prettyDate2(start)}. Later rows are changes, oldest to newest.` : "Each row is a full schedule. The first row is the established starting times. Later rows are changes, oldest to newest.";
  const downloadChangesBtn = document.querySelector("#download-changes-btn");
  const changeCount = rows.filter((row) => row.kind === "change").length;
  if (downloadChangesBtn) {
    downloadChangesBtn.disabled = changeCount === 0;
    downloadChangesBtn.title = changeCount === 0 ? "No clock-time changes to download yet." : "";
  }
  const body = scheduleHistory.querySelector("tbody");
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No clock times recorded yet.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row, index) => {
    const predicted = row.contracted?.status === "predicted";
    const kind = row.kind === "initial" ? "Established" : `${row.segment} change${row.delta_label ? ` \xB7 ${row.delta_label}` : ""}`;
    const contractedLabel = escapeHtml(row.contracted?.label || "\u2014");
    const contractedDetail = row.contracted?.projected_outcome_label ? `<span class="contracted-detail">${escapeHtml(
      row.contracted.projected_outcome_label
    )}</span>` : "";
    const note = row.note ? `<span class="change-note">${escapeHtml(row.note)}</span>` : "";
    const actions = row.kind === "change" ? `<div class="row-actions">
              <button type="button" class="secondary js-delete-change">Remove</button>
            </div>` : "";
    return `<tr class="is-history${predicted ? " is-predicted" : ""}" style="--tone:${toneForRow(index)}"${row.change_id ? ` data-change-id="${escapeHtml(row.change_id)}"` : ""}${row.kind === "initial" ? ' data-row-kind="initial"' : ""}>
        <th scope="row">
          ${prettyDate2(row.date)}
          <span class="row-kind">${escapeHtml(kind)}</span>
        </th>
        ${RUNS.map((run) => {
      const changed = row.segment === run.id;
      const item = row.schedule?.[run.id];
      const source = row.time_sources?.[run.id];
      const range = formatRange(item);
      const edit = item && source ? `<button type="button" class="secondary time-edit js-edit-time" data-time-source="${escapeHtml(
        source
      )}" data-segment="${run.id}" aria-label="${escapeHtml(
        `Edit ${run.label} ${range}`
      )}">Edit</button>` : "";
      return `<td${changed ? ' class="is-changed"' : ""}>
            <div class="time-line">
              <span class="times">${range}</span>
              ${edit}
            </div>
            ${changed ? `<span class="change-note">was ${escapeHtml(
        row.previous_time || "\u2014"
      )}</span>` : ""}
          </td>`;
    }).join("")}
        <td>
          <span class="contracted-label">${contractedLabel}</span>
          ${contractedDetail}
          ${note}
        </td>
        <td>${actions}</td>
      </tr>`;
  }).join("");
}
function toneForRow(index) {
  return CLOCK_HISTORY_TONES[index % CLOCK_HISTORY_TONES.length];
}
function renderHistoryLegend(rows) {
  if (!historyLegend) return;
  historyLegend.innerHTML = rows.map((row, index) => {
    const tone = toneForRow(index);
    return `<li style="--tone:${tone}">
        <span class="history-swatch" aria-hidden="true"></span>
        ${prettyDate2(row.date)} \xB7 ${escapeHtml(clockHistoryLabel(row))}
      </li>`;
  }).join("") + `<li class="is-key-note">
      <span class="history-swatch is-bid" aria-hidden="true"></span>
      End-of-month bid period: the last five school days of October through April, when a 30-minute increase is posted for bid.
    </li>`;
}
function renderCalendar() {
  const calendar = calendarPayload();
  const rows = snapshot?.schedule_history || [];
  const schoolDays = getSchoolDays(calendar);
  const marks = buildClockHistoryMarks(rows, { schoolDays });
  const bidRanges = bidPeriodRanges(schoolDays);
  renderHistoryLegend(rows);
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = snapshot?.as_of || localDateString();
  calendarMonths.innerHTML = (calendar.months || []).map((month) => {
    const first = month.days[0];
    const pad = first ? (/* @__PURE__ */ new Date(`${first.date}T00:00:00Z`)).getUTCDay() : 0;
    const blanks = Array.from({ length: pad }, (_, index) => {
      return `<div class="cal-day" style="grid-column:${index + 1};grid-row:2"></div>`;
    });
    const days = month.days.map((day, index) => {
      const num = Number(day.date.slice(-2));
      const offReason = day.is_school_day ? "" : day.reason || "Off";
      const skipLabel = !offReason || offReason === "Weekend" || offReason.startsWith("Outside school year");
      const short = !day.is_school_day && !skipLabel ? offReason.replace(" (students off)", "") : "";
      const mark = marks.get(day.date);
      const inBid = bidRanges.some(
        (range) => day.date >= range.start && day.date <= range.end
      );
      const slot = pad + index;
      const col = slot % 7 + 1;
      const row = Math.floor(slot / 7) + 2;
      const dow = (/* @__PURE__ */ new Date(`${day.date}T00:00:00Z`)).getUTCDay();
      const isToday = day.date === today;
      const changeLines = mark ? changeHoverLines(mark) : [];
      const detailLines = mark?.sourceIndex == null ? [] : changeDetailLines(rows[mark.sourceIndex]);
      const classes = [
        "cal-day",
        day.is_school_day ? "is-school" : "is-off",
        mark?.arrow ? "is-bid-arrow" : "",
        mark?.arrow && dow !== 0 ? "is-arrow-join" : "",
        mark?.arrow && !mark.arrowHead && dow !== 6 ? "is-arrow-bridge" : "",
        mark?.arrowOrigin ? "is-arrow-origin" : "",
        mark?.arrowOrigin && dow !== 6 ? "is-arrow-origin-bridge" : "",
        mark?.arrowFromWindow ? "is-arrow-from-window" : "",
        mark?.contractedDay ? "is-contracted" : "",
        isToday ? "is-today" : "",
        changeLines.length ? "is-hover-change" : "",
        changeLines.length && col <= 2 ? "is-tip-start" : "",
        changeLines.length && col >= 6 ? "is-tip-end" : ""
      ].filter(Boolean).join(" ");
      const titleParts = [day.is_school_day ? "School day" : offReason];
      if (isToday) titleParts.unshift("Today's date");
      if (inBid) titleParts.push("End-of-month bid period");
      if (mark?.arrow) {
        const when = mark.resolvesOn ? prettyDate2(mark.resolvesOn) : "resolution";
        const aim = mark.goesToBid ? `Goes to bid ${when}` : `Points to ${when}`;
        if (changeLines.length) {
          titleParts.push(...changeLines, aim);
        } else {
          titleParts.push(`${mark.label} \xB7 ${aim.charAt(0).toLowerCase()}${aim.slice(1)}`);
        }
      } else if (mark) {
        if (changeLines.length) titleParts.push(...changeLines);
        else titleParts.push(mark.label);
        if (mark.established) titleParts.push("established");
        if (mark.windowDay) titleParts.push(`school day ${mark.windowDay} of 15`);
        if (mark.contractedDay) titleParts.push("became contracted");
      }
      const popupLines = [
        ...titleParts,
        ...detailLines.filter((line) => !titleParts.includes(line))
      ];
      const hoverList = changeLines.length ? `<ul class="cal-hover" role="tooltip">${popupLines.map((line) => {
        const isChangeLine = line.startsWith("Current change:") || line.startsWith("Cumulative change:");
        const isDetail = !titleParts.includes(line);
        const itemClass = [isChangeLine ? "is-change" : "", isDetail ? "is-detail" : ""].filter(Boolean).join(" ");
        return `<li${itemClass ? ` class="${itemClass}"` : ""}>${escapeHtml(line)}</li>`;
      }).join("")}</ul>` : "";
      const showPip = mark && !mark.arrow && (mark.window || mark.established);
      const pip = showPip ? `<span class="history-pip${mark.established ? " is-established" : ""}${mark.window ? " is-window" : ""}" style="--tone:${mark.tone}">${mark.windowDay ? `#${mark.windowDay}` : ""}</span>` : "";
      const arrow = mark?.arrow ? `<span class="bid-arrow${mark.arrowHead ? " is-head" : ""}" style="--tone:${mark.tone}"></span>` : "";
      const toneStyle = mark?.contractedDay || mark?.arrowOrigin ? `;--tone:${mark.tone}` : "";
      const hoverAttrs = hoverList ? ` data-date="${day.date}" aria-label="${escapeHtml(titleParts.join(". "))}" tabindex="0"` : ` title="${escapeHtml(titleParts.join(" \xB7 "))}"`;
      return `<div class="${classes}" style="grid-column:${col};grid-row:${row}${toneStyle}"${hoverAttrs}><span class="num">${num}</span>${pip}${arrow}${short ? `<span class="why">${escapeHtml(short)}</span>` : ""}${hoverList}</div>`;
    });
    const rects = bidRectMarkup(bidRanges, month.days, pad);
    return `<div class="month-block">
        <h3>${month.label}</h3>
        <div class="month-grid">
          ${dows.map(
      (label, index) => `<div class="dow" style="grid-column:${index + 1};grid-row:1">${label}</div>`
    ).join("")}
          ${blanks.join("")}${days.join("")}${rects}
        </div>
      </div>`;
  }).join("");
}
function bidRectMarkup(ranges, monthDays, pad) {
  const html = [];
  for (const range of ranges) {
    const indexes = [];
    monthDays.forEach((day, index) => {
      if (day.date >= range.start && day.date <= range.end) indexes.push(index);
    });
    if (!indexes.length) continue;
    let segment = null;
    const segments = [];
    for (const index of indexes) {
      const slot = pad + index;
      const row = Math.floor(slot / 7);
      const col = slot % 7;
      if (segment && segment.row === row && col === segment.endCol + 1) {
        segment.endCol = col;
      } else {
        segment = { row, startCol: col, endCol: col };
        segments.push(segment);
      }
    }
    for (const seg of segments) {
      const gridRow = seg.row + 2;
      html.push(
        `<div class="bid-rect" style="grid-column:${seg.startCol + 1} / ${seg.endCol + 2};grid-row:${gridRow} / ${gridRow + 1}" title="End-of-month bid period"></div>`
      );
    }
  }
  return html.join("");
}
function showSetup(resetForm = false) {
  setupView.hidden = false;
  setupView.setAttribute("aria-hidden", "false");
  appView.hidden = true;
  if (resetForm) {
    setupForm.reset();
    document.querySelector("#setup_start_date").value = getAsOfDate();
    setStatus(setupStatus, "");
  }
}
function renderApp() {
  renderPeople();
  const ready = Boolean(snapshot?.setup_complete) && !addingPerson;
  if (!ready) {
    showSetup(false);
    renderNotifications();
    return;
  }
  setupView.hidden = true;
  setupView.setAttribute("aria-hidden", "true");
  appView.hidden = false;
  renderNotifications();
  renderHero();
  renderScheduleHistory();
  renderCalendar();
  fillChangeFormFromSegment();
}
function loadAll() {
  startEditForm.hidden = true;
  changeEditForm.hidden = true;
  if (!addingPerson) {
    ensureExamplePerson();
  }
  snapshot = addingPerson ? buildSnapshot(null) : currentSnapshot();
  const asOf = snapshot.as_of || getAsOfDate();
  const viewingAsOf = asOf !== localDateString();
  calendarPill.textContent = viewingAsOf ? `Viewing as of ${prettyDate2(asOf)}` : `BPS ${snapshot.calendar?.school_year || "2026-2027"} \xB7 ${snapshot.calendar?.school_day_count ?? 180} school days`;
  if (!document.querySelector("#setup_start_date").value) {
    document.querySelector("#setup_start_date").value = snapshot.as_of || getAsOfDate();
  }
  if (!document.querySelector("#change_date").value) {
    document.querySelector("#change_date").value = snapshot.as_of || getAsOfDate();
  }
  renderApp();
}
function updatePreview() {
  if (!snapshot?.setup_complete || addingPerson) return;
  const clockIn = document.querySelector("#clock_in").value;
  const clockOut = document.querySelector("#clock_out").value;
  const changeDate = document.querySelector("#change_date").value;
  const segment = document.querySelector("#change_segment").value;
  if (!clockIn || !clockOut || !changeDate) {
    previewBox.hidden = true;
    return;
  }
  try {
    const preview = previewChange({
      segment,
      clock_in: clockIn,
      clock_out: clockOut,
      change_date: changeDate
    });
    previewBox.hidden = false;
    previewBox.innerHTML = `
      <strong>${preview.delta_label}</strong> exact difference
      \xB7 window ends <strong>${prettyDate2(preview.window_expires_date)}</strong>
      \xB7 becomes contracted <strong>${prettyDate2(preview.becomes_contracted_on)}</strong>
      \xB7 ${preview.projected_outcome_label}
      <div class="meta">${preview.contracted_hours_statement || ""}</div>
    `;
    setStatus(changeStatus, "");
  } catch (error) {
    previewBox.hidden = true;
    setStatus(changeStatus, error.message, "error");
  }
}
setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(setupForm));
  try {
    snapshot = setupProfile(data);
    addingPerson = false;
    setStatus(setupStatus, "Starting times saved on this device.", "ok");
    loadAll();
  } catch (error) {
    setStatus(setupStatus, error.message, "error");
  }
});
changeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    snapshot = recordChange({
      segment: document.querySelector("#change_segment").value,
      change_date: document.querySelector("#change_date").value,
      clock_in: document.querySelector("#clock_in").value,
      clock_out: document.querySelector("#clock_out").value,
      note: document.querySelector("#change_note").value
    });
    document.querySelector("#change_note").value = "";
    setStatus(changeStatus, "");
    closeChangeDialog();
    setStatus(scheduleStatus, "Change recorded on this device.", "ok");
    renderApp();
  } catch (error) {
    setStatus(changeStatus, error.message, "error");
  }
});
document.querySelector("#change_segment").addEventListener("change", () => {
  fillChangeFormFromSegment();
  updatePreview();
});
document.querySelector("#change-reset").addEventListener("click", () => {
  fillChangeFormFromSegment();
  document.querySelector("#change_note").value = "";
  updatePreview();
});
for (const id of ["clock_in", "clock_out", "change_date"]) {
  document.querySelector(`#${id}`).addEventListener("change", updatePreview);
}
document.querySelector("#reset-btn").addEventListener("click", () => {
  if (!confirm("Erase this person\u2019s hours from this browser?")) return;
  snapshot = removeCurrentPerson();
  addingPerson = !getCurrentProfile();
  setupForm.reset();
  setStatus(setupStatus, "");
  loadAll();
});
profileSelect.addEventListener("focus", () => {
  peopleQueryDirty = false;
  peopleHighlight = -1;
  openPeopleMenu();
  profileSelect.select();
});
profileSelect.addEventListener("input", () => {
  peopleQueryDirty = true;
  peopleHighlight = -1;
  if (addingPerson) {
    document.querySelector("#setup_name").value = profileSelect.value;
  }
  openPeopleMenu();
});
profileSelect.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const query = peopleMenuQuery();
    const items = peopleMenuItems(peopleList(), query);
    if (!items.length) return;
    const currentId = addingPerson ? null : getCurrentProfile()?.id;
    if (!peopleMenuOpen || peopleHighlight < 0) {
      peopleHighlight = defaultPeopleHighlight(items, query, currentId);
    }
    const delta = event.key === "ArrowDown" ? 1 : -1;
    peopleHighlight = (peopleHighlight + delta + items.length) % items.length;
    peopleMenuOpen = true;
    renderPeopleMenu();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    activatePeopleHighlight();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closePeopleMenu();
    syncProfileField();
  }
});
profileSelect.addEventListener("blur", () => {
  if (suppressPeopleBlur) return;
  closePeopleMenu();
  syncProfileField();
});
document.querySelector("#setup_name").addEventListener("input", () => {
  if (!addingPerson || document.activeElement?.id !== "setup_name") return;
  profileSelect.value = document.querySelector("#setup_name").value;
});
document.querySelector("#add-person-btn").addEventListener("click", () => {
  addingPerson = true;
  showSetup(true);
  renderPeople();
});
document.querySelector("#export-btn").addEventListener("click", () => {
  const blob = new Blob([exportState()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "my-hours-tracker-backup.json";
  link.click();
  URL.revokeObjectURL(url);
});
document.querySelector("#download-changes-btn").addEventListener("click", () => {
  const csv = buildChangesCsv(snapshot);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = changesCsvFilename(snapshot?.employee?.name);
  link.click();
  URL.revokeObjectURL(url);
});
document.querySelector("#import-btn").addEventListener("click", () => {
  document.querySelector("#import-file").click();
});
function fillStartEditForm() {
  const fields = startingScheduleFields();
  document.querySelector("#start_edit_name").value = fields.name;
  document.querySelector("#start_edit_date").value = fields.start_date;
  startEditRuns.innerHTML = RUNS.map((run) => {
    const item = fields.segments[run.id];
    return `
      <div class="run-card">
        <h3>${run.label}</h3>
        <div class="pair">
          <div class="field">
            <label for="start_edit_${run.inName}">Clock-in</label>
            <input id="start_edit_${run.inName}" name="${run.inName}" type="time" step="60" value="${item ? toTimeInput(item.clock_in) : ""}" />
          </div>
          <div class="field">
            <label for="start_edit_${run.outName}">Clock-out</label>
            <input id="start_edit_${run.outName}" name="${run.outName}" type="time" step="60" value="${item ? toTimeInput(item.clock_out) : ""}" />
          </div>
        </div>
      </div>`;
  }).join("");
}
function openChangeDialog() {
  setStatus(changeStatus, "");
  if (!changeDialog.open) {
    changeDialog.showModal();
  }
  updatePreview();
}
function closeChangeDialog() {
  if (changeDialog.open) {
    changeDialog.close();
  }
}
var dayDialog = document.querySelector("#day-dialog");
var dayDialogTitle = document.querySelector("#day-dialog-title");
var dayDialogList = document.querySelector("#day-dialog-list");
function usesDayPopup() {
  return window.matchMedia("(max-width: 720px), (hover: none) and (pointer: coarse)").matches;
}
function openDayPopup(day) {
  const lines = [...day.querySelectorAll(".cal-hover li")].map((item) => item.textContent);
  dayDialogTitle.textContent = prettyDate2(day.dataset.date);
  dayDialogList.innerHTML = lines.map((line) => {
    const isChangeLine = line.startsWith("Current change:") || line.startsWith("Cumulative change:");
    return `<li${isChangeLine ? ' class="is-change"' : ""}>${escapeHtml(line)}</li>`;
  }).join("");
  if (!dayDialog.open) dayDialog.showModal();
}
function closeDayPopup() {
  if (dayDialog.open) dayDialog.close();
}
calendarMonths.addEventListener("click", (event) => {
  const day = event.target.closest(".cal-day.is-hover-change");
  if (!day || !usesDayPopup()) return;
  openDayPopup(day);
});
calendarMonths.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const day = event.target.closest(".cal-day.is-hover-change");
  if (!day || !usesDayPopup()) return;
  event.preventDefault();
  openDayPopup(day);
});
document.querySelector("#day-dialog-close").addEventListener("click", closeDayPopup);
dayDialog.addEventListener("click", (event) => {
  if (event.target === dayDialog) closeDayPopup();
});
document.querySelector("#record-change-btn").addEventListener("click", openChangeDialog);
document.querySelector("#change-dialog-close").addEventListener("click", closeChangeDialog);
changeDialog.addEventListener("click", (event) => {
  if (event.target === changeDialog) {
    closeChangeDialog();
  }
});
function openStartEditor(segment) {
  changeEditForm.hidden = true;
  fillStartEditForm();
  startEditForm.hidden = false;
  setStatus(startEditStatus, "");
  startEditForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const run = RUNS.find((item) => item.id === segment);
  if (run) {
    document.querySelector(`#start_edit_${run.inName}`)?.focus();
  }
}
document.querySelector("#edit-start-btn").addEventListener("click", openStartEditor);
document.querySelector("#start-edit-cancel").addEventListener("click", () => {
  startEditForm.hidden = true;
  setStatus(startEditStatus, "");
});
startEditForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(startEditForm));
  try {
    snapshot = updateStartingSchedule(data);
    startEditForm.hidden = true;
    setStatus(scheduleStatus, "Starting times corrected.", "ok");
    renderApp();
  } catch (error) {
    setStatus(startEditStatus, error.message, "error");
  }
});
function openChangeEditor(changeId) {
  const change2 = (snapshot.changes || []).find((item) => item.id === changeId);
  if (!change2) return;
  document.querySelector("#change_edit_id").value = change2.id;
  document.querySelector("#change_edit_date").value = change2.change_date;
  document.querySelector("#change_edit_segment").textContent = change2.segment;
  document.querySelector("#change_edit_in").value = toTimeInput(change2.next?.clock_in);
  document.querySelector("#change_edit_out").value = toTimeInput(change2.next?.clock_out);
  document.querySelector("#change_edit_note").value = change2.note || "";
  startEditForm.hidden = true;
  changeEditForm.hidden = false;
  setStatus(changeEditStatus, "");
  changeEditForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
scheduleHistory.addEventListener("click", (event) => {
  const timeEdit = event.target.closest(".js-edit-time");
  if (timeEdit) {
    const source = timeEdit.dataset.timeSource;
    if (source === "initial") openStartEditor(timeEdit.dataset.segment);
    else if (source) openChangeEditor(source);
    return;
  }
  if (event.target.closest(".js-edit-start")) {
    openStartEditor();
    return;
  }
  const row = event.target.closest("[data-change-id]");
  if (!row) return;
  const changeId = row.dataset.changeId;
  if (event.target.closest(".js-delete-change")) {
    if (!confirm("Remove this recorded change? The hours math will be rebuilt without it.")) {
      return;
    }
    try {
      snapshot = deleteChange(changeId);
      changeEditForm.hidden = true;
      setStatus(scheduleStatus, "Change removed.", "ok");
      renderApp();
    } catch (error) {
      setStatus(scheduleStatus, error.message, "error");
    }
  }
});
changeEditForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    snapshot = updateChange(document.querySelector("#change_edit_id").value, {
      change_date: document.querySelector("#change_edit_date").value,
      clock_in: document.querySelector("#change_edit_in").value,
      clock_out: document.querySelector("#change_edit_out").value,
      note: document.querySelector("#change_edit_note").value
    });
    changeEditForm.hidden = true;
    setStatus(scheduleStatus, "Change corrected.", "ok");
    renderApp();
  } catch (error) {
    setStatus(changeEditStatus, error.message, "error");
  }
});
document.querySelector("#change-edit-cancel").addEventListener("click", () => {
  changeEditForm.hidden = true;
  setStatus(changeEditStatus, "");
});
notificationToasts?.addEventListener("click", (event) => {
  const button = event.target.closest(".js-dismiss-notification");
  const toast = event.target.closest("[data-id]");
  if (!button || !toast) return;
  const profile = getCurrentProfile();
  if (!profile) return;
  dismissNotificationId(profile.id, toast.dataset.id);
  renderNotifications();
});
document.querySelector("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    snapshot = importBackup(await file.text());
    addingPerson = false;
    loadAll();
  } catch (error) {
    setStatus(setupStatus, error.message, "error");
    setupView.hidden = false;
  }
});
renderSetupRuns();
try {
  loadAll();
} catch (error) {
  setStatus(setupStatus, error.message, "error");
  setupView.hidden = false;
}
var personMenu = document.querySelector("#person-menu");
function fitPersonPanel() {
  const panel = personMenu?.querySelector(".person-menu-panel");
  const toggle = personMenu?.querySelector(".person-menu-toggle");
  if (!panel || !toggle || !personMenu.open) return;
  const room = window.innerHeight - toggle.getBoundingClientRect().bottom - 12;
  panel.style.maxHeight = `${Math.max(160, Math.floor(room))}px`;
}
personMenu?.addEventListener("toggle", () => {
  if (!personMenu.open) return;
  fitPersonPanel();
});
document.addEventListener("click", (event) => {
  if (!personMenu?.open) return;
  if (event.target instanceof Node && personMenu.contains(event.target)) return;
  personMenu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !personMenu?.open) return;
  personMenu.open = false;
});
window.addEventListener(
  "scroll",
  (event) => {
    if (!personMenu?.open) return;
    const panel = personMenu.querySelector(".person-menu-panel");
    if (event.target === panel || event.target === profileOptions) {
      if (event.target === panel && peopleMenuOpen) placePeopleOptions();
      return;
    }
    personMenu.open = false;
    closePeopleMenu();
  },
  true
);
window.addEventListener("resize", () => {
  if (personMenu?.open) fitPersonPanel();
  if (peopleMenuOpen) placePeopleOptions();
});
initCitations();
var PUBLISHED_SHARE_URL = "https://mern-ing-the-midnight-oil.github.io/hoursupdater/";
function appShareUrl() {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return PUBLISHED_SHARE_URL;
  const url = new URL(location.href);
  url.hash = "";
  url.search = "";
  return url.href;
}
function shareMessage(url) {
  return `${PAGE_TITLE}
${url}`;
}
var shareUrl = appShareUrl();
var shareQr = document.querySelector("#share-qr");
var shareUrlText = document.querySelector("#share-url");
var shareStatus = document.querySelector("#share-status");
var shareFallback = document.querySelector("#share-fallback");
var shareEmail = document.querySelector("#share-email");
var shareText = document.querySelector("#share-text");
if (shareUrlText) shareUrlText.textContent = shareUrl;
if (shareEmail) {
  const subject = encodeURIComponent(PAGE_TITLE);
  const body = encodeURIComponent(shareMessage(shareUrl));
  shareEmail.href = `mailto:?subject=${subject}&body=${body}`;
}
if (shareText) {
  const body = encodeURIComponent(shareMessage(shareUrl));
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  shareText.href = ios ? `sms:&body=${body}` : `sms:?body=${body}`;
}
if (shareQr) {
  import_qrcode.default.toCanvas(shareQr, shareUrl, {
    width: 168,
    margin: 1,
    color: { dark: "#1c2430", light: "#ffffff" }
  }).catch(() => {
    shareQr.replaceWith(Object.assign(document.createElement("p"), {
      className: "share-url",
      textContent: shareUrl
    }));
  });
}
document.querySelector("#share-btn")?.addEventListener("click", async () => {
  const payload = {
    title: PAGE_TITLE,
    text: "Track when clock-time changes become contracted hours.",
    url: shareUrl
  };
  if (navigator.share) {
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  if (shareFallback) shareFallback.hidden = false;
  if (shareStatus) {
    shareStatus.hidden = false;
    shareStatus.textContent = "Choose email or text to send the link.";
  }
});
