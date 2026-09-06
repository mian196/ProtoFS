use crate::error::{ProtoFsError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedCaption {
    pub parent_id: String,
    pub name: String,
    pub is_encrypted: bool,
    pub iv: Option<String>,
    pub sha256_hash: Option<String>,
}

impl ParsedCaption {
    pub const PREFIX: &'static str = "protofs:v1;";

    pub fn new(
        parent_id: &str,
        name: &str,
        is_encrypted: bool,
        iv: Option<&str>,
        hash: Option<&str>,
    ) -> Self {
        Self {
            parent_id: parent_id.to_string(),
            name: name.to_string(),
            is_encrypted,
            iv: iv.map(|s| s.to_string()),
            sha256_hash: hash.map(|s| s.to_string()),
        }
    }

    pub fn serialize(&self) -> String {
        let mut parts = Vec::new();
        parts.push(format!("parent:{}", self.parent_id));
        parts.push(format!("name:{}", self.name));
        parts.push(format!("enc:{}", if self.is_encrypted { "1" } else { "0" }));

        if let Some(ref iv) = self.iv {
            parts.push(format!("iv:{}", iv));
        }
        if let Some(ref hash) = self.sha256_hash {
            parts.push(format!("hash:{}", hash));
        }

        format!("{}{}", Self::PREFIX, parts.join(";"))
    }

    pub fn parse(caption: &str) -> Result<Self> {
        let trimmed = caption.trim();
        let payload = if let Some(stripped) = trimmed.strip_prefix(Self::PREFIX) {
            stripped
        } else {
            return Err(ProtoFsError::Serialization(serde_json::Error::io(
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Caption does not have ProtoFS prefix",
                ),
            )));
        };

        let mut parent_id = None;
        let mut name = None;
        let mut is_encrypted = false;
        let mut iv = None;
        let mut sha256_hash = None;

        for field in payload.split(';') {
            let mut kv = field.splitn(2, ':');
            if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
                match k.trim() {
                    "parent" => parent_id = Some(v.trim().to_string()),
                    "name" => name = Some(v.trim().to_string()),
                    "enc" => is_encrypted = v.trim() == "1",
                    "iv" => iv = Some(v.trim().to_string()),
                    "hash" => sha256_hash = Some(v.trim().to_string()),
                    _ => {}
                }
            }
        }

        let parent_id = parent_id.ok_or_else(|| {
            ProtoFsError::Serialization(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Missing parent field in caption",
            )))
        })?;

        let name = name.ok_or_else(|| {
            ProtoFsError::Serialization(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Missing name field in caption",
            )))
        })?;

        Ok(Self {
            parent_id,
            name,
            is_encrypted,
            iv,
            sha256_hash,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_caption_roundtrip() {
        let caption = ParsedCaption::new(
            "f_docs",
            "Tax_Return_2025.pdf",
            true,
            Some("a1b2c3d4e5f6"),
            Some("3a7b8c9d..."),
        );

        let serialized = caption.serialize();
        assert!(serialized.starts_with("protofs:v1;"));

        let parsed = ParsedCaption::parse(&serialized).unwrap();
        assert_eq!(parsed, caption);
    }

    #[test]
    fn test_caption_missing_prefix_fails() {
        assert!(ParsedCaption::parse("regular telegram caption").is_err());
    }
}
