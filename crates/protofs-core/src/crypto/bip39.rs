use ring::digest::{Context, SHA256};
use zeroize::Zeroizing;

use crate::error::{ProtoFsError, Result};

const BIP39_ENGLISH: &str = include_str!("bip39_english.txt");

fn get_wordlist() -> Result<Vec<&'static str>> {
    let list: Vec<&'static str> = BIP39_ENGLISH
        .lines()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if list.len() != 2048 {
        return Err(ProtoFsError::Crypto(format!(
            "BIP-39 wordlist corrupted: expected 2048 words, found {}",
            list.len()
        )));
    }
    Ok(list)
}

/// Encodes 32 bytes of root key entropy into a 24-word BIP-39 mnemonic with 8-bit SHA-256 checksum.
pub fn entropy_to_mnemonic(entropy: &[u8; 32]) -> Result<String> {
    let wordlist = get_wordlist()?;

    let mut context = Context::new(&SHA256);
    context.update(entropy);
    let digest = context.finish();
    let checksum_byte = digest.as_ref()[0];

    let mut bits = Vec::with_capacity(264);
    for &byte in entropy.iter() {
        for i in (0..8).rev() {
            bits.push((byte >> i) & 1);
        }
    }
    for i in (0..8).rev() {
        bits.push((checksum_byte >> i) & 1);
    }

    let mut words = Vec::with_capacity(24);
    for chunk in bits.chunks(11) {
        let mut index = 0usize;
        for &bit in chunk {
            index = (index << 1) | (bit as usize);
        }
        words.push(wordlist[index]);
    }

    Ok(words.join(" "))
}

/// Decodes and validates a 24-word BIP-39 mnemonic back into 32-byte root key entropy.
pub fn mnemonic_to_entropy(mnemonic: &str) -> Result<Zeroizing<[u8; 32]>> {
    let wordlist = get_wordlist()?;
    let input_words: Vec<&str> = mnemonic.split_whitespace().collect();
    if input_words.len() != 24 {
        return Err(ProtoFsError::Crypto(
            "Recovery phrase must contain exactly 24 words".to_string(),
        ));
    }

    let mut bits = Vec::with_capacity(264);
    for word in input_words {
        let idx = wordlist
            .iter()
            .position(|&w| w == word)
            .ok_or_else(|| ProtoFsError::Crypto(format!("Invalid BIP-39 word: {}", word)))?;
        for i in (0..11).rev() {
            bits.push(((idx >> i) & 1) as u8);
        }
    }

    let mut entropy = Zeroizing::new([0u8; 32]);
    for (i, chunk) in bits[..256].chunks(8).enumerate() {
        let mut byte = 0u8;
        for &bit in chunk {
            byte = (byte << 1) | bit;
        }
        entropy[i] = byte;
    }

    let mut expected_checksum = 0u8;
    for &bit in &bits[256..264] {
        expected_checksum = (expected_checksum << 1) | bit;
    }

    let mut context = Context::new(&SHA256);
    context.update(entropy.as_ref());
    let actual_checksum = context.finish().as_ref()[0];

    if expected_checksum != actual_checksum {
        return Err(ProtoFsError::Crypto(
            "Invalid recovery phrase checksum. Please check for typos.".to_string(),
        ));
    }

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
