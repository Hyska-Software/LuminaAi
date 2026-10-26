#!/usr/bin/env node
/**
 * Sign in with ChatGPT — runtime probe (Fase 0 gate).
 *
 * Dev-only script (nunca é empacotado). Sobe um loopback em 127.0.0.1, imprime a
 * URL de autorização oficial (apps open-source/locais, "ChatGPT plan usage"),
 * troca o code e executa as sondagens G1–G5b do PLAN:
 *
 *   G1  registro dinâmico emite client_id (oaiapp_…)
 *   G2  GET /v1/models devolve models[] (slug/display_name/visibility)
 *   G3  POST /v1/responses (store:false, stream:true) conclui com response.completed
 *   G4  function tool do cliente é aceita (flat / namespace / additional_tools)
 *   G4b include:["reasoning.encrypted_content"] é aceito
 *   G5a scope chatgpt.tokens.use.direct concedido no token
 *   G5b (informativo) shape de erro de limite 429, se ocorrer
 *
 * Nenhum token é escrito em disco nem logado. Uso:
 *   node scripts/openai-plan-probe.mjs [--model gpt-6.1-sol]
 */

import crypto from 'node:crypto';
import http from 'node:http';

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const CLIENT_ID = 'dynamic_agent_client';
const AGENT_NAME = 'Lumina';
const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  'chatgpt.tokens.use.direct',
];
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const model = arg('--model', 'gpt-6.1-sol');

const b64url = (buffer) =>
  Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkce() {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function decodeJwtClaims(jwt) {
  try {
    const [, payload] = jwt.split('.');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function randomState() {
  return b64url(crypto.randomBytes(32));
}

async function exchangeCode({ code, verifier, redirectUri, clientId }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`token endpoint ${response.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

async function listModels(accessToken) {
  const response = await fetch(`${RESOURCE}/models`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, body: text.slice(0, 400) };
  }
  const json = JSON.parse(text);
  const models = json.models ?? json.data ?? [];
  return {
    ok: true,
    count: models.length,
    sample: models.slice(0, 8).map((entry) => ({
      id: entry.slug ?? entry.id,
      displayName: entry.display_name ?? entry.name,
      visibility: entry.visibility,
    })),
    shape: json.models ? 'models[]' : 'data[]',
  };
}

async function responsesProbe({ accessToken, payload, label }) {
  const response = await fetch(`${RESOURCE}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, body: text.slice(0, 600), events: [] };
  }
  const events = [...text.matchAll(/event: ([^\n]+)/g)].map((match) => match[1]);
  const named = [...text.matchAll(/"type":"(response\.[^"]+)"/g)].map((match) => match[1]);
  const allEvents = [...new Set([...events, ...named])];
  return {
    ok: allEvents.includes('response.completed'),
    status: response.status,
    events: allEvents.slice(0, 20),
    hasCompleted: allEvents.includes('response.completed'),
    hasToolCall: allEvents.some((event) => event.includes('function_call')),
    hasReasoning: allEvents.some((event) => event.includes('reasoning')),
    label,
  };
}

function basePayload(extra = {}) {
  return {
    model,
    input: [{ role: 'user', content: 'Say exactly: probe ok' }],
    store: false,
    stream: true,
    ...extra,
  };
}

async function waitForCallback({ redirectUri, expectedState, timeoutMs = 10 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, redirectUri);
      if (url.pathname !== '/auth/callback') {
        response.writeHead(404).end('not found');
        return;
      }
      const params = Object.fromEntries(url.searchParams.entries());
      const finish = (message) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
          `<!doctype html><meta charset="utf-8"><title>Lumina</title><body style="font-family:system-ui;padding:32px"><h1>${message}</h1><p>Você pode fechar esta aba e voltar ao terminal.</p></body>`,
        );
      };
      if (params.state !== expectedState) {
        finish('state inválido');
        reject(new Error('callback state mismatch'));
        server.close();
        return;
      }
      finish('Conta conectada');
      server.close();
      resolve(params);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve.port = port;
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('timeout aguardando o login no navegador'));
    }, timeoutMs);
    server.on('close', () => clearTimeout(timer));
    server.on('error', reject);
  });
}

