import bcrypt from 'bcryptjs';
import { loadDotenv } from '../src/lib/dotenv';
import { getPool, closePool } from '../src/db/pool';
import { newId } from '../src/lib/crypto';

loadDotenv();

async function main(): Promise<void> {
  const matricula = process.env.SEED_MATRICULA ?? '000001';
  const senha = process.env.SEED_SENHA ?? 'Mudar1234';
  const nome = process.env.SEED_NOME ?? 'Admin';
  const sobrenome = process.env.SEED_SOBRENOME ?? 'LogEnxoval';

  const pool = getPool();
  const existing = await pool.query('SELECT id FROM users WHERE matricula = $1', [matricula]);
  if (existing.rows.length) {
    console.log(`admin já existe (matricula=${matricula})`);
    return;
  }
  const senhaHash = await bcrypt.hash(senha, 12);
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO users (id, matricula, nome, sobrenome, perfil, senha_hash, criado_em, atualizado_em)
     VALUES ($1,$2,$3,$4,'ADMIN',$5,$6,$7)`,
    [newId(), matricula, nome, sobrenome, senhaHash, now, now],
  );
  console.log(`admin criado — matricula=${matricula} senha=${senha}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());