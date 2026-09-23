import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PERFIL, baixaBodySchema } from '../src/index.js';

describe('contracts', () => {
  it('enums exportados', () => {
    assert.equal(PERFIL.ADMIN, 'ADMIN');
  });

  it('schema de baixa aceita payload válido', () => {
    const parsed = baixaBodySchema.parse({
      operationId: '11111111-1111-1111-1111-111111111111',
      codigoSap: '1002341',
      quantidade: 2,
      reposicao: true,
      origem: 'OFFLINE',
      dispositivo: 'device-abc',
      dataHora: new Date().toISOString(),
      assinaturaMatricula: 'MAT-001',
    });
    assert.equal(parsed.quantidade, 2);
  });

  it('schema de baixa rejeita quantidade inválida', () => {
    assert.throws(() =>
      baixaBodySchema.parse({
        operationId: '11111111-1111-1111-1111-111111111111',
        codigoSap: '1002341',
        quantidade: 0,
        reposicao: false,
        origem: 'ONLINE',
        dispositivo: 'device-abc',
        dataHora: new Date().toISOString(),
        assinaturaMatricula: 'MAT-001',
      }),
    );
  });
});