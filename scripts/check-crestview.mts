import './load-env.js';
import * as db from '../server/db';

const allDetailers = await db.getAllDetailers();
const crestviewDetailers = allDetailers.filter((e: any) => e.city?.toLowerCase() === 'crestview');
console.log('Crestview detailers:', JSON.stringify(crestviewDetailers.map((e: any) => ({name: e.fullName, city: e.city, status: e.activeStatus, role: e.role})), null, 2));
const cap = await db.getLocationCapacity('crestview');
console.log('Capacity:', cap);
process.exit(0);
