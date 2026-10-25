import { describe, expect, it } from 'vitest';
import { CSV_DELIMITERS, detectDelimiter, parseCsv } from './csv';

describe('detectDelimiter', () => {
  it('reconhece vírgula, ponto e vírgula, tabulação e pipe', () => {
    expect(detectDelimiter('nome,valor\nana,1')).toBe(',');
    expect(detectDelimiter('nome;valor\nana;1')).toBe(';');
    expect(detectDelimiter('nome\tvalor\nana\t1')).toBe('\t');
    expect(detectDelimiter('nome|valor\nana|1')).toBe('|');
  });

  it('escolhe o delimitador que produz mais colunas na primeira linha', () => {
    expect(detectDelimiter('a;b;c;d\n1;2;3;4')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('ignora delimitadores dentro de aspas', () => {
    expect(detectDelimiter('"Silva, Ana";30\n"Pereira, Bia";25')).toBe(';');
    expect(detectDelimiter('"a\tb";c\n1;2')).toBe(';');
    expect(detectDelimiter('"linha1\nlinha2",b\n1,2')).toBe(',');
  });

  it('pula linhas de título antes do cabeçalho real', () => {
    expect(detectDelimiter('Relatório de vendas\nNome;Valor\nAna;10')).toBe(';');
  });

  it('cai na vírgula quando nenhum separador aparece', () => {
    expect(detectDelimiter('somente uma coluna\nsem separador')).toBe(',');
    expect(detectDelimiter('')).toBe(',');
  });

  it('tolera BOM no início do arquivo', () => {
    expect(detectDelimiter('\uFEFFnome;valor\nana;1')).toBe(';');
  });

  it('mantém a ordem de prioridade em empates', () => {
    expect(CSV_DELIMITERS).toEqual([',', ';', '\t', '|']);
    expect(detectDelimiter('a,b;c')).toBe(',');
  });
});

describe('parseCsv', () => {
  it('tabula CSV com vírgula', () => {
    const parsed = parseCsv('Nome,Idade\nAna,30\nBia,25');
    expect(parsed.delimiter).toBe(',');
    expect(parsed.rows).toEqual([
      ['Nome', 'Idade'],
      ['Ana', '30'],
      ['Bia', '25'],
    ]);
    expect(parsed.totalRows).toBe(3);
    expect(parsed.truncated).toBe(false);
  });

  it('tabula CSV com ponto e vírgula', () => {
    const parsed = parseCsv('Nome;Idade\nAna;30');
    expect(parsed.delimiter).toBe(';');
    expect(parsed.rows).toEqual([
      ['Nome', 'Idade'],
      ['Ana', '30'],
    ]);
  });

  it('tabula TSV', () => {
    const parsed = parseCsv('Nome\tIdade\nAna\t30');
    expect(parsed.delimiter).toBe('\t');
    expect(parsed.rows).toEqual([
      ['Nome', 'Idade'],
      ['Ana', '30'],
    ]);
  });

  it('tabula CSV separado por pipe', () => {
    const parsed = parseCsv('Nome|Idade\nAna|30');
    expect(parsed.delimiter).toBe('|');
    expect(parsed.rows).toEqual([
      ['Nome', 'Idade'],
      ['Ana', '30'],
    ]);
  });

  it('respeita aspas com delimitador e aspas escapadas', () => {
    const parsed = parseCsv('Nome,Observação\n"Silva, Ana","Disse ""oi"""');
    expect(parsed.delimiter).toBe(',');
    expect(parsed.rows[1]).toEqual(['Silva, Ana', 'Disse "oi"']);
  });

  it('mantém quebras de linha dentro de campo entre aspas', () => {
    const parsed = parseCsv('"linha1\nlinha2",b\n1,2');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual(['linha1\nlinha2', 'b']);
  });

  it('aceita CRLF e ignora o CR sobrando', () => {
    const parsed = parseCsv('Nome,Idade\r\nAna,30\r\n');
    expect(parsed.rows).toEqual([
      ['Nome', 'Idade'],
      ['Ana', '30'],
    ]);
  });

  it('remove o BOM do primeiro cabeçalho', () => {
    const parsed = parseCsv('\uFEFFnome;valor\nx;1');
    expect(parsed.rows[0][0]).toBe('nome');
    expect(parsed.delimiter).toBe(';');
  });

  it('trunca em 501 linhas por padrão e sinaliza no resultado', () => {
    const lines = ['id,nome'];
    for (let index = 1; index <= 600; index += 1) lines.push(`${index},linha ${index}`);
    const parsed = parseCsv(lines.join('\n'));
    expect(parsed.rows).toHaveLength(501);
    expect(parsed.totalRows).toBe(601);
    expect(parsed.truncated).toBe(true);
  });

  it('respeita um limite de linhas customizado', () => {
    const parsed = parseCsv('a,b\n1,2\n3,4\n5,6', 2);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.totalRows).toBe(4);
    expect(parsed.truncated).toBe(true);
  });

  it('preserva campos vazios e linha final sem quebra', () => {
    expect(parseCsv('a,b,\n1,2,').rows).toEqual([
      ['a', 'b', ''],
      ['1', '2', ''],
    ]);
    expect(parseCsv('a,b').rows).toEqual([['a', 'b']]);
  });

  it('lida com conteúdo vazio', () => {
    const parsed = parseCsv('');
    expect(parsed.rows).toEqual([]);
    expect(parsed.totalRows).toBe(0);
    expect(parsed.truncated).toBe(false);
    expect(parsed.delimiter).toBe(',');
  });

  it('aceita delimitador explícito sem autodetecção', () => {
    const parsed = parseCsv('a;b\n1;2', 501, ';');
    expect(parsed.delimiter).toBe(';');
    expect(parsed.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
