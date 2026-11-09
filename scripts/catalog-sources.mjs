/**
 * Public inputs for the bundled model catalog.
 *
 * The pages below are the only public, credential-free sources for the gateway
 * model tables. `sync-catalog.mjs` fetches them before every build so new
 * models do not need a manual catalog edit.
 */

export const DOC_SOURCES = [
  {
    provider: 'go',
    label: 'OpenCode Go',
    url: 'https://opencode.ai/v2/docs/console/go/',
  },
  {
    provider: 'zen',
    label: 'OpenCode Zen',
    url: 'https://opencode.ai/v2/docs/console/models/',
  },
];

export const MODELS_DEV_URL = 'https://models.dev/api.json';

const NAMED_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

/** Decodes the entities the docs pages use without pulling a parser package. */
export function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    if (code.startsWith('#')) {
      const hex = code[1]?.toLowerCase() === 'x';
      const digits = code.slice(hex ? 2 : 1);
      const point = Number.parseInt(digits, hex ? 16 : 10);
      if (Number.isFinite(point) && point <= 0x10ffff) {
        try {
          return String.fromCodePoint(point);
        } catch {
          return entity;
        }
      }
      return entity;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

function plainText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function tableRows(html) {
  const rows = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowPattern.exec(html))) {
    const cells = [];
    const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cell;
    while ((cell = cellPattern.exec(row[1]))) {
      const text = cell[1];
      const withCode = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
      cells.push(plainText(withCode));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export function protocolForEndpoint(endpoint) {
  if (!endpoint) return null;
  if (endpoint.includes('/openai/v1/chat/completions')) return 'openai-chat';
  if (endpoint.includes('/openai/v1/responses')) return 'openai-responses';
  if (endpoint.includes('/anthropic/v1/messages')) return 'anthropic';
  if (endpoint.includes('/google/v1beta/models/')) return 'google';
  return null;
}

/**
 * Extracts the `Model | Model ID | Endpoint | AI SDK Package` table.
 * Returns `{ id, name, endpoint, protocol }` in page order, deduplicated by id.
 */
export function parseDocsModels(html) {
  const models = [];
  const seen = new Set();
  for (const cells of tableRows(html)) {
    if (cells.length < 4) continue;
    const name = cells[0];
    const id = cells[1].replaceAll('`', '').trim();
    const endpoint = cells[2].replaceAll('`', '').trim();
    if (!id || /^model id$/i.test(id)) continue;
    if (!/^[a-z0-9][a-z0-9.\-]*$/.test(id)) continue;
    const protocol = protocolForEndpoint(endpoint);
    if (!protocol || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, name, endpoint, protocol });
  }
  return models;
}

/**
 * A docs page must look like a model table, not an error page or a redesign.
 * The smallest table in this project currently has more than ten rows.
 */
export function assertDocsModels(models, label) {
  if (!Array.isArray(models) || models.length < 10) {
    throw new Error(`${label}: tabela de modelos inesperada (${models?.length ?? 0} linhas)`);
  }
  return models;
}
