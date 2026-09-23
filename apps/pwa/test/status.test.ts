import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusSync, type StateInput } from '../src/lib/status';

function base(over: Partial<StateInput>): StateInput {
  return {
    online: true,
    filaPendente: 0,
    erro: false,
    sincronizando: false,
    conflitoPendente: false,
    ...over,
  };
}

test('statusSync: online e fila vazia → SINCRONIZADO', () => {
  assert.equal(statusSync(base({})), 'SINCRONIZADO');
});

test('statusSync: offline sem pendência', () => {
  assert.equal(statusSync(base({ online: false, filaPendente: 0 })), 'OFFLINE_SEM_PENDENCIA');
});

test('statusSync: offline com pendência', () => {
  assert.equal(statusSync(base({ online: false, filaPendente: 3 })), 'OFFLINE_COM_PENDENCIA');
});

test('statusSync: sincronizando tem prioridade sobre tudo', () => {
  assert.equal(
    statusSync(base({ online: false, filaPendente: 2, conflitoPendente: true, sincronizando: true })),
    'SINCRONIZANDO',
  );
});

test('statusSync: conflito pendente tem prioridade sobre offline/erro', () => {
  assert.equal(statusSync(base({ online: false, conflitoPendente: true })), 'CONFLITO_PENDENTE');
});

test('statusSync: erro de rede online → ERRO_SINCRONIZACAO', () => {
  assert.equal(statusSync(base({ online: true, erro: true })), 'ERRO_SINCRONIZACAO');
});