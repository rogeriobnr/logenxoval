/**
 * Bootstrap do primeiro usuário ADMIN (produção).
 * Requer SEED_ADMIN_MATRICULA e SEED_ADMIN_SENHA (opcionalmente NOME/SOBRENOME).
 * Idempotente: se já existir um admin com a matrícula, não faz nada.
 */

import bcrypt from 'bcryptjs';
import { loadDotenv } from '../lib/dotenv';
import { getPool, closePool } from './pool';
import { findByMatricula, createUser } from '../repos/usersRepo';

loadDotenv();

const MATRICULA = process.env.SEED_ADMIN_MATRICULA;
const SENHA = process.env.SEED_ADMIN_SENHA;
const NOME = process.env.SEED_ADMIN_NOME ?? 'Administrador';
const SOBRENOME = process.env.SEED_ADMIN_SOBRENOME ?? 'Principal';

if (!MATRICULA || !SENHA) {
  throw new Error('seed: defina SEED_ADMIN_MATRICULA e SEED_ADMIN_SENHA');
}

async function seedAdmin(): Promise<void> {
  const pool = getPool();
  await pool.query('SELECT 1');
  const existing = await findByMatricula(MATRICULA!);
  if (existing) {
    console.log(`seed: admin "${MATRICULA}" já existe, nada a fazer`);
    return;
  }
  const senhaHash = await bcrypt.hash(SENHA!, 12);
  await createUser({
    matricula: MATRICULA!,
    nome: NOME,
    sobrenome: SOBRENOME,
    perfil: 'ADMIN',
    senhaHash,
  });
  console.log(`seed: admin "${MATRICULA}" criado`);
}

seedAdmin()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });