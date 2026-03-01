// lib/normalize-phone.js
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normalizează un număr în E.164.
 * @param {string} rawNumber - numărul introdus (poate fi local sau cu +)
 * @param {string} [defaultCountry] - ex. 'RO' pentru numere locale fără prefix
 * @returns {string} număr în format E.164 (ex: +40711222333)
 * @throws Error dacă numărul e invalid sau lipsește
 */
export function normalizeToE164(rawNumber, defaultCountry) {
  if (!rawNumber) throw new Error('Missing phone number');
  const pn = parsePhoneNumberFromString(rawNumber, defaultCountry || undefined);
  if (!pn || !pn.isValid()) {
    throw new Error(`Invalid phone number: ${rawNumber}`);
  }
  return pn.number; // deja în E.164
}
