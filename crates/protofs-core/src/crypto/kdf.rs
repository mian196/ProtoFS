use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroizing;
use crate::error::{ProtoFsError, Result};

pub const SALT_LEN: usize = 16;
pub const KEY_LEN: usize = 32; // 256 bits

pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

pub fn derive_key(passphrase: &str, salt: &[u8]) -> Result<Zeroizing<[u8; KEY_LEN]>> {
    let params = Params::new(
        64 * 1024, // 64 MB memory cost
        4,         // 4 iterations
        1,         // 1 degree of parallelism
        Some(KEY_LEN),
    )
    .map_err(|e| ProtoFsError::Crypto(format!("Invalid Argon2 params: {}", e)))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut output_key = Zeroizing::new([0u8; KEY_LEN]);

    argon2
        .hash_password_into(passphrase.as_bytes(), salt, output_key.as_mut())
        .map_err(|e| ProtoFsError::Crypto(format!("Argon2id KDF failed: {}", e)))?;

    Ok(output_key)
}
