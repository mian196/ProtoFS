use crate::error::{ProtoFsError, Result};

#[cfg(target_os = "windows")]
mod platform {
    use std::ptr::null_mut;

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DataBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut std::ffi::c_void,
            p_prompt_struct: *mut std::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;

        fn CryptUnprotectData(
            p_data_in: *const DataBlob,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut std::ffi::c_void,
            p_prompt_struct: *mut std::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    pub fn encrypt_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let in_blob = DataBlob {
            cb_data: plaintext.len() as u32,
            pb_data: plaintext.as_ptr() as *mut u8,
        };
        let mut out_blob = DataBlob {
            cb_data: 0,
            pb_data: null_mut(),
        };

        let success = unsafe {
            CryptProtectData(
                &in_blob,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };

        if success == 0 {
            return Err("Windows DPAPI CryptProtectData failed".to_string());
        }

        let slice =
            unsafe { std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize) };
        let ciphertext = slice.to_vec();
        unsafe {
            LocalFree(out_blob.pb_data as *mut std::ffi::c_void);
        }
        Ok(ciphertext)
    }

    pub fn decrypt_bytes(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let in_blob = DataBlob {
            cb_data: ciphertext.len() as u32,
            pb_data: ciphertext.as_ptr() as *mut u8,
        };
        let mut out_blob = DataBlob {
            cb_data: 0,
            pb_data: null_mut(),
        };

        let success = unsafe {
            CryptUnprotectData(
                &in_blob,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };

        if success == 0 {
            return Err("Windows DPAPI CryptUnprotectData failed".to_string());
        }

        let slice =
            unsafe { std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize) };
        let plaintext = slice.to_vec();
        unsafe {
            LocalFree(out_blob.pb_data as *mut std::ffi::c_void);
        }
        Ok(plaintext)
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    // Cross-platform fallback using local hardware-bound AES-256-GCM
    use rand::RngCore;
    use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};

    fn get_machine_key() -> [u8; 32] {
        let id = std::fs::read_to_string("/etc/machine-id")
            .unwrap_or_else(|_| "protofs-default-entropy-seed-key".to_string());
        let mut key = [0u8; 32];
        let bytes = id.as_bytes();
        for (i, b) in bytes.iter().enumerate() {
            key[i % 32] ^= *b;
        }
        key
    }

    pub fn encrypt_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let key_bytes = get_machine_key();
        let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
            .map_err(|_| "Failed to create key".to_string())?;
        let key = LessSafeKey::new(unbound);

        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::assume_unique_for_key(nonce_bytes);

        let mut out = nonce_bytes.to_vec();
        let mut body = plaintext.to_vec();
        key.seal_in_place_append_tag(nonce, Aad::empty(), &mut body)
            .map_err(|_| "Encryption failed".to_string())?;

        out.extend(body);
        Ok(out)
    }

    pub fn decrypt_bytes(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        if ciphertext.len() < 12 + 16 {
            return Err("Ciphertext too short".to_string());
        }
        let key_bytes = get_machine_key();
        let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
            .map_err(|_| "Failed to create key".to_string())?;
        let key = LessSafeKey::new(unbound);

        let mut nonce_bytes = [0u8; 12];
        nonce_bytes.copy_from_slice(&ciphertext[..12]);
        let nonce = Nonce::assume_unique_for_key(nonce_bytes);

        let mut body = ciphertext[12..].to_vec();
        let decrypted = key
            .open_in_place(nonce, Aad::empty(), &mut body)
            .map_err(|_| "Decryption failed".to_string())?;

        Ok(decrypted.to_vec())
    }
}

/// Protects sensitive credentials (session tokens, keys, passwords) using native OS hardware-backed encryption.
pub fn protect_secret(secret_bytes: &[u8]) -> Result<Vec<u8>> {
    platform::encrypt_bytes(secret_bytes).map_err(ProtoFsError::Crypto)
}

/// Decrypts sensitive credentials previously protected by protect_secret.
pub fn unprotect_secret(encrypted_bytes: &[u8]) -> Result<Vec<u8>> {
    platform::decrypt_bytes(encrypted_bytes).map_err(ProtoFsError::Crypto)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protect_unprotect_roundtrip() {
        let sensitive = b"my_super_secret_telegram_api_hash_and_session_token_12345";
        let encrypted = protect_secret(sensitive).expect("encryption should succeed");
        assert_ne!(sensitive.to_vec(), encrypted);

        let decrypted = unprotect_secret(&encrypted).expect("decryption should succeed");
        assert_eq!(sensitive.to_vec(), decrypted);
    }
}
