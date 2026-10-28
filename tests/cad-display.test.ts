// Display-mesh defaults for CAD import (2026.0.47). No OpenCascade — the formula is pure.
import { describe, expect, it } from 'vitest';
import { displayDeflection } from '../src/cad/occcore';

describe('CAD display deflection', () => {
  it('is several times coarser than diag/1500 and stays within 0.75 mm', () => {
    for (const diag of [40, 120, 360]) {
      const d = displayDeflection(diag);
      expect(d.linear).toBeGreaterThan((diag / 1500) * 3);
      expect(d.linear).toBeLessThanOrEqual(0.75);
      expect(d.linear).toBeGreaterThanOrEqual(0.15);
      expect(d.angular).toBeGreaterThan(0.35);
      expect(d.angular).toBeLessThanOrEqual(0.9);
    }
  });
  it('a 360 mm model no longer asks for a 0.24 mm chord', () => {
    const d = displayDeflection(360);
    expect(360 / 1500).toBeCloseTo(0.24, 2);
    expect(d.linear).toBeGreaterThanOrEqual(0.7);
  });
});
