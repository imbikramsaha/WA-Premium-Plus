// Time zones: guessing a person's zone from their phone number, and converting between
// wall-clock time in a zone and absolute time. Pure functions, shared by both processes.

/**
 * Country calling code → the country's main time zone. Countries spanning several zones are
 * marked with '*' (the guess may be wrong, so the app asks the user to check it).
 */
const CALLING_CODES: Record<string, string> = {
  '1': '*America/New_York',
  '7': '*Europe/Moscow',
  '76': 'Asia/Almaty',
  '77': 'Asia/Almaty',
  '20': 'Africa/Cairo',
  '27': 'Africa/Johannesburg',
  '30': 'Europe/Athens',
  '31': 'Europe/Amsterdam',
  '32': 'Europe/Brussels',
  '33': 'Europe/Paris',
  '34': 'Europe/Madrid',
  '36': 'Europe/Budapest',
  '39': 'Europe/Rome',
  '40': 'Europe/Bucharest',
  '41': 'Europe/Zurich',
  '43': 'Europe/Vienna',
  '44': 'Europe/London',
  '45': 'Europe/Copenhagen',
  '46': 'Europe/Stockholm',
  '47': 'Europe/Oslo',
  '48': 'Europe/Warsaw',
  '49': 'Europe/Berlin',
  '51': 'America/Lima',
  '52': '*America/Mexico_City',
  '53': 'America/Havana',
  '54': 'America/Argentina/Buenos_Aires',
  '55': '*America/Sao_Paulo',
  '56': 'America/Santiago',
  '57': 'America/Bogota',
  '58': 'America/Caracas',
  '60': 'Asia/Kuala_Lumpur',
  '61': '*Australia/Sydney',
  '62': '*Asia/Jakarta',
  '63': 'Asia/Manila',
  '64': 'Pacific/Auckland',
  '65': 'Asia/Singapore',
  '66': 'Asia/Bangkok',
  '81': 'Asia/Tokyo',
  '82': 'Asia/Seoul',
  '84': 'Asia/Ho_Chi_Minh',
  '86': 'Asia/Shanghai',
  '90': 'Europe/Istanbul',
  '91': 'Asia/Kolkata',
  '92': 'Asia/Karachi',
  '93': 'Asia/Kabul',
  '94': 'Asia/Colombo',
  '95': 'Asia/Yangon',
  '98': 'Asia/Tehran',
  '211': 'Africa/Juba',
  '212': 'Africa/Casablanca',
  '213': 'Africa/Algiers',
  '216': 'Africa/Tunis',
  '218': 'Africa/Tripoli',
  '220': 'Africa/Banjul',
  '221': 'Africa/Dakar',
  '223': 'Africa/Bamako',
  '224': 'Africa/Conakry',
  '225': 'Africa/Abidjan',
  '226': 'Africa/Ouagadougou',
  '227': 'Africa/Niamey',
  '228': 'Africa/Lome',
  '229': 'Africa/Porto-Novo',
  '230': 'Indian/Mauritius',
  '231': 'Africa/Monrovia',
  '232': 'Africa/Freetown',
  '233': 'Africa/Accra',
  '234': 'Africa/Lagos',
  '235': 'Africa/Ndjamena',
  '236': 'Africa/Bangui',
  '237': 'Africa/Douala',
  '238': 'Atlantic/Cape_Verde',
  '240': 'Africa/Malabo',
  '241': 'Africa/Libreville',
  '242': 'Africa/Brazzaville',
  '243': '*Africa/Kinshasa',
  '244': 'Africa/Luanda',
  '248': 'Indian/Mahe',
  '249': 'Africa/Khartoum',
  '250': 'Africa/Kigali',
  '251': 'Africa/Addis_Ababa',
  '252': 'Africa/Mogadishu',
  '253': 'Africa/Djibouti',
  '254': 'Africa/Nairobi',
  '255': 'Africa/Dar_es_Salaam',
  '256': 'Africa/Kampala',
  '257': 'Africa/Bujumbura',
  '258': 'Africa/Maputo',
  '260': 'Africa/Lusaka',
  '261': 'Indian/Antananarivo',
  '262': 'Indian/Reunion',
  '263': 'Africa/Harare',
  '264': 'Africa/Windhoek',
  '265': 'Africa/Blantyre',
  '266': 'Africa/Maseru',
  '267': 'Africa/Gaborone',
  '268': 'Africa/Mbabane',
  '291': 'Africa/Asmara',
  '297': 'America/Aruba',
  '298': 'Atlantic/Faroe',
  '299': 'America/Nuuk',
  '350': 'Europe/Gibraltar',
  '351': 'Europe/Lisbon',
  '352': 'Europe/Luxembourg',
  '353': 'Europe/Dublin',
  '354': 'Atlantic/Reykjavik',
  '355': 'Europe/Tirane',
  '356': 'Europe/Malta',
  '357': 'Asia/Nicosia',
  '358': 'Europe/Helsinki',
  '359': 'Europe/Sofia',
  '370': 'Europe/Vilnius',
  '371': 'Europe/Riga',
  '372': 'Europe/Tallinn',
  '373': 'Europe/Chisinau',
  '374': 'Asia/Yerevan',
  '375': 'Europe/Minsk',
  '376': 'Europe/Andorra',
  '377': 'Europe/Monaco',
  '380': 'Europe/Kyiv',
  '381': 'Europe/Belgrade',
  '382': 'Europe/Podgorica',
  '383': 'Europe/Belgrade',
  '385': 'Europe/Zagreb',
  '386': 'Europe/Ljubljana',
  '387': 'Europe/Sarajevo',
  '389': 'Europe/Skopje',
  '420': 'Europe/Prague',
  '421': 'Europe/Bratislava',
  '423': 'Europe/Vaduz',
  '501': 'America/Belize',
  '502': 'America/Guatemala',
  '503': 'America/El_Salvador',
  '504': 'America/Tegucigalpa',
  '505': 'America/Managua',
  '506': 'America/Costa_Rica',
  '507': 'America/Panama',
  '509': 'America/Port-au-Prince',
  '591': 'America/La_Paz',
  '592': 'America/Guyana',
  '593': 'America/Guayaquil',
  '595': 'America/Asuncion',
  '597': 'America/Paramaribo',
  '598': 'America/Montevideo',
  '673': 'Asia/Brunei',
  '674': 'Pacific/Nauru',
  '675': 'Pacific/Port_Moresby',
  '676': 'Pacific/Tongatapu',
  '679': 'Pacific/Fiji',
  '685': 'Pacific/Apia',
  '852': 'Asia/Hong_Kong',
  '853': 'Asia/Macau',
  '855': 'Asia/Phnom_Penh',
  '856': 'Asia/Vientiane',
  '880': 'Asia/Dhaka',
  '886': 'Asia/Taipei',
  '960': 'Indian/Maldives',
  '961': 'Asia/Beirut',
  '962': 'Asia/Amman',
  '963': 'Asia/Damascus',
  '964': 'Asia/Baghdad',
  '965': 'Asia/Kuwait',
  '966': 'Asia/Riyadh',
  '967': 'Asia/Aden',
  '968': 'Asia/Muscat',
  '970': 'Asia/Hebron',
  '971': 'Asia/Dubai',
  '972': 'Asia/Jerusalem',
  '973': 'Asia/Bahrain',
  '974': 'Asia/Qatar',
  '975': 'Asia/Thimphu',
  '976': 'Asia/Ulaanbaatar',
  '977': 'Asia/Kathmandu',
  '992': 'Asia/Dushanbe',
  '993': 'Asia/Ashgabat',
  '994': 'Asia/Baku',
  '995': 'Asia/Tbilisi',
  '996': 'Asia/Bishkek',
  '998': 'Asia/Tashkent',
};

