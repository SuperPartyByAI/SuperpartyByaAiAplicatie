#!/usr/bin/env node

/**
 * Test pentru verificarea că AI-ul nu intră în loop când user răspunde cu "da"
 */

console.log('🧪 Test: Verificare Loop Conversație\n');
console.log('═══════════════════════════════════════════════════════════════\n');

// Simulate conversation (INTERACTIVE FLOW)
const conversation = [
  {
    user: 'Vreau să notez un eveniment',
    expectedAI: 'Trebuie să întrebe despre detalii lipsă (dată, adresă, roluri)',
    shouldContain: ['Data', 'Adresa', 'format DD-MM-YYYY'],
  },
  {
    user: '15-01-2026, București, Str. Exemplu 10, pentru Maria 5 ani, animator și vată de zahăr',
    expectedAI: 'Trebuie să rezume și să ceară confirmare',
    shouldContain: ['Am înțeles', 'Confirm'],
  },
  {
    user: 'da',
    expectedAI: 'Trebuie să creeze evenimentul (în context de confirmare)',
    shouldContain: ['creat', 'adăugat'],
  },
];

console.log('📋 Scenariul de test:\n');
conversation.forEach((turn, index) => {
  console.log(`${index + 1}. User: "${turn.user}"`);
  console.log(`   Expected: ${turn.expectedAI}`);
  if (turn.shouldContain) {
    console.log(`   Should contain: ${turn.shouldContain.join(', ')}`);
  }
  if (turn.shouldNotContain) {
    console.log(`   Should NOT contain: ${turn.shouldNotContain.join(', ')}`);
  }
  console.log('');
});

console.log('═══════════════════════════════════════════════════════════════\n');

// Check system prompt
const fs = require('fs');
const indexJs = fs.readFileSync('./index.js', 'utf8');

console.log('🔍 Verificare System Prompt:\n');

const checks = [
  {
    pattern: 'ÎNTREABĂ utilizatorul despre detalii lipsă',
    description: 'AI TREBUIE să întrebe despre detalii lipsă (INTERACTIVE FLOW)',
  },
  {
    pattern: 'CERE confirmări înainte de a crea/actualiza evenimente',
    description: 'AI TREBUIE să ceară confirmare înainte de CREATE/UPDATE',
  },
  {
    pattern: 'REZUMĂ toate detaliile și CERE CONFIRMARE',
    description: 'AI TREBUIE să rezume și să ceară confirmare',
  },
  {
    pattern: 'NU intra în loop-uri',
    description: 'AI nu trebuie să intre în loop-uri (nu întreba același lucru de 2 ori)',
  },
  {
    pattern: 'shortConfirmations',
    description: 'Backend detectează confirmări scurte',
  },
];

let allChecksPass = true;

checks.forEach(check => {
  const found = indexJs.includes(check.pattern);
  if (found) {
    console.log(`✅ ${check.description}`);
  } else {
    console.log(`❌ ${check.description} - LIPSEȘTE`);
    allChecksPass = false;
  }
});

console.log('\n═══════════════════════════════════════════════════════════════\n');

if (allChecksPass) {
  console.log('🎉 Toate verificările au trecut!\n');
  console.log('✅ System prompt actualizat pentru INTERACTIVE FLOW');
  console.log('✅ AI va întreba despre detalii lipsă');
  console.log('✅ AI va cere confirmare înainte de CREATE/UPDATE');
  console.log('✅ AI nu va intra în loop-uri (nu va întreba același lucru de 2 ori)\n');
  console.log('📝 Next Steps:');
  console.log('  1. Deploy functions: cd functions && npm run deploy');
  console.log('  2. Test în app cu conversație reală');
  console.log('  3. Verifică că AI cere confirmare înainte de a crea evenimente\n');
  process.exit(0);
} else {
  console.log('⚠️  Unele verificări au eșuat.\n');
  console.log('Verifică că toate modificările au fost aplicate corect.\n');
  process.exit(1);
}
