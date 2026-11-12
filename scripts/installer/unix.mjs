import { readFileSync } from 'node:fs';
import path from 'node:path';
import { VERSION_PATTERN } from './shared.mjs';

export const MANAGED_BASE_URL = 'https://github.com/Hyska-Software/ZylaraAi';
export const MANAGED_DATA_DIR_NAME = 'app.zylara.chat';

export const SUPPORTED_TARGETS = Object.freeze({
  'linux-x64': Object.freeze({
    platform: 'linux',
    arch: 'x64',
    machine: 'x86_64',
    payloadExtension: '.AppImage',
  }),
  'macos-arm64': Object.freeze({
    platform: 'macos',
    arch: 'arm64',
    machine: 'arm64',
    payloadExtension: '.dmg',
  }),
});

const TEMPLATE_KEYS = [
  '@VERSION@',
  '@PLATFORM@',
  '@ARCH@',
  '@PAYLOAD_NAME@',
  '@PAYLOAD_SIZE@',
  '@PAYLOAD_SHA256@',
  '@PAYLOAD_URL@',
  '@HTTPS@',
  '@DATA_DIR_NAME@',
  '@MESSAGE_CASES@',
];
const TEMPLATE_PATH = path.join(import.meta.dirname, 'unix-installer.sh');

const MESSAGES = {
  platform: {
    en: 'This installer does not support this operating system.',
    pt: 'Este instalador não suporta este sistema operacional.',
    es: 'Este instalador no admite este sistema operativo.',
  },
  arch: {
    en: 'This installer does not support this computer architecture.',
    pt: 'Este instalador não suporta esta arquitetura.',
    es: 'Este instalador no admite esta arquitectura.',
  },
  home: {
    en: 'HOME must be set to an absolute path.',
    pt: 'HOME precisa ser um caminho absoluto.',
    es: 'HOME debe ser una ruta absoluta.',
  },
  tools: {
    en: 'Missing required tools:',
    pt: 'Ferramentas necessárias ausentes:',
    es: 'Faltan herramientas necesarias:',
  },
  space: {
    en: 'Not enough free disk space to install Zylara.',
    pt: 'Espaço em disco insuficiente para instalar o Zylara.',
    es: 'No hay suficiente espacio en disco para instalar Zylara.',
  },
  download: {
    en: 'Could not download the update.',
    pt: 'Não foi possível baixar a atualização.',
    es: 'No se pudo descargar la actualización.',
  },
  size: {
    en: 'The downloaded file size does not match the release metadata.',
    pt: 'O tamanho do arquivo baixado não corresponde aos metadados da release.',
    es: 'El tamaño del archivo descargado no coincide con los metadatos de la versión.',
  },
  hash: {
    en: 'The downloaded file checksum does not match the release metadata.',
    pt: 'O checksum do arquivo baixado não corresponde aos metadados da release.',
    es: 'La suma de comprobación del archivo descargado no coincide con los metadatos de la versión.',
  },
  target: {
    en: 'The installation target is a symlink or has an unexpected type.',
    pt: 'O destino da instalação é um symlink ou tem um tipo inesperado.',
    es: 'El destino de la instalación es un enlace simbólico o tiene un tipo inesperado.',
  },
  install: {
    en: 'Could not install Zylara.',
    pt: 'Não foi possível instalar o Zylara.',
    es: 'No se pudo instalar Zylara.',
  },
  dmg: {
    en: 'The DMG does not contain a valid Zylara app.',
    pt: 'O DMG não contém um app Zylara válido.',
    es: 'El DMG no contiene una aplicación Zylara válida.',
  },
  backup: {
    en: 'Could not back up the current installation.',
    pt: 'Não foi possível fazer backup da instalação atual.',
    es: 'No se pudo hacer una copia de seguridad de la instalación actual.',
  },
  promote: {
    en: 'Could not replace the current installation.',
    pt: 'Não foi possível substituir a instalação atual.',
    es: 'No se pudo reemplazar la instalación actual.',
  },
  desktop: {
    en: 'Zylara was installed, but the desktop entry could not be written.',
    pt: 'O Zylara foi instalado, mas não foi possível criar o atalho do menu.',
    es: 'Zylara se instaló, pero no se pudo crear el acceso del menú.',
  },
  marker: {
    en: 'Zylara was installed, but the managed-install marker could not be written.',
    pt: 'O Zylara foi instalado, mas não foi possível gravar o marcador de instalação gerenciada.',
    es: 'Zylara se instaló, pero no se pudo escribir el marcador de instalación gestionada.',
  },
  done: {
    en: 'Zylara installed successfully.',
    pt: 'Zylara instalado com sucesso.',
    es: 'Zylara se instaló correctamente.',
  },
};

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function messageCases() {
  const lines = [];
  for (const [key, languages] of Object.entries(MESSAGES)) {
    for (const language of ['en', 'pt', 'es']) {
      lines.push(
        `    ${language}:${key}) printf '%s\\n' ${shellQuote(languages[language])} ;;`,
      );
    }
  }
  return lines.join('\n');
}

