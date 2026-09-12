pub fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[derive(Debug, Clone)]
pub struct WebDavProp {
    pub href: String,
    pub is_dir: bool,
    pub display_name: String,
    pub size_bytes: u64,
    pub mime_type: String,
    pub last_modified_rfc1123: String,
    pub quota_available_bytes: u64,
    pub quota_used_bytes: u64,
}

pub fn render_multistatus(props: &[WebDavProp]) -> String {
    let mut xml =
        String::from(r#"<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:">"#);
    for p in props {
        xml.push_str("<D:response>");
        xml.push_str(&format!("<D:href>{}</D:href>", escape_xml(&p.href)));
        xml.push_str("<D:propstat><D:prop>");
        xml.push_str(&format!(
            "<D:displayname>{}</D:displayname>",
            escape_xml(&p.display_name)
        ));
        if p.is_dir {
            xml.push_str("<D:resourcetype><D:collection/></D:resourcetype>");
        } else {
            xml.push_str("<D:resourcetype/>");
            xml.push_str(&format!(
                "<D:getcontentlength>{}</D:getcontentlength>",
                p.size_bytes
            ));
            xml.push_str(&format!(
                "<D:getcontenttype>{}</D:getcontenttype>",
                escape_xml(&p.mime_type)
            ));
        }
        xml.push_str(&format!(
            "<D:getlastmodified>{}</D:getlastmodified>",
            p.last_modified_rfc1123
        ));
        xml.push_str(&format!(
            "<D:quota-available-bytes>{}</D:quota-available-bytes>",
            p.quota_available_bytes
        ));
        xml.push_str(&format!(
            "<D:quota-used-bytes>{}</D:quota-used-bytes>",
            p.quota_used_bytes
        ));
        xml.push_str("</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>");
        xml.push_str("</D:response>");
    }
    xml.push_str("</D:multistatus>");
    xml
}

pub fn render_lockdiscovery(href: &str, token: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8" ?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>Infinity</D:depth>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>urn:uuid:{}</D:href></D:locktoken>
      <D:lockroot><D:href>{}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>"#,
        escape_xml(token),
        escape_xml(href)
    )
}