async function main() {
  const { verifier, challenge } = pkce();
  const state = randomState();
  const nonce = randomState();

  // Bind the listener first, then build the exact redirect URI.
  const callbackPromise = waitForCallback({ redirectUri: 'http://127.0.0.1', expectedState: state });
  await new Promise((resolve) => setTimeout(resolve, 50)); // let listen() settle
  const port = callbackPromise.port;
  if (!port) throw new Error('não foi possível abrir o loopback local');
  const redirectUri = `http://127.0.0.1:${port}/auth/callback`;

  const authorize = new URL(AUTHORIZE);
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    agent_name_hint: AGENT_NAME,
    ext_agent_host_id: `urn:uuid:${crypto.randomUUID()}`,
  })) {
    authorize.searchParams.set(key, value);
  }

  console.log('\nAbra esta URL no navegador para autorizar o probe:\n');
  console.log(authorize.toString());
  console.log('\nAguardando callback…\n');

  const params = await callbackPromise;
  if (params.error) {
    throw new Error(`autorização recusada: ${params.error} ${params.error_description ?? ''}`);
  }
  const clientId = params.client_id || CLIENT_ID;
  const tokens = await exchangeCode({ code: params.code, verifier, redirectUri, clientId });
  const claims = decodeJwtClaims(tokens.id_token ?? '');
  const scopes = String(tokens.scope ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const issuedClientId = params.client_id ?? '(não retornado — reautorização)';

  const result = {
    G1_registration: {
      ok: Boolean(params.client_id && String(params.client_id).startsWith('oaiapp_')),
      issuedClientId,
    },
    G5a_plan_scope: { ok: scopes.includes(PLAN_SCOPE), scopes },
    identity: {
      sub: claims?.sub ? `${String(claims.sub).slice(0, 6)}…` : null,
      email: claims?.email ?? null,
      nonceMatches: claims?.nonce === nonce,
    },
  };

  result.G2_models = await listModels(tokens.access_token);

  const textProbe = await responsesProbe({ accessToken: tokens.access_token, payload: basePayload() });
  result.G3_text_stream = textProbe;

  const toolProbe = await responsesProbe({
    accessToken: tokens.access_token,
    label: 'flat function tool',
    payload: basePayload({
      tools: [
        {
          type: 'function',
          name: 'probe_echo',
          description: 'Echo a string',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ],
      tool_choice: 'auto',
      input: [{ role: 'user', content: 'Call probe_echo with text="ok".' }],
    }),
  });
  result.G4_tools = toolProbe;

  if (!toolProbe.ok && toolProbe.status >= 400) {
    // Try the documented alternative shape before giving up.
    result.G4_tools_additional = await responsesProbe({
      accessToken: tokens.access_token,
      label: 'additional_tools input item',
      payload: basePayload({
        input: [
          {
            type: 'additional_tools',
            tools: [
              {
                type: 'function',
                name: 'probe_echo',
                description: 'Echo a string',
                parameters: {
                  type: 'object',
                  properties: { text: { type: 'string' } },
                  required: ['text'],
                },
              },
            ],
          },
          { role: 'user', content: 'Call probe_echo with text="ok".' },
        ],
      }),
    });
  }

  result.G4b_reasoning_include = await responsesProbe({
    accessToken: tokens.access_token,
    label: 'include reasoning.encrypted_content',
    payload: basePayload({ include: ['reasoning.encrypted_content'] }),
  });

  const temperatureProbe = await responsesProbe({
    accessToken: tokens.access_token,
    label: 'temperature must be rejected',
    payload: basePayload({ temperature: 0.2 }),
  });
  result.temperature_rejected = {
    ok: !temperatureProbe.ok && temperatureProbe.status === 400,
    status: temperatureProbe.status,
  };

  console.log('\n=== RESULTADO DO PROBE ===\n');
  console.log(
    JSON.stringify(
      result,
      (key, value) => (key === 'access_token' || key === 'refresh_token' || key === 'id_token' ? '<redacted>' : value),
      2,
    ),
  );
  console.log('\nCopie este JSON (redigido) para docs/research/siwc-probe-results.md\n');
}

main().catch((error) => {
  console.error(`\nprobe falhou: ${error.message}\n`);
  process.exitCode = 1;
});