export function managedTarget(platform, arch) {
  return SUPPORTED_TARGETS[`${platform}-${arch}`] ?? null;
}

export function installerScriptName(version, platform, arch) {
  if (!VERSION_PATTERN.test(String(version))) {
    throw new Error(`versão inválida: ${version}`);
  }
  const target = managedTarget(platform, arch);
  if (!target) {
    throw new Error(`alvo gerenciado não suportado: ${platform}/${arch}`);
  }
  return `Zylara-install-${version}-${platform}-${arch}.sh`;
}

export function payloadForTarget(files, target) {
  if (!target) return null;
  const extension = target.payloadExtension.toLowerCase();
  return files.find((file) => file.toLowerCase().endsWith(extension)) ?? null;
}

export function renderUnixInstaller({
  version,
  platform,
  arch,
  artifact,
  baseUrl = MANAGED_BASE_URL,
}) {
  if (!VERSION_PATTERN.test(String(version))) {
    throw new Error(`versão inválida: ${version}`);
  }
  const target = managedTarget(platform, arch);
  if (!target) {
    throw new Error(`alvo gerenciado não suportado: ${platform}/${arch}`);
  }
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('artefato ausente');
  }
  const name = String(artifact.name ?? '');
  if (
    name.length === 0 ||
    name.length > 160 ||
    !/^[A-Za-z0-9._+-]+$/.test(name) ||
    name.includes('..') ||
    !name.toLowerCase().endsWith(target.payloadExtension.toLowerCase())
  ) {
    throw new Error(`nome de artefato inválido: ${name}`);
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
    throw new Error(`tamanho de artefato inválido: ${artifact.size}`);
  }
  const sha256 = String(artifact.sha256 ?? '');
  if (!/^[0-9a-fA-F]{64}$/.test(sha256)) {
    throw new Error('SHA-256 do artefato inválido');
  }
  let parsedBase;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    throw new Error(`URL base inválida: ${baseUrl}`);
  }
  const localhost = parsedBase.hostname === '127.0.0.1' || parsedBase.hostname === 'localhost';
  if (
    parsedBase.protocol !== 'https:' &&
    !(parsedBase.protocol === 'http:' && localhost)
  ) {
    throw new Error(`URL base não permitida: ${baseUrl}`);
  }
  if (parsedBase.search || parsedBase.hash) {
    throw new Error(`URL base não pode ter query ou hash: ${baseUrl}`);
  }
  const base = baseUrl.replace(/\/+$/, '');
  const payloadUrl = `${base}/releases/download/v${version}/${name}`;
  const replacements = {
    '@VERSION@': shellQuote(version),
    '@PLATFORM@': shellQuote(platform),
    '@ARCH@': shellQuote(arch),
    '@PAYLOAD_NAME@': shellQuote(name),
    '@PAYLOAD_SIZE@': String(artifact.size),
    '@PAYLOAD_SHA256@': shellQuote(sha256.toLowerCase()),
    '@PAYLOAD_URL@': shellQuote(payloadUrl),
    '@HTTPS@': parsedBase.protocol === 'https:' ? '1' : '0',
    '@DATA_DIR_NAME@': shellQuote(MANAGED_DATA_DIR_NAME),
    '@MESSAGE_CASES@': messageCases(),
  };
  let script = readFileSync(TEMPLATE_PATH, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    script = script.replaceAll(key, () => value);
  }
  const unresolved = TEMPLATE_KEYS.filter((key) => script.includes(key));
  if (unresolved.length > 0) {
    throw new Error(`placeholders não resolvidos: ${unresolved.join(', ')}`);
  }
  return script;
}
