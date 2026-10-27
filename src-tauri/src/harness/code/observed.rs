//! Política de observação de arquivos (read-before-write / CAS por hash).
//!
//! O agente só pode substituir/editar um arquivo que **leu nesta sessão** e que
//! não mudou desde a leitura. É o que torna edições de código seguras sem
//! sandbox de SO (`docs/goals/code-harness/HARNESS.md` §7.3).
//!
//! O registro é em memória (por app): depois de reiniciar, a primeira escrita
//! exige uma nova leitura — o erro `FS_NOT_OBSERVED` ensina o modelo a reler.
//! O hash é o mesmo do journal (sha256 do conteúdo).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use sha2::{Digest, Sha256};

/// sha256 hex (usado pelo journal e pela observação; `sha2 0.11` devolve `Array`).
pub fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Versão observada de um arquivo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedVersion {
    pub hash: String,
    pub size: u64,
}

/// Estado de uma tentativa de mutação.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObservationState {
    /// Nunca lido nesta sessão.
    Missing,
    /// Lido, mas o conteúdo no disco mudou.
    Stale,
    /// Lido e inalterado — pode mutar.
    Fresh,
}

/// Arquivos observados nesta execução do app (compartilhado no `AppState`).
#[derive(Default)]
pub struct ObservedFiles {
    entries: Mutex<HashMap<PathBuf, ObservedVersion>>,
}

impl ObservedFiles {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra a versão atual (chamado por `read_file` e por escritas bem-sucedidas).
    pub fn record(&self, path: &Path, bytes: &[u8]) {
        self.entries.lock().insert(
            path.to_path_buf(),
            ObservedVersion {
                hash: hash_bytes(bytes),
                size: bytes.len() as u64,
            },
        );
    }

    /// Compara o conteúdo atual com a versão observada.
    pub fn check(&self, path: &Path, current: &[u8]) -> ObservationState {
        let entries = self.entries.lock();
        match entries.get(path) {
            None => ObservationState::Missing,
            Some(version) => {
                if version.size == current.len() as u64
                    && version.hash == hash_bytes(current)
                {
                    ObservationState::Fresh
                } else {
                    ObservationState::Stale
                }
            }
        }
    }

    /// Esquece um arquivo (ex.: removido pelo agente).
    pub fn forget(&self, path: &Path) {
        self.entries.lock().remove(path);
    }

    pub fn clear(&self) {
        self.entries.lock().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_detects_changes() {
        let observed = ObservedFiles::new();
        let path = Path::new("C:/proj/a.ts");
        observed.record(path, b"let a = 1;\n");
        assert_eq!(
            observed.check(path, b"let a = 1;\n"),
            ObservationState::Fresh
        );
        assert_eq!(
            observed.check(path, b"let a = 2;\n"),
            ObservationState::Stale
        );
        assert_eq!(
            observed.check(Path::new("C:/proj/b.ts"), b"x"),
            ObservationState::Missing
        );
    }

    #[test]
    fn hash_is_stable_hex() {
        assert_eq!(
            hash_bytes(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(hash_bytes(b"abc").len(), 64);
    }

    #[test]
    fn forget_removes_the_entry() {
        let observed = ObservedFiles::new();
        let path = Path::new("C:/proj/a.ts");
        observed.record(path, b"conteudo");
        observed.forget(path);
        assert_eq!(
            observed.check(path, b"conteudo"),
            ObservationState::Missing
        );
    }
}
