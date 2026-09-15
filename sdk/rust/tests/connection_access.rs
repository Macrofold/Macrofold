use macrofold::models::AgentPatch;
use serde_json::{json, to_value};
#[test]
fn selection_presence() {
 let mut patch = AgentPatch::new();
 assert_eq!(to_value(&patch).unwrap(), json!({}));
 patch.connection_grants = Some(Some(vec![]));
 assert_eq!(to_value(&patch).unwrap(), json!({"connection_grants":[]}));
 patch.connection_grants = Some(None);
 assert_eq!(to_value(&patch).unwrap(), json!({"connection_grants":null}));
 patch.connection_grants = None;
 assert_eq!(to_value(&patch).unwrap(), json!({}));
}
