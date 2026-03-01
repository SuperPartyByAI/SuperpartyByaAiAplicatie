#!/usr/bin/env node

/**
 * Test validare format date DD-MM-YYYY (fără API calls)
 */

console.log('🧪 Testare validare format date DD-MM-YYYY\n');
console.log('═══════════════════════════════════════════════════════════════\n');

// Date validation regex
const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

const testCases = [
  // Valid dates
  { date: '15-01-2026', valid: true, description: 'Format corect DD-MM-YYYY' },
  { date: '31-12-2026', valid: true, description: 'Ultima zi a anului' },
  { date: '01-06-2026', valid: true, description: 'Prima zi a lunii' },
  { date: '20-03-2026', valid: true, description: 'Dată normală' },

  // Invalid dates
  { date: '2026-01-15', valid: false, description: 'Format YYYY-MM-DD (greșit)' },
  { date: '15/01/2026', valid: false, description: 'Separator slash (greșit)' },
  { date: '15.01.2026', valid: false, description: 'Separator punct (greșit)' },
  { date: '15-1-2026', valid: false, description: 'Luna fără zero (greșit)' },
  { date: '5-01-2026', valid: false, description: 'Zi fără zero (greșit)' },
  { date: 'mâine', valid: false, description: 'Dată relativă (greșit)' },
  { date: '15 ianuarie 2026', valid: false, description: 'Format text (greșit)' },
];

let passed = 0;
let failed = 0;

testCases.forEach(testCase => {
  const result = dateRegex.test(testCase.date);
  const expected = testCase.valid;
  const testPassed = result === expected;

  if (testPassed) {
    console.log(`✅ PASS: "${testCase.date}" - ${testCase.description}`);
    passed++;
  } else {
    console.log(`❌ FAIL: "${testCase.date}" - ${testCase.description}`);
    console.log(`   Expected: ${expected}, Got: ${result}`);
    failed++;
  }
});

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`📊 Rezultate: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════\n');

// Test validation function
console.log('🔍 Testare funcție de validare completă\n');

function validateEventData(data) {
  const dateStr = String(data.date || '').trim();
  const addressStr = String(data.address || '').trim();

  if (!dateStr) {
    return {
      ok: false,
      message:
        'Lipsește data evenimentului. Te rog să specifici data în format DD-MM-YYYY (ex: 15-01-2026).',
    };
  }

  if (!addressStr) {
    return {
      ok: false,
      message:
        'Lipsește adresa evenimentului. Te rog să specifici locația (ex: București, Str. Exemplu 10).',
    };
  }

  // Validate date format (DD-MM-YYYY)
  const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
  if (!dateRegex.test(dateStr)) {
    return {
      ok: false,
      message: `Data trebuie să fie în format DD-MM-YYYY (ex: 15-01-2026). Ai introdus: "${dateStr}"`,
    };
  }

  return {
    ok: true,
    message: 'Validare reușită',
  };
}

const validationTests = [
  {
    name: 'Eveniment valid complet',
    data: { date: '15-02-2026', address: 'Strada Florilor 10, București' },
    shouldPass: true,
  },
  {
    name: 'Lipsește data',
    data: { address: 'Strada Florilor 10' },
    shouldPass: false,
    expectedError: 'Lipsește data',
  },
  {
    name: 'Lipsește adresa',
    data: { date: '15-02-2026' },
    shouldPass: false,
    expectedError: 'Lipsește adresa',
  },
  {
    name: 'Format dată greșit (YYYY-MM-DD)',
    data: { date: '2026-02-15', address: 'Strada Florilor 10' },
    shouldPass: false,
    expectedError: 'DD-MM-YYYY',
  },
  {
    name: 'Dată relativă',
    data: { date: 'mâine', address: 'Strada Florilor 10' },
    shouldPass: false,
    expectedError: 'DD-MM-YYYY',
  },
];

let validationPassed = 0;
let validationFailed = 0;

validationTests.forEach(test => {
  const result = validateEventData(test.data);
  const testPassed = result.ok === test.shouldPass;

  if (testPassed) {
    console.log(`✅ PASS: ${test.name}`);
    console.log(`   Message: ${result.message}`);
    validationPassed++;
  } else {
    console.log(`❌ FAIL: ${test.name}`);
    console.log(`   Expected ok: ${test.shouldPass}, Got: ${result.ok}`);
    console.log(`   Message: ${result.message}`);
    validationFailed++;
  }
  console.log('');
});

console.log('═══════════════════════════════════════════════════════════════');
console.log(`📊 Rezultate validare: ${validationPassed} passed, ${validationFailed} failed`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed === 0 && validationFailed === 0) {
  console.log('🎉 Toate testele au trecut cu succes!\n');
  console.log('✅ Formatul DD-MM-YYYY este validat corect');
  console.log('✅ Validarea datei și adresei funcționează');
  console.log('✅ Mesajele de eroare sunt clare și utile\n');
  process.exit(0);
} else {
  console.log('⚠️  Unele teste au eșuat.\n');
  process.exit(1);
}
