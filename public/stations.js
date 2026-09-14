'use strict';
// Identyfikatory zachowują powiązania z kontami i archiwum. Zmienia się oznaczenie na hali.
const AndonStations = Object.freeze({
    label: value => /^y[0-4]$/i.test(String(value)) ? 'X' + String(value).slice(1) : String(value ?? '').toUpperCase()
});
if (typeof module !== 'undefined' && module.exports) module.exports = AndonStations;
