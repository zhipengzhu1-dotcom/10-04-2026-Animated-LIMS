// Loads the fictional demo lab into an empty data folder without the setup screen, so a public demo can run behind the tunnel.
// Usage:  ALIQUOT_DATA=<folder> node scripts/seed-demo.js
import { openDb, closeDb, get } from '../server/db.js';
import { DATA_DIR } from '../server/config.js';
import { seedDemo } from '../server/seed.js';

openDb();
if (get('SELECT 1 FROM users LIMIT 1')) {
  console.error(`${DATA_DIR} already has a lab. Demo data only goes into an empty data folder.`);
  process.exit(1);
}
seedDemo();
closeDb();
console.log(`Demo lab loaded into ${DATA_DIR}`);