export interface ZoneGuess {
  zone: string;
  /** The country has several time zones; this is the most common one. */
  uncertain: boolean;
}

/** Guesses the time zone of a phone number or WhatsApp ID ("+44 7700 900123", "447700900123@s.whatsapp.net"). */
export function zoneForPhone(phoneOrJid: string): ZoneGuess | undefined {
  const [user = '', server] = phoneOrJid.split('@');
  if (server && server !== 's.whatsapp.net' && server !== 'c.us') return undefined;
  const digits = user.replace(/\D/g, '');
  for (const length of [3, 2, 1]) {
    const entry = CALLING_CODES[digits.slice(0, length)];
    if (entry && digits.length > length + 4) {
      const uncertain = entry.startsWith('*');
      return { zone: uncertain ? entry.slice(1) : entry, uncertain };
    }
  }
  return undefined;
}

export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Wall-clock fields; month is 0-11 like Date. */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The wall-clock time in a zone at an instant. */
export function wallTimeIn(ms: number, zone: string): WallTime {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(zone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month! - 1,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Offset of a zone from UTC at an instant, in ms. */
function offsetAt(ms: number, zone: string): number {
  const w = wallTimeIn(ms, zone);
  const asUtc = Date.UTC(w.year, w.month, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in a zone. Fields may overflow (day 32 is the next
 * month). A time skipped by a daylight-saving jump moves forward by the jump.
 */
export function instantIn(wall: WallTime, zone: string): number {
  const utc = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second);
  const first = offsetAt(utc, zone);
  let t = utc - first;
  const second = offsetAt(t, zone);
  if (second !== first) {
    const t2 = utc - second;
    // Consistent with the offset at that instant: that's the answer. Otherwise the time
    // falls in a daylight-saving gap: move it forward by the jump.
    t = offsetAt(t2, zone) === second ? t2 : Math.max(t, t2);
  }
  return t;
}

/** "2026-11-20T09:30" (from <input type="datetime-local">) in a zone → Unix ms. */
export function parseWallTime(value: string, zone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return Number.NaN;
  return instantIn(
    { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]), second: 0 },
    zone,
  );
}

/** Unix ms → "2026-11-20T09:30" in a zone, for <input type="datetime-local">. */
export function formatWallTime(ms: number, zone: string): string {
  const w = wallTimeIn(ms, zone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${w.year}-${pad(w.month + 1)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** Old names some systems still report, e.g. macOS's "Asia/Calcutta". */
const RENAMED: Record<string, string> = {
  Calcutta: 'Kolkata',
  Saigon: 'Ho Chi Minh',
  Kiev: 'Kyiv',
  Katmandu: 'Kathmandu',
  Rangoon: 'Yangon',
};

/** Short name of a zone for labels, e.g. "London" or "Kolkata". */
export function zoneCity(zone: string): string {
  const city = (zone.split('/').pop() ?? zone).replaceAll('_', ' ');
  return RENAMED[city] ?? city;
}

/** Whether two zone names keep the same time all year (aliases such as Asia/Calcutta and Asia/Kolkata). */
export function sameZone(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const year = new Date().getUTCFullYear();
  return [0, 3, 6, 9].every((month) => {
    const t = Date.UTC(year, month, 15, 12);
    return offsetAt(t, a) === offsetAt(t, b);
  });
}
