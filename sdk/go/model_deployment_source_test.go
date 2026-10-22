package macrofold

import (
	"encoding/json"
	"testing"
)

func TestModelDeploymentSourceKeepsLiteralKinds(t *testing.T) {
	capabilities := `"capabilities":{"protocol":"openai_chat","input_modalities":["text"],"chat_completions":true,"json_object":false,"json_schema":false,"tools":false,"streaming":true,"stream_usage":true,"schema_keywords":[],"accepted_parameters":[],"schema_dialect":null,"context_window_tokens":8192,"max_output_tokens":2048,"max_concurrent_requests":2}`
	for _, repository := range []string{`null`, `"operator/model"`} {
		var source ModelDeploymentSource
		err := json.Unmarshal([]byte(`{"kind":"external","repository":`+repository+`,"revision":null,`+capabilities+`}`), &source)
		if err != nil || source.ModelDeploymentExternalSource == nil || source.ModelDeploymentHuggingFaceSource != nil {
			t.Fatalf("external source must retain exactly its branch: %#v %v", source, err)
		}
	}
	var source ModelDeploymentSource
	if err := json.Unmarshal([]byte(`{"kind":"hugging_face","repository":"owner/model"}`), &source); err != nil || source.ModelDeploymentHuggingFaceSource == nil || source.ModelDeploymentExternalSource != nil {
		t.Fatalf("HF source must retain exactly its branch: %#v %v", source, err)
	}
	if err := json.Unmarshal([]byte(`{"kind":"hugging_face","repository":"owner/model",`+capabilities+`}`), &source); err == nil {
		t.Fatal("HF source must reject properties belonging to the external branch")
	}
	if err := json.Unmarshal([]byte(`{"kind":"unknown","repository":"owner/model",`+capabilities+`}`), &source); err == nil {
		t.Fatal("unknown source kind must not match a branch")
	}
}
