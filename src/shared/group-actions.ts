// Group settings changes that can be scheduled. Pure functions, shared by the main process
// (validation, applying) and the window (labels).

import type { GroupAction } from './types';

/** WhatsApp's disappearing-message timers, in seconds. */
export const EPHEMERAL_OPTIONS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 0, label: 'Off' },
  { seconds: 86_400, label: '24 hours' },
  { seconds: 604_800, label: '7 days' },
  { seconds: 7_776_000, label: '90 days' },
];

export const GROUP_ACTION_TYPES: ReadonlyArray<{ type: GroupAction['type']; label: string }> = [
  { type: 'announce', label: 'Who can send messages' },
  { type: 'restrict', label: 'Who can edit group info' },
  { type: 'memberAdd', label: 'Who can add members' },
  { type: 'joinApproval', label: 'Approve new members' },
  { type: 'ephemeral', label: 'Disappearing messages' },
  { type: 'subject', label: 'Group name' },
  { type: 'description', label: 'Group description' },
  { type: 'revokeInvite', label: 'Reset invite link' },
];

const MAX_SUBJECT = 100;
const MAX_DESCRIPTION = 2048;

export function ephemeralLabel(seconds: number): string {
  return EPHEMERAL_OPTIONS.find((o) => o.seconds === seconds)?.label ?? `${Math.round(seconds / 86_400)} days`;
}

/** Plain-language description, e.g. "Only admins can send messages". */
export function describeGroupAction(action: GroupAction): string {
  switch (action.type) {
    case 'announce':
      return action.enabled ? 'Only admins can send messages' : 'Everyone can send messages';
    case 'restrict':
      return action.enabled ? 'Only admins can edit group info' : 'Everyone can edit group info';
    case 'memberAdd':
      return action.adminsOnly ? 'Only admins can add members' : 'Everyone can add members';
    case 'joinApproval':
      return action.enabled ? 'Turn on approval for new members' : 'Turn off approval for new members';
    case 'ephemeral':
      return action.seconds === 0
        ? 'Turn off disappearing messages'
        : `Disappearing messages: ${ephemeralLabel(action.seconds)}`;
    case 'subject':
      return `Rename the group to “${action.text}”`;
    case 'description':
      return action.text ? 'Change the group description' : 'Clear the group description';
    case 'revokeInvite':
      return 'Reset the invite link';
  }
}

/** The opposite change for on/off settings (used for "switch back at"), or null. */
export function inverseGroupAction(action: GroupAction): GroupAction | null {
  switch (action.type) {
    case 'announce':
    case 'restrict':
    case 'joinApproval':
      return { type: action.type, enabled: !action.enabled };
    case 'memberAdd':
      return { type: 'memberAdd', adminsOnly: !action.adminsOnly };
    case 'ephemeral':
      return action.seconds > 0 ? { type: 'ephemeral', seconds: 0 } : null;
    default:
      return null;
  }
}

/** Checks and cleans up a group action coming from the window. Throws on invalid input. */
export function normalizeGroupAction(value: unknown): GroupAction {
  const a = (value ?? {}) as Record<string, unknown>;
  const bool = (key: string) => {
    if (typeof a[key] !== 'boolean') throw new Error('Choose a setting for the group.');
    return a[key] as boolean;
  };
  const text = (max: number, required: boolean) => {
    const t = typeof a.text === 'string' ? a.text.trim() : '';
    if (required && !t) throw new Error('Enter the new text for the group.');
    if (t.length > max) throw new Error(`Keep it under ${max} characters.`);
    return t;
  };
  switch (a.type) {
    case 'announce':
    case 'restrict':
    case 'joinApproval':
      return { type: a.type, enabled: bool('enabled') };
    case 'memberAdd':
      return { type: 'memberAdd', adminsOnly: bool('adminsOnly') };
    case 'ephemeral': {
      const seconds = Number(a.seconds);
      if (!EPHEMERAL_OPTIONS.some((o) => o.seconds === seconds)) throw new Error('Choose a disappearing-message timer.');
      return { type: 'ephemeral', seconds };
    }
    case 'subject':
      return { type: 'subject', text: text(MAX_SUBJECT, true) };
    case 'description':
      return { type: 'description', text: text(MAX_DESCRIPTION, false) };
    case 'revokeInvite':
      return { type: 'revokeInvite' };
    default:
      throw new Error('Choose which group setting to change.');
  }
}
