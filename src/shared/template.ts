// Personalised message text: {name}, {first_name}, {phone}, columns from a contact list,
// and {Hi|Hello|Hey} variations, so broadcast messages aren't all identical.

export type TemplateValues = Record<string, string | undefined>;

const VARIABLE = /\{([a-zA-Z_][\w ]*)\}/g;
/** {a|b|c}: one option is picked at random. Options can't contain braces. */
const SPIN = /\{([^{}]*\|[^{}]*)\}/g;

function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

/** Fills in variables and picks variations. Unknown variables are left as they are. */
export function renderTemplate(text: string, values: TemplateValues, random: () => number = Math.random): string {
  const lookup = new Map(Object.entries(values).map(([k, v]) => [key(k), v]));
  const withValues = text.replace(VARIABLE, (whole, name: string) => {
    const value = lookup.get(key(name));
    return value === undefined ? whole : value;
  });
  return withValues.replace(SPIN, (_whole, options: string) => {
    const choices = options.split('|');
    return choices[Math.floor(random() * choices.length)] ?? '';
  });
}

/** Variables a template uses, e.g. ['name', 'city']. */
export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => key(m[1]!)))];
}

/** Standard values for a person. */
export function personValues(name: string | undefined, phone: string | undefined, extra: TemplateValues = {}): TemplateValues {
  const clean = name?.trim() || '';
  return {
    name: clean || 'there',
    first_name: clean.split(/\s+/)[0] || 'there',
    phone: phone ? `+${phone.replace(/\D/g, '')}` : '',
    ...extra,
  };
}
