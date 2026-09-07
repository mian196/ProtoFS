use crate::error::{ProtoFsError, Result};
use rand::RngCore;
use ring::aead::{AES_256_GCM, Aad, LessSafeKey, Nonce, UnboundKey};

pub const CHUNK_PLAINTEXT_SIZE: usize = 64 * 1024; // 64 KB
pub const TAG_SIZE: usize = 16;
pub const CHUNK_ENCRYPTED_SIZE: usize = CHUNK_PLAINTEXT_SIZE + TAG_SIZE;
pub const BASE_IV_SIZE: usize = 7; // 7 bytes base + 4 bytes counter + 1 byte last_chunk flag = 12 bytes nonce

pub fn generate_base_iv() -> [u8; BASE_IV_SIZE] {
    let mut iv = [0u8; BASE_IV_SIZE];
    rand::thread_rng().fill_bytes(&mut iv);
    iv
}

pub fn derive_chunk_nonce(base_iv: &[u8; BASE_IV_SIZE], chunk_index: u32, is_final: bool) -> Nonce {
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes[..7].copy_from_slice(base_iv);
    nonce_bytes[7..11].copy_from_slice(&chunk_index.to_be_bytes());
    nonce_bytes[11] = if is_final { 0x01 } else { 0x00 };
    Nonce::assume_unique_for_key(nonce_bytes)
}

pub struct StreamEncryptor {
    key: LessSafeKey,
    base_iv: [u8; BASE_IV_SIZE],
}

impl StreamEncryptor {
    pub fn new(key_bytes: &[u8; 32], base_iv: [u8; BASE_IV_SIZE]) -> Result<Self> {
        let unbound = UnboundKey::new(&AES_256_GCM, key_bytes)
            .map_err(|_| ProtoFsError::Crypto("Invalid encryption key length".to_string()))?;
        Ok(Self {
            key: LessSafeKey::new(unbound),
            base_iv,
        })
    }

    pub fn base_iv(&self) -> &[u8; BASE_IV_SIZE] {
        &self.base_iv
    }

    pub fn encrypt_chunk(
        &self,
        chunk_index: u32,
        is_final: bool,
        plaintext: &[u8],
    ) -> Result<Vec<u8>> {
        let nonce = derive_chunk_nonce(&self.base_iv, chunk_index, is_final);
        let mut buffer = plaintext.to_vec();

        self.key
            .seal_in_place_append_tag(nonce, Aad::empty(), &mut buffer)
            .map_err(|_| ProtoFsError::Crypto(format!("Failed to seal chunk {}", chunk_index)))?;

        Ok(buffer)
    }
}

pub struct StreamDecryptor {
    key: LessSafeKey,
    base_iv: [u8; BASE_IV_SIZE],
}

impl StreamDecryptor {
    pub fn new(key_bytes: &[u8; 32], base_iv: [u8; BASE_IV_SIZE]) -> Result<Self> {
        let unbound = UnboundKey::new(&AES_256_GCM, key_bytes)
            .map_err(|_| ProtoFsError::Crypto("Invalid decryption key length".to_string()))?;
        Ok(Self {
            key: LessSafeKey::new(unbound),
            base_iv,
        })
    }

    pub fn decrypt_chunk(
        &self,
        chunk_index: u32,
        is_final: bool,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>> {
        let nonce = derive_chunk_nonce(&self.base_iv, chunk_index, is_final);
        let mut buffer = ciphertext.to_vec();

        let decrypted_slice = self
            .key
            .open_in_place(nonce, Aad::empty(), &mut buffer)
            .map_err(|_| {
                ProtoFsError::Crypto(format!(
                    "Authentication tag mismatch on chunk {}",
                    chunk_index
                ))
            })?;

        Ok(decrypted_slice.to_vec())
    }
}
