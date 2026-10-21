// setup-unified-runtime.js
const fs = require('fs');
const path = require('path');

const RUNTIME_ROOT = 'D:/AICode/运行数据/江湖有旅人/内容生产App';
const UNIFIED_DIR = path.join(RUNTIME_ROOT, 'unified-runtime');
const UNIFIED_USERDATA = path.join(UNIFIED_DIR, 'electron-userdata');
const UNIFIED_PARTITIONS = path.join(UNIFIED_USERDATA, 'Partitions');

fs.mkdirSync(UNIFIED_PARTITIONS, { recursive: true });

// 1. Copy Local State from instance-A (primary DPAPI key)
const localStateA = path.join(RUNTIME_ROOT, 'instance-A', 'electron-userdata', 'Local State');
const destLocalState = path.join(UNIFIED_USERDATA, 'Local State');
if (!fs.existsSync(destLocalState) && fs.existsSync(localStateA)) {
  fs.copyFileSync(localStateA, destLocalState);
  console.log('Copied Local State from instance-A');
}

// Helper to copy directory recursively with EBUSY tolerance
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      if (!fs.existsSync(destPath)) {
        try {
          fs.copyFileSync(srcPath, destPath);
        } catch (err) {
          console.warn(`[Skip Locked] ${entry.name}: ${err.message}`);
        }
      }
    }
  }
}

// 2. Copy partition teambuilding-gpt-production-account-1 from instance-A
const srcPart1 = path.join(RUNTIME_ROOT, 'instance-A', 'electron-userdata', 'Partitions', 'teambuilding-gpt-production-account-1');
const destPart1 = path.join(UNIFIED_PARTITIONS, 'teambuilding-gpt-production-account-1');
copyDirRecursive(srcPart1, destPart1);
console.log('Processed account-1 partition base');

// 3. For account-2: Copy local storage and indexeddb from instance-B
const srcPart2 = path.join(RUNTIME_ROOT, 'instance-B', 'electron-userdata', 'Partitions', 'teambuilding-gpt-production-account-2');
const destPart2 = path.join(UNIFIED_PARTITIONS, 'teambuilding-gpt-production-account-2');
copyDirRecursive(srcPart2, destPart2);
console.log('Processed account-2 partition base');

// 4. Also copy account-3 from instance-C and account-4 from instance-D if present
const srcPart3 = path.join(RUNTIME_ROOT, 'instance-C', 'electron-userdata', 'Partitions', 'teambuilding-gpt-production-account-3');
const destPart3 = path.join(UNIFIED_PARTITIONS, 'teambuilding-gpt-production-account-3');
copyDirRecursive(srcPart3, destPart3);

const srcPart4 = path.join(RUNTIME_ROOT, 'instance-D', 'electron-userdata', 'Partitions', 'teambuilding-gpt-production-account-4');
const destPart4 = path.join(UNIFIED_PARTITIONS, 'teambuilding-gpt-production-account-4');
copyDirRecursive(srcPart4, destPart4);

// 5. Build merged gpt-browser-profiles.json
let profilesA = { profiles: [] };
let profilesB = { profiles: [] };
let profilesC = { profiles: [] };
let profilesD = { profiles: [] };

try { profilesA = JSON.parse(fs.readFileSync(path.join(RUNTIME_ROOT, 'instance-A', 'electron-userdata', 'gpt-browser-profiles.json'), 'utf8')); } catch (_) {}
try { profilesB = JSON.parse(fs.readFileSync(path.join(RUNTIME_ROOT, 'instance-B', 'electron-userdata', 'gpt-browser-profiles.json'), 'utf8')); } catch (_) {}
try { profilesC = JSON.parse(fs.readFileSync(path.join(RUNTIME_ROOT, 'instance-C', 'electron-userdata', 'gpt-browser-profiles.json'), 'utf8')); } catch (_) {}
try { profilesD = JSON.parse(fs.readFileSync(path.join(RUNTIME_ROOT, 'instance-D', 'electron-userdata', 'gpt-browser-profiles.json'), 'utf8')); } catch (_) {}

const allProfiles = [
  ...profilesA.profiles,
  ...profilesB.profiles,
  ...profilesC.profiles,
  ...profilesD.profiles
];

// Deduplicate by id
const profileMap = new Map();
allProfiles.forEach(p => {
  if (!profileMap.has(p.id)) profileMap.set(p.id, p);
});

// Ensure account-1 to account-4 are present
if (!profileMap.has('account-1')) profileMap.set('account-1', { id: 'account-1', name: 'zwmrpg', quotaGroup: 'account-1', mode: 'manual' });
if (!profileMap.has('account-2')) profileMap.set('account-2', { id: 'account-2', name: 'orlandocardozo706', quotaGroup: 'account-2', mode: 'manual' });
if (!profileMap.has('account-3')) profileMap.set('account-3', { id: 'account-3', name: 'z x Plus', quotaGroup: 'account-3', mode: 'manual' });
if (!profileMap.has('account-4')) profileMap.set('account-4', { id: 'account-4', name: 'Hazel Sanchez Plus', quotaGroup: 'account-4', mode: 'manual' });

const mergedProfiles = {
  version: 1,
  activeId: 'account-1',
  profiles: Array.from(profileMap.values())
};

fs.writeFileSync(path.join(UNIFIED_USERDATA, 'gpt-browser-profiles.json'), JSON.stringify(mergedProfiles, null, 2), 'utf8');
console.log('Successfully created merged gpt-browser-profiles.json:');
mergedProfiles.profiles.forEach(p => console.log(`  - ${p.id}: ${p.name}`));
