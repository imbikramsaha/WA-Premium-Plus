import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectColumns, normalizePhone, parseCsv, toCsv } from '../src/shared/csv.ts';
import { personValues, renderTemplate, templateVariables } from '../src/shared/template.ts';

describe('templates', () => {
  it('fills in variables and picks variations', () => {
    const values = personValues('Asha Rao', '919876543210', { City: 'Kolkata' });
    const text = renderTemplate('{Hi|Hello} {first_name} from {city}! {unknown} {phone}', values, () => 0.99);
    assert.equal(text, 'Hello Asha from Kolkata! {unknown} +919876543210');
    assert.equal(renderTemplate('{Hi|Hello} {name}', personValues('', undefined), () => 0), 'Hi there');
    assert.deepEqual(templateVariables('Hi {First Name}, {city} {Hi|Hello}'), ['first_name', 'city']);
  });
});

describe('CSV', () => {
  it('reads quoted fields, other delimiters and a byte-order mark', () => {
    assert.deepEqual(parseCsv('﻿name,phone\r\n"Rao, Asha","+91 98765 43210"\n"He said ""hi""",123\n\n'), [
      ['name', 'phone'],
      ['Rao, Asha', '+91 98765 43210'],
      ['He said "hi"', '123'],
    ]);
    assert.deepEqual(parseCsv('Name;Mobile\nAsha;9876543210'), [
      ['Name', 'Mobile'],
      ['Asha', '9876543210'],
    ]);
    assert.deepEqual(parseCsv(toCsv([['a,b', 'c"d', 1]])), [['a,b', 'c"d', '1']]);
  });

  it('normalizes phone numbers', () => {
    assert.equal(normalizePhone('+91 98765-43210'), '919876543210');
    assert.equal(normalizePhone('0044 7700 900123'), '447700900123');
    assert.equal(normalizePhone('09876543210', '91'), '919876543210');
    assert.equal(normalizePhone('919876543210', '91'), '919876543210');
    assert.equal(normalizePhone('12345'), null);
    assert.equal(normalizePhone('not a number'), null);
  });

  it('finds the phone and name columns', () => {
    const withHeader = detectColumns(parseCsv('Customer,City,WhatsApp\nAsha,Kolkata,+919876543210'));
    assert.equal(withHeader.phoneColumn, 2);
    assert.equal(withHeader.nameColumn, 0);
    assert.equal(withHeader.rows.length, 1);
    const noHeader = detectColumns(parseCsv('Asha,+919876543210\nRahul,+919830000000'));
    assert.deepEqual(noHeader.columns, ['Column 1', 'Column 2']);
    assert.equal(noHeader.phoneColumn, 1);
    assert.equal(noHeader.rows.length, 2);
  });
});

import { isActiveAt, matchesText, ruleApplies, withinHours } from '../src/shared/rules.ts';
import type { RuleConfig } from '../src/shared/types.ts';

describe('rules', () => {
  const weekdays = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
  // 16 Nov 2026 is a Monday.
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, 16 + day, h, m);

  it('checks business hours, including overnight ranges', () => {
    assert.ok(withinHours(weekdays, at(0, 9)));
    assert.ok(!withinHours(weekdays, at(0, 18)));
    assert.ok(!withinHours(weekdays, at(5, 12))); // Saturday
    const night = { days: [5], start: '22:00', end: '06:00' }; // Friday night
    assert.ok(withinHours(night, at(4, 23))); // Friday 23:00
    assert.ok(withinHours(night, at(5, 5))); // Saturday 05:00
    assert.ok(!withinHours(night, at(5, 7)));
    assert.ok(isActiveAt({ mode: 'outside', hours: weekdays }, at(0, 20)));
    assert.ok(!isActiveAt({ mode: 'outside', hours: weekdays }, at(0, 10)));
  });

  it('matches keywords as whole words', () => {
    assert.ok(matchesText({ type: 'contains', text: 'price, cost' }, 'What is the PRICE?'));
    assert.ok(!matchesText({ type: 'contains', text: 'price' }, 'priceless'));
    assert.ok(matchesText({ type: 'contains', text: 'দাম' }, 'এর দাম কত?'));
    assert.ok(matchesText({ type: 'exact', text: 'stop' }, ' Stop '));
    assert.ok(matchesText({ type: 'starts', text: 'order' }, 'Order #12'));
    assert.ok(matchesText({ type: 'regex', text: '^#\\d+$' }, '#123'));
    assert.ok(!matchesText({ type: 'regex', text: '(' }, 'x')); // invalid pattern: no match, no crash
  });

  it('applies rules to the right chats', () => {
    const base: RuleConfig = { trigger: 'message', scope: 'people', when: { mode: 'always' }, actions: [], cooldownMinutes: 0 };
    const ctx = { chatId: 'a@s.whatsapp.net', text: 'hi', isGroup: false, isContact: true, isFirstMessage: false, at: at(0, 10) };
    assert.ok(ruleApplies(base, ctx));
    assert.ok(!ruleApplies(base, { ...ctx, isGroup: true, chatId: 'g@g.us' }));
    assert.ok(ruleApplies({ ...base, scope: 'chats', chatIds: ['g@g.us'] }, { ...ctx, isGroup: true, chatId: 'g@g.us' }));
    assert.ok(!ruleApplies({ ...base, scope: 'unknown' }, ctx));
    assert.ok(!ruleApplies({ ...base, trigger: 'firstMessage' }, ctx));
    assert.ok(ruleApplies({ ...base, trigger: 'firstMessage' }, { ...ctx, isFirstMessage: true }));
  });
});
