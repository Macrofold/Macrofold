package macrofold

import (
 "encoding/json"
 "testing"
)

func TestConnectionSelectionPresence(t *testing.T) {
 patch := NewAgentPatch()
 assertJSON := func(want string) { t.Helper(); data,err:=json.Marshal(patch); if err!=nil || string(data)!=want { t.Fatalf("want %s, got %s (%v)",want,data,err) } }
 assertJSON(`{}`)
 patch.SetConnectionGrants([]Grant{})
 assertJSON(`{"connection_grants":[]}`)
 patch.SetConnectionGrants(nil)
 assertJSON(`{"connection_grants":null}`)
 if !patch.HasConnectionGrants() { t.Fatal("explicit null must retain presence") }
 patch.UnsetConnectionGrants()
 assertJSON(`{}`)
 if err:=json.Unmarshal([]byte(`{"connection_grants":null}`),patch); err!=nil { t.Fatal(err) }
 assertJSON(`{"connection_grants":null}`)
 if err:=json.Unmarshal([]byte(`{}`),patch); err!=nil { t.Fatal(err) }
 assertJSON(`{}`)
}
