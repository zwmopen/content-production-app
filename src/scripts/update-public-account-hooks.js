const fs = require('fs');
const file = 'D:/AICode/工具开发/projects/content-production-app/src/public/app.js';
let content = fs.readFileSync(file, 'utf8');

const target1 = `  window.switchProdLine = switchProdLine;
  if (typeof applyTheme === 'function') {
    window.applyTheme = applyTheme;
  }`;

const replacement1 = `  window.switchProdLine = switchProdLine;
  window.switchGptAccount = switchGptAccount;
  window.addGptAccount = addGptAccount;
  if (typeof applyTheme === 'function') {
    window.applyTheme = applyTheme;
  }`;

const target2 = `  // Cross-App PostMessage receiver (from Station 1 Materials & Station 2 Templates & Container)
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;`;

const replacement2 = `  // Cross-App PostMessage receiver (from Station 1 Materials & Station 2 Templates & Container)
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    // Single-Core Account Switching (0ms instant tab switch)
    if (msg.type === 'SWITCH_ACCOUNT' && msg.accountId) {
      if (typeof switchGptAccount === 'function') {
        switchGptAccount(msg.accountId, { silent: true });
      }
    }

    // Instant Account Creation (<50ms)
    if (msg.type === 'ADD_ACCOUNT') {
      if (typeof addGptAccount === 'function') {
        addGptAccount();
      }
    }`;

let normContent = content.replace(/\r\n/g, '\n');
const normT1 = target1.replace(/\r\n/g, '\n');
const normR1 = replacement1.replace(/\r\n/g, '\n');
const normT2 = target2.replace(/\r\n/g, '\n');
const normR2 = replacement2.replace(/\r\n/g, '\n');

if (!normContent.includes(normT1)) {
  console.error('Target 1 not found in public app.js');
  process.exit(1);
}
if (!normContent.includes(normT2)) {
  console.error('Target 2 not found in public app.js');
  process.exit(1);
}

normContent = normContent.replace(normT1, normR1).replace(normT2, normR2);
fs.writeFileSync(file, normContent.replace(/\n/g, '\r\n'), 'utf8');
console.log('Successfully updated public app.js with account postMessage & global hooks');
