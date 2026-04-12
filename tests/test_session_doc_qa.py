from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

_root = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _root)

for k, v in [
    ("SUPABASE_URL", "https://test.supabase.co"),
    ("SUPABASE_KEY", "test-key"),
    ("DEEPGRAM_API_KEY", "test-dg"),
    ("OPENAI_API_KEY", "test-openai"),
]:
    os.environ.setdefault(k, v)

from packages.backend.main import app  # noqa: E402
from packages.backend.db.models import UploadedFile, Session  # noqa: E402
from packages.backend.pipelines import rag  # noqa: E402


class SessionDocQATests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.headers = {"X-User-Id": "00000000-0000-0000-0000-000000000001"}
        self.session = Session(
            id="11111111-1111-1111-1111-111111111111",
            user_id=self.headers["X-User-Id"],
            started_at="2026-01-01T00:00:00Z",
            ended_at=None,
            duration_seconds=None,
            overall_score=None,
            summary=None,
        )

    def _mock_file(self, *, status: str = "ready", session_id: str | None = None) -> UploadedFile:
        return UploadedFile(
            id="f1",
            user_id=self.headers["X-User-Id"],
            session_id=session_id or self.session.id,
            filename="deck.pdf",
            file_type="pdf",
            mime_type="application/pdf",
            uploaded_at="2026-01-01T00:00:00Z",
            chunk_count=4,
            processing_status=status,  # type: ignore[arg-type]
            processed_at=None,
            failed_reason=None,
        )

    @patch("packages.backend.main.queries.list_files")
    @patch("packages.backend.main.queries.get_session")
    def test_session_qa_processing_state(self, mock_get_session: MagicMock, mock_list_files: MagicMock) -> None:
        mock_get_session.return_value = self.session
        mock_list_files.return_value = [self._mock_file(status="parsing")]
        resp = self.client.post(
            f"/sessions/{self.session.id}/qa",
            headers=self.headers,
            json={"question": "How will you grow?"},
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertEqual(payload["status"], "processing")
        self.assertEqual(payload["source"], "llm_fallback")

    @patch("packages.backend.main.rag.answer_question", new_callable=AsyncMock)
    @patch("packages.backend.main.queries.list_files")
    @patch("packages.backend.main.queries.get_session")
    def test_session_qa_grounded_response(
        self,
        mock_get_session: MagicMock,
        mock_list_files: MagicMock,
        mock_answer: AsyncMock,
    ) -> None:
        mock_get_session.return_value = self.session
        mock_list_files.return_value = [self._mock_file(status="ready")]
        mock_answer.return_value = rag.RAGResult(
            answer="Founder-led campus pilots first, then ambassadors.",
            source="session_docs",
            confidence=0.82,
            supporting_context=[{"fileName": "deck.pdf", "location": "Slide 8"}],
            sources_used=["deck.pdf"],
            fallback_used=False,
        )
        resp = self.client.post(
            f"/sessions/{self.session.id}/qa",
            headers=self.headers,
            json={"question": "First 100 customers?"},
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertEqual(payload["source"], "session_docs")
        self.assertGreater(payload["confidence"], 0.7)
        self.assertEqual(payload["supporting_context"][0]["fileName"], "deck.pdf")

    @patch("packages.backend.main.asyncio.create_task")
    @patch("packages.backend.main.queries.insert_file")
    @patch("packages.backend.main.queries.get_session")
    def test_upload_session_file_associates_session(
        self,
        mock_get_session: MagicMock,
        mock_insert_file: MagicMock,
        mock_create_task: MagicMock,
    ) -> None:
        mock_get_session.return_value = self.session
        mock_insert_file.return_value = self._mock_file(status="uploaded")
        mock_create_task.side_effect = lambda coro: coro.close()
        files = {"file": ("deck.pdf", b"%PDF-1.4 fake", "application/pdf")}
        resp = self.client.post(f"/sessions/{self.session.id}/files", headers=self.headers, files=files)
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(mock_insert_file.called)
        call = mock_insert_file.call_args
        self.assertEqual(call.args[0], self.headers["X-User-Id"])
        self.assertEqual(call.args[-1], self.session.id)
        self.assertTrue(mock_create_task.called)

    def test_upload_rejects_unsupported_type(self) -> None:
        files = {"file": ("malware.exe", b"nope", "application/octet-stream")}
        resp = self.client.post("/files/upload", headers=self.headers, files=files)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported", resp.json()["detail"])


class RagScopingTests(unittest.IsolatedAsyncioTestCase):
    async def test_answer_question_scoped_to_session(self) -> None:
        with patch("packages.backend.pipelines.rag.embed_text", new=AsyncMock(return_value=[0.1] * 1536)):
            with patch("packages.backend.pipelines.rag.queries.similarity_search") as mock_search:
                mock_chunk = MagicMock()
                mock_chunk.similarity = 0.9
                mock_chunk.filename = "deck.pdf"
                mock_chunk.chunk_text = "Pilot with 3 campuses."
                mock_chunk.chunk_index = 0
                mock_chunk.metadata = {"location": "Slide 8"}
                mock_search.return_value = [mock_chunk]
                with patch("packages.backend.pipelines.rag._chat_complete", new=AsyncMock(return_value="Pilot then scale.")):
                    result = await rag.answer_question(
                        user_id="u1",
                        question="How do you acquire users?",
                        session_id="s1",
                    )
        self.assertEqual(result.source, "session_docs")
        self.assertFalse(result.fallback_used)
        self.assertEqual(mock_search.call_args.args[2], 5)
        self.assertEqual(mock_search.call_args.args[3], "s1")

    async def test_answer_question_fallback_on_low_similarity(self) -> None:
        with patch("packages.backend.pipelines.rag.embed_text", new=AsyncMock(return_value=[0.1] * 1536)):
            with patch("packages.backend.pipelines.rag.queries.similarity_search") as mock_search:
                mock_chunk = MagicMock()
                mock_chunk.similarity = 0.1
                mock_chunk.filename = "deck.pdf"
                mock_chunk.chunk_text = "irrelevant"
                mock_chunk.chunk_index = 0
                mock_chunk.metadata = {}
                mock_search.return_value = [mock_chunk]
                with patch("packages.backend.pipelines.rag._chat_complete", new=AsyncMock(return_value="Fallback answer.")):
                    result = await rag.answer_question(user_id="u1", question="question", session_id="s1")
        self.assertTrue(result.fallback_used)
        self.assertEqual(result.source, "llm_fallback")


if __name__ == "__main__":
    unittest.main()
