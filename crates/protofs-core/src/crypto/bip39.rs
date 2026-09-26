use bip39::{Language, Mnemonic};
use zeroize::Zeroizing;

use crate::error::{ProtoFsError, Result};

/// Encodes 32 bytes of root key entropy into a 24-word BIP-39 mnemonic with 8-bit SHA-256 checksum.
pub fn entropy_to_mnemonic(entropy: &[u8; 32]) -> Result<String> {
    let mnemonic = Mnemonic::from_entropy_in(Language::English, entropy)
        .map_err(|e| ProtoFsError::Crypto(format!("Failed to generate mnemonic: {}", e)))?;
    Ok(mnemonic.to_string())
}

/// Decodes and validates a 24-word BIP-39 mnemonic back into 32-byte root key entropy.
pub fn mnemonic_to_entropy(mnemonic: &str) -> Result<Zeroizing<[u8; 32]>> {
    let parsed = Mnemonic::parse_in_normalized(Language::English, mnemonic)
        .map_err(|e| ProtoFsError::Crypto(format!("Invalid BIP-39 recovery phrase: {}", e)))?;

    let entropy_bytes = parsed.to_entropy();
    if entropy_bytes.len() != 32 {
        return Err(ProtoFsError::Crypto(format!(
            "Expected 32 bytes entropy (24 words), found {} bytes",
            entropy_bytes.len()
        )));
    }

    let mut entropy = Zeroizing::new([0u8; 32]);
    entropy.copy_from_slice(&entropy_bytes);
    Ok(entropy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    #[test]
    fn test_entropy_to_mnemonic_and_back() {
        let mut entropy = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut entropy);

        let mnemonic = entropy_to_mnemonic(&entropy).expect("mnemonic generation failed");
        let words: Vec<&str> = mnemonic.split_whitespace().collect();
        assert_eq!(words.len(), 24);

        let recovered = mnemonic_to_entropy(&mnemonic).expect("mnemonic parsing failed");
        assert_eq!(entropy, *recovered);
    }

    #[test]
    fn test_corrupted_mnemonic_word_fails() {
        let mut entropy = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut entropy);

        let mnemonic = entropy_to_mnemonic(&entropy).expect("mnemonic generation failed");
        let mut words: Vec<&str> = mnemonic.split_whitespace().collect();
        words[0] = "invalidnotawordxyz";
        let bad_mnemonic = words.join(" ");

        assert!(mnemonic_to_entropy(&bad_mnemonic).is_err());
    }

    #[test]
    fn test_invalid_checksum_fails() {
        let mut entropy = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut entropy);

        let mnemonic = entropy_to_mnemonic(&entropy).expect("mnemonic generation failed");
        let mut words: Vec<&str> = mnemonic.split_whitespace().collect();
        // Swap last word with another valid BIP-39 word to break checksum
        words[23] = if words[23] == "zoo" { "abandon" } else { "zoo" };
        let bad_mnemonic = words.join(" ");

        let result = mnemonic_to_entropy(&bad_mnemonic);
        assert!(result.is_err());
    }
}
