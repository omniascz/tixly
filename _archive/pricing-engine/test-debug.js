const { createPhaseSet } = require('./src/lib/test-helpers.ts');
const { getNextPhase } = require('./src/lib/pricing-calculator.ts');

const NOW = new Date('2026-04-03T12:00:00Z');
const phases = createPhaseSet(NOW);

console.log('Phases:');
phases.forEach(p => {
  console.log(`  ${p.phase} (priority ${p.priority}): qty=${p.thresholdQty}, date=${p.thresholdDate?.toISOString()}`);
});

const next = getNextPhase(phases, 'early_bird', 50, 500, NOW);
console.log('\ngetNextPhase("early_bird", 50, 500):');
console.log(next);
