use std::fmt;

use rand::RngCore;
use ring::aead::{AES_256_GCM, Aad, LessSafeKey, Nonce, UnboundKey};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::crypto::kdf::{KEY_LEN, SALT_LEN, derive_key, generate_salt};
use crate::error::{ProtoFsError, Result};

pub const NONCE_LEN: usize = 12;

/// Serializable envelope protecting the root Master Key with passphrase-derived AES-256-GCM.
#[derive(Clone, Serialize, Deserialize)]
pub struct VaultEnvelope {
    pub salt: [u8; SALT_LEN],
    pub nonce: [u8; NONCE_LEN],
    pub ciphertext: Vec<u8>,
}

impl fmt::Debug for VaultEnvelope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("VaultEnvelope")
            .field("salt", &"[REDACTED]")
            .field("nonce", &"[REDACTED]")
            .field("ciphertext_len", &self.ciphertext.len())
            .finish()
    }
}

/// Generates a fresh cryptographically secure 256-bit root master key.
pub fn generate_root_master_key() -> Zeroizing<[u8; KEY_LEN]> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    rand::thread_rng().fill_bytes(&mut *key);
    key
}

/// Alias for `generate_root_master_key`.
pub fn generate_root_key() -> Zeroizing<[u8; KEY_LEN]> {
    generate_root_master_key()
}

/// Wraps a 256-bit root master key inside an AES-256-GCM envelope using an Argon2id-derived key.
pub fn wrap_master_key(root_key: &[u8; KEY_LEN], passphrase: &str) -> Result<VaultEnvelope> {
    let salt = generate_salt();
    let derived_key = derive_key(passphrase, &salt)?;

    let unbound = UnboundKey::new(&AES_256_GCM, derived_key.as_ref())
        .map_err(|_| ProtoFsError::Crypto("Failed to create wrapping key".to_string()))?;
    let key = LessSafeKey::new(unbound);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let mut buffer = root_key.to_vec();
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce_bytes),
        Aad::empty(),
        &mut buffer,
    )
    .map_err(|_| ProtoFsError::Crypto("Envelope encryption failed".to_string()))?;

    Ok(VaultEnvelope {
        salt,
        nonce: nonce_bytes,
        ciphertext: buffer,
    })
}

/// Unwraps an AES-256-GCM envelope using the provided passphrase, restoring the 256-bit root key.
pub fn unwrap_master_key(
    envelope: &VaultEnvelope,
    passphrase: &str,
) -> Result<Zeroizing<[u8; KEY_LEN]>> {
    let derived_key = derive_key(passphrase, &envelope.salt)?;

    let unbound = UnboundKey::new(&AES_256_GCM, derived_key.as_ref())
        .map_err(|_| ProtoFsError::Crypto("Failed to create unwrapping key".to_string()))?;
    let key = LessSafeKey::new(unbound);

    let mut buffer = envelope.ciphertext.clone();
    let decrypted = key
        .open_in_place(
            Nonce::assume_unique_for_key(envelope.nonce),
            Aad::empty(),
            &mut buffer,
        )
        .map_err(|_| {
            ProtoFsError::Crypto("Envelope decryption failed or incorrect passphrase".to_string())
        })?;

    if decrypted.len() != KEY_LEN {
        return Err(ProtoFsError::Crypto(
            "Invalid decrypted master key length".to_string(),
        ));
    }

    let mut root_key = Zeroizing::new([0u8; KEY_LEN]);
    root_key.copy_from_slice(decrypted);
    buffer.zeroize();

    Ok(root_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wrap_unwrap_master_key_roundtrip() {
        let root = generate_root_master_key();
        let pass = "correct-horse-battery-staple-secure";

        let envelope = wrap_master_key(&root, pass).expect("wrap failed");
        assert_eq!(envelope.ciphertext.len(), KEY_LEN + 16);

        let unwrapped = unwrap_master_key(&envelope, pass).expect("unwrap failed");
        assert_eq!(root.as_ref(), unwrapped.as_ref());
    }

    #[test]
    fn test_unwrap_invalid_passphrase_fails() {
        let root = generate_root_master_key();
        let envelope = wrap_master_key(&root, "mypassword123").expect("wrap failed");

        let result = unwrap_master_key(&envelope, "wrongpassword");
        assert!(result.is_err());
    }

    #[test]
    fn test_rewrap_master_key_preserves_root_entropy() {
        let root = generate_root_master_key();
        let old_pass = "old-strong-passphrase-1";
        let new_pass = "new-strong-passphrase-2";

        let env1 = wrap_master_key(&root, old_pass).expect("wrap 1 failed");
        let unwrapped1 = unwrap_master_key(&env1, old_pass).expect("unwrap 1 failed");

        let env2 = wrap_master_key(&unwrapped1, new_pass).expect("wrap 2 failed");
        assert_ne!(env1.salt, env2.salt);
        assert_ne!(env1.nonce, env2.nonce);
        assert_ne!(env1.ciphertext, env2.ciphertext);

        let unwrapped2 = unwrap_master_key(&env2, new_pass).expect("unwrap 2 failed");
        assert_eq!(root.as_ref(), unwrapped2.as_ref());
    }
}
