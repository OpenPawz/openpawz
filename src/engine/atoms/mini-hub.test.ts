// src/engine/atoms/mini-hub.test.ts
// Unit tests for mini-hub atom layer — pure types & functions.

import { describe, it, expect } from 'vitest';
import { SQUAD_COLORS, buildSquadAgentMap } from './mini-hub';

// ── SQUAD_COLORS ─────────────────────────────────────────────────────────

describe('SQUAD_COLORS', () => {
  it('contains exactly 8 colours', () => {
    expect(SQUAD_COLORS).toHaveLength(8);
  });

  it('has unique entries', () => {
    const unique = new Set(SQUAD_COLORS);
    expect(unique.size).toBe(SQUAD_COLORS.length);
  });

  it('first entry is the coordinator colour (accent)', () => {
    expect(SQUAD_COLORS[0]).toBe('var(--accent)');
  });

  it('all entries are non-empty strings', () => {
    for (const c of SQUAD_COLORS) {
      expect(typeof c).toBe('string');
      expect(c.length).toBeGreaterThan(0);
    }
  });
});

// ── buildSquadAgentMap ───────────────────────────────────────────────────

describe('buildSquadAgentMap', () => {
  it('builds a map from squad members', () => {
    const members = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta', avatar: '🐕' },
    ];
    const map = buildSquadAgentMap(members);
    expect(map.size).toBe(2);
    expect(map.get('a')).toEqual({
      name: 'Alpha',
      avatar: undefined,
      color: SQUAD_COLORS[0],
    });
    expect(map.get('b')).toEqual({
      name: 'Beta',
      avatar: '🐕',
      color: SQUAD_COLORS[1],
    });
  });

  it('uses provided color over auto-assigned SQUAD_COLORS', () => {
    const members = [{ id: 'x', name: 'X', color: '#ff0000' }];
    const map = buildSquadAgentMap(members);
    expect(map.get('x')!.color).toBe('#ff0000');
  });

  it('wraps SQUAD_COLORS when more than 8 members', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      name: `M${i}`,
    }));
    const map = buildSquadAgentMap(members);
    expect(map.get('m8')!.color).toBe(SQUAD_COLORS[0]); // wraps
    expect(map.get('m9')!.color).toBe(SQUAD_COLORS[1]);
  });

  it('returns empty map for empty array', () => {
    const map = buildSquadAgentMap([]);
    expect(map.size).toBe(0);
  });

  it('preserves avatar when provided', () => {
    const map = buildSquadAgentMap([{ id: 'a', name: 'A', avatar: '🤖' }]);
    expect(map.get('a')!.avatar).toBe('🤖');
  });

  it('sets avatar to undefined when not provided', () => {
    const map = buildSquadAgentMap([{ id: 'a', name: 'A' }]);
    expect(map.get('a')!.avatar).toBeUndefined();
  });
});
