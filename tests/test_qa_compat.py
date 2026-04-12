"""Compatibility tests for Q&A assist feature. Run without real API keys."""

from __future__ import annotations

import os
import sys
import unittest

_root = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _root)

for k, v in [
    ("SUPABASE_URL", "https://test.supabase.co"),
    ("SUPABASE_KEY", "test-key"),
    ("DEEPGRAM_API_KEY", "test-dg"),
    ("OPENAI_API_KEY", "test-openai"),
]:
    os.environ.setdefault(k, v)

_env = os.path.join(_root, ".env")
if os.path.isfile(_env):
    import dotenv
    dotenv.load_dotenv(_env, override=True)


class TestQACompat(unittest.TestCase):
    def test_rag_result_dataclass(self):
        """RAGResult has required fields."""
        from packages.backend.pipelines.rag import RAGResult
        r = RAGResult(
            answer="x",
            confidence=0.5,
            sources_used=["a.pdf"],
            fallback_used=False,
            source="session_docs",
            supporting_context=[{"fileName": "a.pdf", "location": "Page 1"}],
        )
        self.assertEqual(r.answer, "x")
        self.assertEqual(r.confidence, 0.5)
        self.assertEqual(r.sources_used, ["a.pdf"])
        self.assertFalse(r.fallback_used)

    def test_document_chunk_from_db_row(self):
        """DocumentChunk.from_db_row parses pgvector string."""
        from packages.backend.db.models import DocumentChunk
        row = {
            "id": "a",
            "user_id": "b",
            "file_id": "c",
            "chunk_text": "hello",
            "chunk_index": 0,
            "embedding": "[0.1, 0.2]",
            "similarity": 0.75,
            "filename": "doc.pdf",
        }
        c = DocumentChunk.from_db_row(row)
        self.assertEqual(c.embedding, [0.1, 0.2])
        self.assertEqual(c.similarity, 0.75)
        self.assertEqual(c.filename, "doc.pdf")

    def test_qa_event_fields(self):
        """QAEvent has confidence, sources_used, fallback_used."""
        from packages.backend.db.models import QAEvent
        from datetime import datetime, timezone
        e = QAEvent(
            question_text="Q",
            answer_text="A",
            speaker_response_text="",
            similarity_score=0.0,
            whispered=False,
            timestamp=datetime.now(timezone.utc),
            confidence=0.8,
            sources_used=["slide1.pptx"],
            fallback_used=False,
        )
        self.assertEqual(e.confidence, 0.8)
        self.assertEqual(e.sources_used, ["slide1.pptx"])
        self.assertFalse(e.fallback_used)

    def test_config_has_qa_settings(self):
        """Config includes new Q&A settings."""
        from packages.backend.config import settings
        self.assertTrue(hasattr(settings, "QUESTION_CAPTURE_WINDOW_SECONDS"))
        self.assertTrue(hasattr(settings, "QA_MIN_CHUNK_SIMILARITY"))
        self.assertTrue(hasattr(settings, "ANTHROPIC_API_KEY"))
        self.assertTrue(hasattr(settings, "OPENROUTER_API_KEY"))

    def test_qa_pipeline_guardrail_constants(self):
        """QAPipeline has filler and vague patterns."""
        from packages.backend.pipelines.qa import _FILLER_STALL_PATTERNS, _VAGUE_SHORT_PHRASES
        self.assertIn("i don't know", _VAGUE_SHORT_PHRASES)
        self.assertIsNotNone(_FILLER_STALL_PATTERNS.search("that's a good question"))
        self.assertIsNotNone(_FILLER_STALL_PATTERNS.search("um let me think"))


if __name__ == "__main__":
    unittest.main()
