import { customAlphabet } from 'nanoid';
import { lobbyRepo } from '../repo/index.js';

// No confusing characters (0/O, 1/I) so codes are easy to read out loud.
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = customAlphabet(alphabet, 6);

export async function generateUniqueCode() {
  for (let i = 0; i < 12; i += 1) {
    const code = makeCode();
    // eslint-disable-next-line no-await-in-loop
    if (!(await lobbyRepo.exists(code))) return code;
  }
  throw new Error('Could not generate a unique lobby code, try again');
}
