# 06 — Fluxo de Atualização do Enxoval por Foto/PDF (OCR)

## 6.1 Entrada

Botão **Atualizar Enxoval**:

- Fotografar folha pela câmera.
- Selecionar imagem da galeria.
- Selecionar PDF (1 ou várias páginas).
- Multi-importação de páginas.

Documento original sempre preservado em `documents` (blob + `hashDocumento` sha256).

## 6.2 Pré-processamento da imagem

```
1. Correção de rotação (orientação EXIF / detector de linhas).
2. Correção de perspectiva (quadrilátero da folha).
3. Recorte da região da tabela (detecção da grade).
4. Melhoria de contraste (CLAHE + binarização).
```

## 6.3 OCR (Tesseract.js local)

- Lê por célula/grade: número SAP, texto breve, depósito, utilização livre (qtd sistema), valores, e **opcionalmente** a quantidade manuscrita da coluna "Conferência".
- Heurísticas:
  - coluna impressa **Utilização livre** = quantidade do sistema (referência);
  - coluna manuscrita **Conferência** = quantidade física *daquela ocasião*;
  - **nunca** substitui automaticamente a qtd oficial pela manuscrita.
- Composto com elegibilidade: números SAP são validados (formato alfanumérico/quantidade de dígitos configurável).
- Extração de "grade" por detecção de linhas de tabela (Hough simples) + medianas de coordenadas para células.

## 6.4 Tela de revisão

Color coding do campo reconhecido:

| Cor     | Significado                                             |
| ------- | ------------------------------------------------------- |
| Verde   | Reconhecido e validado                                  |
| Amarelo | Baixa confiança ou possível erro                        |
| Vermelho| Campo obrigatório ausente/inválido                      |
| Azul    | Item novo ou alteração detectada vs. versão atual       |

- Todos os campos editáveis manualmente antes da publicação.

## 6.5 Comparação antes de publicar

Comparar com versão atual e listar:

- Itens novos.
- Itens removidos.
- Quantidades alteradas.
- Descrições alteradas.
- Itens sem alteração.
- Possíveis duplicidades.
- Códigos inválidos.
- Itens de outro depósito (bloqueados por regra).

## 6.6 Publicação

- Exige confirmação **digitando matrícula**.
- Cria `depositVersions` com: id da versão, depósito, data, usuário, matrícula, documento original (ref), alterações (json), motivo, referência da folha, hash do documento.
- Itens antigos com movimentações **não são apagados**: mudam status p/ `ALTERADO|REMOVIDO_DA_LISTA_OFICIAL|PENDENTE_DE_REVISAO`.
- Gera espelho (snapshot `DEPOIS`), log `IMPORTACAO_FOLHA` + `PUBLICACAO_ENXOVAL`, ponto de restauração.
- Ao encontrar código SAP da nova lista que exista em Peças Avulsas → gerar `conversionSuggestions` (PENDENTE), nunca converter automaticamente.

## 6.7 Página/PDF multi

- Multi-página: processa página a página, agrega itens, marca duplicidades entre páginas para revisão manual.