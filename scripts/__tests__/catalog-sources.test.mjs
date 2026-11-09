import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDocsModels,
  decodeEntities,
  parseDocsModels,
  protocolForEndpoint,
} from '../catalog-sources.mjs';

const TABLE = `
<table>
  <tr><th>Model</th><th>Model ID</th><th>Endpoint</th><th>AI SDK Package</th></tr>
  <tr>
    <td>Gemini 4 Argon</td>
    <td><code>gemini-4-argon</code></td>
    <td><code>https://opencode.ai/inference/go/google/v1beta/models/gemini-4-argon</code></td>
    <td>@ai-sdk/google</td>
  </tr>
  <tr>
    <td>Hy4</td>
    <td><code>hy4</code></td>
    <td><code>https://opencode.ai/inference/go/openai/v1/chat/completions</code></td>
    <td>@ai-sdk/openai-compatible</td>
  </tr>
  <tr>
    <td>Crouton Alpha Free</td>
    <td><code>crouton-alpha-free</code></td>
    <td><code>https://opencode.ai/inference/go/openai/v1/responses</code></td>
    <td>@ai-sdk/openai</td>
  </tr>
  <tr>
    <td>Claude Haiku 5.5</td>
    <td><code>claude-haiku-5-5</code></td>
    <td><code>https://opencode.ai/inference/go/anthropic/v1/messages</code></td>
    <td>@ai-sdk/anthropic</td>
  </tr>
  <tr>
    <td>Duplicate</td>
    <td><code>hy4</code></td>
    <td><code>https://opencode.ai/inference/go/openai/v1/responses</code></td>
    <td>@ai-sdk/openai</td>
  </tr>
  <tr>
    <td>Broken</td>
    <td><code>Not A Model Id</code></td>
    <td><code>https://opencode.ai/inference/go/openai/v1/chat/completions</code></td>
    <td>@ai-sdk/openai-compatible</td>
  </tr>
  <tr>
    <td>No endpoint</td>
    <td><code>no-endpoint</code></td>
    <td>—</td>
    <td>@ai-sdk/openai-compatible</td>
  </tr>
</table>`;

test('parses the docs table and maps each endpoint to its wire protocol', () => {
  const models = parseDocsModels(TABLE);
  assert.deepEqual(
    models.map((model) => [model.id, model.protocol]),
    [
      ['gemini-4-argon', 'google'],
      ['hy4', 'openai-chat'],
      ['crouton-alpha-free', 'openai-responses'],
      ['claude-haiku-5-5', 'anthropic'],
    ],
  );
  assert.equal(models[0].name, 'Gemini 4 Argon');
});

test('maps every gateway endpoint and rejects unknown ones', () => {
  assert.equal(protocolForEndpoint('/openai/v1/chat/completions'), 'openai-chat');
  assert.equal(protocolForEndpoint('/openai/v1/responses'), 'openai-responses');
  assert.equal(protocolForEndpoint('/anthropic/v1/messages'), 'anthropic');
  assert.equal(protocolForEndpoint('/google/v1beta/models/{model}'), 'google');
  assert.equal(protocolForEndpoint('/v1/models'), null);
  assert.equal(protocolForEndpoint(''), null);
});

test('decodes numeric and named entities from the docs markup', () => {
  assert.equal(decodeEntities('A &amp; B &#39;x&#x27; &nbsp; &#x1F600;'), "A & B 'x'   😀");
  assert.equal(decodeEntities('&unknown; &#x110000;'), '&unknown; &#x110000;');
});

test('rejects an empty or truncated docs page', () => {
  assert.throws(() => assertDocsModels([], 'Go'), /tabela de modelos inesperada/);
  assert.throws(() => assertDocsModels([{ id: 'one' }], 'Go'), /1 linhas/);
  const ten = Array.from({ length: 10 }, (_, index) => ({ id: `m${index}` }));
  assert.equal(assertDocsModels(ten, 'Go'), ten);
});
