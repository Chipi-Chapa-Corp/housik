import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, balances, cents, settle } from '../src/lib/money';
import type { Member, Expense, Tag } from '../src/lib/types';
const members = ['a', 'b', 'c'].map((id, i) => ({
  id,
  trip_id: 'trip',
  name: id,
  username: id,
  color: i
})) as Member[];
const expense = (changes: Partial<Expense> = {}): Expense => ({
  id: 'e',
  trip_id: 'trip',
  title: 'Groceries',
  amount: 1000,
  payer_id: 'a',
  kind: 'product',
  tag_id: null,
  receipt_id: null,
  note: '',
  date: '2026-11-11',
  choices: [],
  ...changes
});
const tag: Tag = { id: 't', trip_id: 'trip', name: 'Food', members: ['a', 'b'] };
test('decimal input is exact and rejects malformed amounts', () => {
  assert.equal(cents('1.01'), 101);
  assert.equal(cents('17,99'), 1799);
  assert.equal(cents('0.1'), 10);
  for (const value of ['-1', '1.999', '1e4', 'Infinity', '', NaN])
    assert.throws(() => cents(value));
});
test('integer-cent shares preserve the total', () => {
  assert.deepEqual(
    [...allocate(expense(), members, [])],
    [
      ['a', 334],
      ['b', 333],
      ['c', 333]
    ]
  );
});
test('tags define payers; self inclusion and exclusion override defaults', () => {
  const e = expense({
    tag_id: 't',
    choices: [
      { member_id: 'a', mode: 'exclude', extra: 0 },
      { member_id: 'c', mode: 'share', extra: 0 }
    ]
  });
  assert.deepEqual(
    [...allocate(e, members, [tag])],
    [
      ['a', 0],
      ['b', 500],
      ['c', 500]
    ]
  );
});
test('full payers alone share the bill, even outside a tag', () => {
  const e = expense({ tag_id: 't', choices: [{ member_id: 'c', mode: 'full', extra: 0 }] });
  assert.deepEqual(
    [...allocate(e, members, [tag])],
    [
      ['a', 0],
      ['b', 0],
      ['c', 1000]
    ]
  );
});
test('extra is added to the ordinary share, with no discount to its volunteer', () => {
  const e = expense({ amount: 900, choices: [{ member_id: 'b', mode: 'extra', extra: 100 }] });
  assert.deepEqual(
    [...allocate(e, members, [])],
    [
      ['a', 250],
      ['b', 400],
      ['c', 250]
    ]
  );
});
test('impossible allocations are rejected', () => {
  assert.throws(() =>
    allocate(
      expense({ choices: members.map((m) => ({ member_id: m.id, mode: 'exclude', extra: 0 })) }),
      members,
      []
    )
  );
  assert.throws(() =>
    allocate(expense({ choices: [{ member_id: 'a', mode: 'extra', extra: 1001 }] }), members, [])
  );
});
test('overpayment reverses balances and still sums to zero', () => {
  const rows = balances(
    members,
    [expense({ amount: 900 })],
    [],
    [{ from_id: 'b', to_id: 'a', amount: 1000 }]
  );
  assert.deepEqual(
    rows.map((r) => r.net),
    [-400, 700, -300]
  );
  assert.equal(
    rows.reduce((s, r) => s + r.net, 0),
    0
  );
});
test('settlement finds a minimum when sequential greedy is suboptimal', () => {
  const rows = [
    { id: 'a', net: -500 },
    { id: 'b', net: -400 },
    { id: 'c', net: -300 },
    { id: 'd', net: 700 },
    { id: 'e', net: 500 }
  ];
  const result = settle(rows);
  assert.equal(result.optimal, true);
  assert.equal(result.transfers.length, 3);
  const nets = new Map(rows.map((r) => [r.id, r.net]));
  for (const t of result.transfers) {
    nets.set(t.from, nets.get(t.from)! + t.amount);
    nets.set(t.to, nets.get(t.to)! - t.amount);
  }
  assert.ok([...nets.values()].every((n) => n === 0));
});
test('random allocations, exclusions, extras and transfers conserve every cent', () => {
  let seed = 17;
  const rand = (max: number) => {
    seed = (seed * 16807) % 2147483647;
    return seed % max;
  };
  for (let i = 0; i < 150; i++) {
    const amount = 1 + rand(100000);
    const ordinary = Math.floor(amount / 3) + (1 < amount % 3 ? 1 : 0);
    const extra = rand(amount - ordinary + 1);
    const e = expense({ amount, choices: [{ member_id: 'b', mode: 'extra', extra }] });
    const rows = balances(members, [e], [], [{ from_id: 'c', to_id: 'a', amount: rand(100000) }]);
    assert.equal(
      rows.reduce((s, r) => s + r.net, 0),
      0
    );
    const settlement = settle(rows);
    const remaining = new Map(rows.map((r) => [r.id, r.net]));
    for (const t of settlement.transfers) {
      assert.ok(t.amount > 0);
      remaining.set(t.from, remaining.get(t.from)! + t.amount);
      remaining.set(t.to, remaining.get(t.to)! - t.amount);
    }
    assert.ok([...remaining.values()].every((n) => n === 0));
  }
});

