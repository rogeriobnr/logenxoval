import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { getPinHash, setPin } from '../src/repos/settingsRepo';

describe('settings — PIN administrativo global (repos/settingsRepo)', () => {
  before(async () => {
    await ensureMigrated();
    await resetDb();
  });

  after(async () => {
    await closePool();
  });

  it('getPinHash retorna null quando nunca configurado', async () => {
    assert.equal(await getPinHash(), null);
  });

  it('setPin cria a linha e getPinHash devolve o hash do bcrypt', async () => {
    await setPin('1234');
    const hash = await getPinHash();
    assert.ok(hash, 'hash deve existir');
    assert.notEqual(hash, '1234');
    assert.equal(await bcrypt.compare('1234', hash), true);
    assert.equal(await bcrypt.compare('9999', hash), false);
  });

  it('setPin é idempotente para deposito_id NULL (sem duplicar) e atualiza o hash', async () => {
    await setPin('1234');
    await setPin('1234'); // deve sobrescrever, não duplicar

    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n, min(valor::text) AS v FROM settings WHERE chave = $1 AND deposito_id IS NULL',
      ['ADMIN_PIN_HASH'],
    );
    assert.equal(rows[0].n, 1, 'deve haver exatamente uma linha global');

    let hash = await getPinHash();
    assert.equal(await bcrypt.compare('1234', hash as string), true);

    await setPin('5678');
    hash = await getPinHash();
    assert.equal(await bcrypt.compare('5678', hash as string), true);
    assert.equal(await bcrypt.compare('1234', hash as string), false);
  });
});