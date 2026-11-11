import type { Expense, Member, Tag, Balance, Transfer } from './types';

export function cents(value: unknown): number {
  const text = String(value ?? '')
    .trim()
    .replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter an amount with up to 2 decimals.');
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount > 1_000_000_000)
    throw new Error('Amount is too large.');
  return amount;
}

export function defaultMembers(expense: Expense, members: Member[], tags: Tag[]): string[] {
  if (expense.member_ids?.length) return expense.member_ids;
  const ids = expense.tag_ids ?? (expense.tag_id ? [expense.tag_id] : []);
  if (!ids.length) return members.map((member) => member.id);
  return [...new Set(tags.filter((tag) => ids.includes(tag.id)).flatMap((tag) => tag.members))];
}

export function allocate(expense: Expense, members: Member[], tags: Tag[]): Map<string, number> {
  const result = new Map(members.map((m) => [m.id, 0]));
  const defaults = defaultMembers(expense, members, tags);
  const full = expense.choices.filter((c) => c.mode === 'full').map((c) => c.member_id);
  const eligible = members
    .filter((m) => {
      const choice = expense.choices.find((c) => c.member_id === m.id);
      if (full.length) return full.includes(m.id);
      if (choice?.mode === 'exclude') return false;
      if (choice?.mode === 'share' || choice?.mode === 'extra') return true;
      return defaults.includes(m.id);
    })
    .map((m) => m.id)
    .sort();
  if (!eligible.length) throw new Error(`Choose at least one payer for “${expense.title}”.`);
  eligible.forEach((id, i) =>
    result.set(
      id,
      Math.floor(expense.amount / eligible.length) + (i < expense.amount % eligible.length ? 1 : 0)
    )
  );
  if (full.length) return result;
  const contributors = expense.choices.filter(
    (c) => c.mode === 'extra' && c.extra > 0 && eligible.includes(c.member_id)
  );
  if (!contributors.length) return result;
  const others = eligible.filter((id) => !contributors.some((c) => c.member_id === id));
  const extras = contributors.reduce((sum, c) => sum + c.extra, 0);
  const available = others.reduce((sum, id) => sum + result.get(id)!, 0);
  if (extras > available)
    throw new Error('Extra contributions exceed the other participants’ shares.');
  // Volunteers keep their ordinary share and add exactly the amount they chose.
  for (const c of contributors) result.set(c.member_id, result.get(c.member_id)! + c.extra);
  const remaining = available - extras;
  others.forEach((id, i) =>
    result.set(id, Math.floor(remaining / others.length) + (i < remaining % others.length ? 1 : 0))
  );
  return result;
}

export function balances(
  members: Member[],
  expenses: Expense[],
  tags: Tag[],
  payments: { from_id: string; to_id: string; amount: number }[]
): Balance[] {
  const rows = new Map(
    members.map((m) => [m.id, { id: m.id, spent: 0, share: 0, sent: 0, received: 0, net: 0 }])
  );
  for (const expense of expenses) {
    rows.get(expense.payer_id)!.spent += expense.amount;
    for (const [id, share] of allocate(expense, members, tags)) rows.get(id)!.share += share;
  }
  for (const p of payments) {
    rows.get(p.from_id)!.sent += p.amount;
    rows.get(p.to_id)!.received += p.amount;
  }
  return [...rows.values()].map((r) => ({ ...r, net: r.spent + r.sent - r.received - r.share }));
}

// Exact minimum-transfer debt clearing with symmetry pruning. A search budget
// keeps unusually large groups responsive; the best complete solution is retained.
export function settle(rows: Pick<Balance, 'id' | 'net'>[]): {
  transfers: Transfer[];
  optimal: boolean;
} {
  const debts = rows.filter((r) => r.net < 0).map((r) => ({ id: r.id, amount: -r.net }));
  const credits = rows.filter((r) => r.net > 0).map((r) => ({ id: r.id, amount: r.net }));
  if (debts.reduce((s, x) => s + x.amount, 0) !== credits.reduce((s, x) => s + x.amount, 0))
    throw new Error('Balances do not sum to zero.');
  const d = debts.map((x) => ({ ...x })),
    c = credits.map((x) => ({ ...x }));
  let best: Transfer[] = [];
  for (const debtor of d)
    for (const creditor of c) {
      const amount = Math.min(debtor.amount, creditor.amount);
      if (amount) {
        best.push({ from: debtor.id, to: creditor.id, amount });
        debtor.amount -= amount;
        creditor.amount -= amount;
      }
    }
  let visited = 0,
    exhausted = false;
  const path: Transfer[] = [];
  function search() {
    if (++visited > 200_000) {
      exhausted = true;
      return;
    }
    const activeD = debts.filter((x) => x.amount),
      activeC = credits.filter((x) => x.amount);
    if (!activeD.length) {
      if (path.length < best.length) best = [...path];
      return;
    }
    if (path.length + Math.max(activeD.length, activeC.length) >= best.length) return;
    // Every acyclic solution has a leaf. Try every possible debtor/creditor leaf edge.
    const seen = new Set<string>();
    for (const debtor of activeD)
      for (const creditor of activeC) {
        const key = `${debtor.amount}:${creditor.amount}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const amount = Math.min(debtor.amount, creditor.amount);
        debtor.amount -= amount;
        creditor.amount -= amount;
        path.push({ from: debtor.id, to: creditor.id, amount });
        search();
        path.pop();
        debtor.amount += amount;
        creditor.amount += amount;
        if (exhausted) return;
      }
  }
  search();
  return { transfers: best, optimal: !exhausted };
}