test('multiple tags combine people without counting anyone twice', () => {
  const second: Tag = { id: 'second', trip_id: 'trip', name: 'Travel', members: ['b', 'c'] };
  const e = expense({ amount: 900, tag_ids: ['t', 'second'] });
  assert.deepEqual(
    [...allocate(e, members, [tag, second])],
    [
      ['a', 300],
      ['b', 300],
      ['c', 300]
    ]
  );
  assert.deepEqual(
    [...allocate(expense({ tag_ids: ['second'] }), members, [tag, second])],
    [
      ['a', 0],
      ['b', 500],
      ['c', 500]
    ]
  );
});
test('voluntary extra and full coverage leave all other expenses unchanged', () => {
  const e = expense({ amount: 900, choices: [{ member_id: 'b', mode: 'extra', extra: 100 }] });
  const other = expense({ id: 'other', amount: 900 });
  assert.equal(balances(members, [e, other], [], []).find((r) => r.id === 'b')!.share, 700);
  const full = expense({ amount: 900, choices: [{ member_id: 'b', mode: 'full', extra: 0 }] });
  assert.equal(balances(members, [full, other], [], []).find((r) => r.id === 'b')!.share, 1200);
  assert.equal(balances(members, [full, other], [], []).find((r) => r.id === 'c')!.share, 300);
});
test('multiple volunteers each keep their normal share plus their exact extra', () => {
  const e = expense({
    amount: 1200,
    choices: [
      { member_id: 'a', mode: 'extra', extra: 100 },
      { member_id: 'b', mode: 'extra', extra: 200 }
    ]
  });
  assert.deepEqual(
    [...allocate(e, members, [])],
    [
      ['a', 500],
      ['b', 600],
      ['c', 100]
    ]
  );
  assert.throws(() =>
    allocate(
      expense({ amount: 900, choices: [{ member_id: 'b', mode: 'extra', extra: 601 }] }),
      members,
      []
    )
  );
});

test('explicit people and selected tags form a union without double-counting', () => {
  const mixed = expense({ share_explicit: 1, member_ids: ['b', 'c'], tag_ids: ['t'] });
  assert.deepEqual(
    [...allocate(mixed, members, [tag])],
    [
      ['a', 334],
      ['b', 333],
      ['c', 333]
    ]
  );
  assert.deepEqual(
    [...allocate({ ...mixed, member_ids: ['c'] }, members, [{ ...tag, members: ['b'] }])],
    [
      ['a', 0],
      ['b', 500],
      ['c', 500]
    ]
  );
});
test('explicit person-only and Everyone selections ignore the legacy receipt tag', () => {
  assert.deepEqual(
    [
      ...allocate(
        expense({ share_explicit: 1, member_ids: ['c'], tag_ids: [], tag_id: 't' }),
        members,
        [tag]
      )
    ],
    [
      ['a', 0],
      ['b', 0],
      ['c', 1000]
    ]
  );
  assert.deepEqual(
    [...allocate(expense({ share_explicit: 1, member_ids: [], tag_ids: [] }), members, [tag])],
    [
      ['a', 334],
      ['b', 333],
      ['c', 333]
    ]
  );
});
test('existing receipt member overrides retain their original shares', () => {
  assert.deepEqual(
    [...allocate(expense({ member_ids: ['c'], tag_ids: ['t'] }), members, [tag])],
    [
      ['a', 0],
      ['b', 0],
      ['c', 1000]
    ]
  );
});
