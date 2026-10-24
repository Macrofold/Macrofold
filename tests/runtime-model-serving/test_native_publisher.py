"""Actual pinned Kev API/encoder/server compatibility with synthetic CPU probabilities.

Run inside Dockerfile.kev with MF_NATIVE_PUBLISHER_REQUIRED=1. No weights or GPU
are loaded; live qualification separately establishes the real scoring model.
"""

import importlib
import os
import types
import unittest

import httpx

from test_native import config
from test_runtime import serve
import kev_engine


class PublisherCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.publisher = importlib.import_module("kev.serve")
            cls.model_module = importlib.import_module("kev.model")
            cls.torch = importlib.import_module("torch")
        except ImportError:
            if os.environ.get("MF_NATIVE_PUBLISHER_REQUIRED") == "1":
                raise
            raise unittest.SkipTest("Pinned publisher compatibility runs inside the native image")

    async def test_actual_publisher_encodes_and_returns_all_named_native_question_types(self):
        class Tokenizer:
            pad_token_id = 0

            def __call__(self, text, **kwargs):
                return types.SimpleNamespace(input_ids=list(str(text).encode()))

            def convert_tokens_to_ids(self, token):
                return self_tokens.index(token) + 256

        torch = self.torch
        encode = self.model_module.encode
        self_tokens = self.model_module.SPECIAL

        class CpuFixtureModel:
            prefix_min_tokens = 0
            graphs = None

            def encode(self, tokenizer, record, **kwargs):
                return encode(tokenizer, record, **kwargs)

            def probs_batch(self, encodings, cached, keep):
                return [[torch.tensor([1 / len(indices)] * len(indices)) for indices in item["opt_idx"]] for item in encodings], [None] * len(encodings)

        scorer = kev_engine.managed_server(self.publisher, None, Tokenizer(), CpuFixtureModel(), config(), device="cpu")
        body = {"model": "revision-native", "state": {"fixture": "explicit evidence"}, "questions": {
            "arbitrary-choice": {"type": "choice", "instructions": "Select", "criteria": {"first": "A", "second": "B"}},
            "noul-question": {"type": "noul", "instructions": "True?"},
            "native-score": {"type": "score", "instructions": "Score", "criteria": ["low", "medium", "high"]},
        }}
        try:
            async with serve(kev_engine.create_app(config(), self.publisher, scorer)) as origin:
                async with httpx.AsyncClient(base_url=origin, trust_env=False) as client:
                    response = await client.post("/v1/systemone", json=body)
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(set(result["answers"]), set(body["questions"]))
            self.assertEqual(result["answers"]["arbitrary-choice"]["probabilities"], {"first": 0.5, "second": 0.5})
            self.assertEqual(result["answers"]["noul-question"]["noul"], 0.5)
            self.assertEqual(result["answers"]["native-score"]["score"], 1.0)
            self.assertEqual(result["answers"]["native-score"]["legend"], {"0": "low", "1": "medium", "2": "high"})
            self.assertGreater(result["usage"]["input_tokens"], 0)
            self.assertGreater(result["usage"]["output_tokens"], 0)
            self.assertIn("latency_ms", result)
        finally:
            scorer.close()
