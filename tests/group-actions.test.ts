import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeGroupAction, inverseGroupAction, normalizeGroupAction } from '../src/shared/group-actions.ts';
import { PermanentError } from '../src/main/errors.ts';
import { Scheduler } from '../src/main/scheduler.ts';
import { Store, type DueMessage } from '../src/main/store.ts';

const GROUP = '120363000000000001@g.us';

describe('group actions', () => {
  it('describes changes in plain language', () => {
    assert.equal(describeGroupAction({ type: 'announce', enabled: true }), 'Only admins can send messages');
    assert.equal(describeGroupAction({ type: 'announce', enabled: false }), 'Everyone can send messages');
    assert.equal(describeGroupAction({ type: 'memberAdd', adminsOnly: false }), 'Everyone can add members');
    assert.equal(describeGroupAction({ type: 'ephemeral', seconds: 604_800 }), 'Disappearing messages: 7 days');
    assert.equal(describeGroupAction({ type: 'ephemeral', seconds: 0 }), 'Turn off disappearing messages');
    assert.equal(describeGroupAction({ type: 'subject', text: 'Team' }), 'Rename the group to “Team”');
    assert.equal(describeGroupAction({ type: 'revokeInvite' }), 'Reset the invite link');
  });

  it('inverts on/off settings for "switch back", and nothing else', () => {
    assert.deepEqual(inverseGroupAction({ type: 'announce', enabled: true }), { type: 'announce', enabled: false });
    assert.deepEqual(inverseGroupAction({ type: 'memberAdd', adminsOnly: true }), { type: 'memberAdd', adminsOnly: false });
    assert.deepEqual(inverseGroupAction({ type: 'ephemeral', seconds: 86_400 }), { type: 'ephemeral', seconds: 0 });
    assert.equal(inverseGroupAction({ type: 'ephemeral', seconds: 0 }), null);
    assert.equal(inverseGroupAction({ type: 'subject', text: 'x' }), null);
    assert.equal(inverseGroupAction({ type: 'revokeInvite' }), null);
  });

  it('validates input from the window', () => {
    assert.deepEqual(normalizeGroupAction({ type: 'restrict', enabled: true, extra: 1 }), { type: 'restrict', enabled: true });
    assert.deepEqual(normalizeGroupAction({ type: 'subject', text: '  New name  ' }), { type: 'subject', text: 'New name' });
    assert.deepEqual(normalizeGroupAction({ type: 'description', text: '' }), { type: 'description', text: '' });
    assert.throws(() => normalizeGroupAction({ type: 'announce' }));
    assert.throws(() => normalizeGroupAction({ type: 'subject', text: '   ' }));
    assert.throws(() => normalizeGroupAction({ type: 'subject', text: 'x'.repeat(101) }));
    assert.throws(() => normalizeGroupAction({ type: 'ephemeral', seconds: 123 }));
    assert.throws(() => normalizeGroupAction({ type: 'delete-group' }));
  });

  it('stores scheduled group changes and hands them to the sender when due', async () => {
    const store = new Store(':memory:');
    store.upsertChat({ id: GROUP, name: 'Team' });
    store.createScheduled({
      target: 'group',
      chatId: GROUP,
      body: '',
      sendAt: Date.now() - 1000,
      rule: { repeat: 'daily' },
      groupAction: { type: 'announce', enabled: true },
    });
    const [listed] = store.listScheduled();
    assert.equal(listed!.target, 'group');
    assert.equal(listed!.chatName, 'Team');
    assert.deepEqual(listed!.groupAction, { type: 'announce', enabled: true });

    const applied: DueMessage[] = [];
    const scheduler = new Scheduler(store, { isOpen: true, sendScheduled: async (item) => void applied.push(item) }, () => undefined, { gapMs: 0 });
    await scheduler.runNow();
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0]!.groupAction, { type: 'announce', enabled: true });
    assert.equal(store.listScheduled()[0]!.status, 'pending'); // daily: next run scheduled
  });

  it('fails a change straight away when retrying cannot help (not an admin)', async () => {
    const store = new Store(':memory:');
    store.createScheduled({
      target: 'group',
      chatId: GROUP,
      body: '',
      sendAt: Date.now() - 1000, // just due: an ordinary error would be retried
      rule: { repeat: 'none' },
      groupAction: { type: 'announce', enabled: true },
    });
    const sender = { isOpen: true, sendScheduled: async () => { throw new PermanentError("You're not an admin of this group."); } };
    await new Scheduler(store, sender, () => undefined, { gapMs: 0 }).runNow();
    assert.equal(store.listScheduled()[0]!.status, 'failed');
  });

  it('marks a group change failed with the reason when it cannot be applied', async () => {
    const store = new Store(':memory:');
    store.createScheduled({
      target: 'group',
      chatId: GROUP,
      body: '',
      sendAt: Date.now() - 30 * 60_000,
      rule: { repeat: 'none' },
      groupAction: { type: 'restrict', enabled: true },
    });
    const reason = "You're not an admin of this group, so its settings can't be changed.";
    const scheduler = new Scheduler(store, { isOpen: true, sendScheduled: async () => { throw new Error(reason); } }, () => undefined, { gapMs: 0 });
    await scheduler.runNow();
    const [item] = store.listScheduled();
    assert.equal(item!.status, 'failed');
    assert.equal(item!.lastError, reason);
  });
});
