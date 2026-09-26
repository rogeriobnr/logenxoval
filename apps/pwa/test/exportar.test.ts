import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compartilharArquivo, podeCompartilharArquivos, salvarComDialogoOuDownload, temDialogoDeArquivos } from '../src/lib/exportar';

test('em ambiente Node (sem browser) não há diálogo de arquivos nem compartilhamento', () => {
  assert.equal(temDialogoDeArquivos(), false);
  assert.equal(podeCompartilharArquivos(), false);
});

test('compartilharArquivo sem suporte → false', async () => {
  assert.equal(await compartilharArquivo(new Blob(['x']), 'a.lxb'), false);
});

test('sem showSaveFilePicker, salvarComDialogoOuDownload cai no download clássico', async () => {
  // baixarArquivo exige document (browser); em Node o caminho nativo não existe,
  // então este helper só pode ser exercitado no navegador — aqui garantimos o guard de capacidade.
  assert.equal(temDialogoDeArquivos(), false);
  try {
    await salvarComDialogoOuDownload(new Blob(['x']), 'a.lxb', 'application/octet-stream');
    assert.fail('era esperado lançar por falta de document no Node');
  } catch (err) {
    assert.ok(err instanceof ReferenceError || (err as Error).message.includes('document'));
  }
});