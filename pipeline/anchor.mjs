// Record every published day file on the Flarewatch program (devnet), creating
// the registry first if needed. A day already on chain is checked, not resent:
// if its stored digest differs from the file, that is reported as tampering.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { DATA_DIR, PROGRAM_ID, ROOT, dayStats, loadDays, sha256 } from './common.mjs';

const RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const KEY = process.env.FLAREWATCH_KEYPAIR || `${homedir()}/.config/solana/id.json`;
const DISC = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  recordDay: [21, 69, 138, 56, 95, 139, 121, 204],
};

const program = new PublicKey(PROGRAM_ID);
const conn = new Connection(RPC, 'confirmed');
const signer = Keypair.fromSecretKey(Uint8Array.from(
  process.env.FLAREWATCH_SECRET ? JSON.parse(process.env.FLAREWATCH_SECRET) : JSON.parse(readFileSync(KEY, 'utf8')),
));
const [registry] = PublicKey.findProgramAddressSync([Buffer.from('registry')], program);
const dayNum = (d) => Number(d.replaceAll('-', ''));
const dayPda = (d) => {
  const b = Buffer.alloc(4); b.writeUInt32LE(dayNum(d));
  return PublicKey.findProgramAddressSync([Buffer.from('day'), b], program)[0];
};

async function send(data, keys) {
  const ix = new TransactionInstruction({ programId: program, keys, data });
  return sendAndConfirmTransaction(conn, new Transaction().add(ix), [signer]);
}

const anchorsPath = `${DATA_DIR}/anchors.json`;
const anchors = existsSync(anchorsPath) ? JSON.parse(readFileSync(anchorsPath, 'utf8')) : {};

if (!(await conn.getAccountInfo(registry))) {
  const method = Buffer.from(sha256(readFileSync(`${ROOT}/METHOD.md`)), 'hex');
  const sig = await send(Buffer.concat([Buffer.from(DISC.initialize), method]), [
    { pubkey: signer.publicKey, isSigner: true, isWritable: true },
    { pubkey: registry, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
  console.log(`registry created ${registry.toBase58()} method ${method.toString('hex')} tx ${sig}`);
}

for (const day of loadDays()) {
  const pda = dayPda(day.day);
  const existing = await conn.getAccountInfo(pda);
  if (existing) {
    const onchain = existing.data.subarray(12, 44).toString('hex');
    if (onchain !== day.digest) console.log(`${day.day}: MISMATCH chain ${onchain} file ${day.digest}`);
    continue;
  }
  const s = dayStats(day);
  const data = Buffer.alloc(8 + 4 + 32 + 2 + 4 + 8);
  let o = 0;
  Buffer.from(DISC.recordDay).copy(data, o); o += 8;
  data.writeUInt32LE(dayNum(day.day), o); o += 4;
  Buffer.from(day.digest, 'hex').copy(data, o); o += 32;
  data.writeUInt16LE(s.flareSites, o); o += 2;
  data.writeUInt32LE(s.detections, o); o += 4;
  data.writeBigUInt64LE(BigInt(s.totalFrpKw), o);
  const sig = await send(data, [
    { pubkey: signer.publicKey, isSigner: true, isWritable: true },
    { pubkey: registry, isSigner: false, isWritable: true },
    { pubkey: pda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
  anchors[day.day] = { account: pda.toBase58(), tx: sig };
  writeFileSync(anchorsPath, JSON.stringify(anchors, null, 1) + '\n');
  console.log(`${day.day}: recorded ${day.digest} tx ${sig}`);
}
