const { calculateWeightLb } = require('../server/lib/scale-reader');

// Byte layout:
//   [0] Report ID
//   [1] Status: 2=stable@0, 4=stable
//   [2] Unit: 3=kg, 11=oz, 12=lb
//   [3] Data scaling multiplier
//   [4] Weight LSB
//   [5] Weight MSB
// Formula: weight = (d[3] * d[5] + d[4]) / 100, then unit-convert to lb

describe('calculateWeightLb', () => {
  test('zero reading', () => {
    expect(calculateWeightLb([0, 2, 12, 0, 0, 0])).toBe(0);
  });

  test('pounds — LSB only', () => {
    // (0 * 0 + 50) / 100 = 0.50 lb
    expect(calculateWeightLb([0, 4, 12, 0, 50, 0])).toBe(0.5);
  });

  test('pounds — MSB contributes via scaling byte', () => {
    // (1 * 1 + 50) / 100 = 0.51 lb
    expect(calculateWeightLb([0, 4, 12, 1, 50, 1])).toBe(0.51);
  });

  test('kilograms converted to pounds', () => {
    // (0 * 0 + 45) / 100 = 0.45 kg → * 2.2 = 0.99 lb
    expect(calculateWeightLb([0, 4, 3, 0, 45, 0])).toBe(0.99);
  });

  test('ounces converted to pounds', () => {
    // (0 * 0 + 160) / 100 = 1.6 oz → * 0.0625 = 0.1 lb
    expect(calculateWeightLb([0, 4, 11, 0, 160, 0])).toBe(0.1);
  });

  test('rounds to nearest hundredth', () => {
    // (0 * 0 + 1) / 100 = 0.01 lb
    expect(calculateWeightLb([0, 4, 12, 0, 1, 0])).toBe(0.01);
  });

  test('unknown unit treated as no conversion', () => {
    // unit byte 0 — switch falls through, weight unchanged
    // (0 * 0 + 100) / 100 = 1.00
    expect(calculateWeightLb([0, 4, 0, 0, 100, 0])).toBe(1);
  });
});

describe('simulate', () => {
  test('emits change event with given weight', (done) => {
    const { simulate, events } = require('../server/lib/scale-reader');
    events.once('change', (w) => {
      expect(w).toBe(1.23);
      done();
    });
    simulate(1.23);
  });

  test('rounds emitted weight to hundredths', (done) => {
    const { simulate, events } = require('../server/lib/scale-reader');
    events.once('change', (w) => {
      expect(w).toBe(1.23);
      done();
    });
    simulate(1.234567);
  });
});
