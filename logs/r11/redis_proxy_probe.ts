import { getClient } from '../../nextjs-boilerplate/src/lib/queue/redis-queue';
async function main() {
  process.env.REDIS_URL = 'redis://localhost:56679';
  const c = await getClient();
  console.log('client', !!c);
  try { console.log('isOpen', c?.isOpen); } catch (e) { console.log('isOpen THROWS', (e as Error).message); }
  try { console.log('incr', await c?.incr('r11:probe')); } catch (e) { console.log('incr THROWS', (e as Error).message); }
  const c2 = await getClient();
  console.log('second getClient', !!c2, c2 === c);
  process.exit(0);
}
void main();
