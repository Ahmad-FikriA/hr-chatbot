import os

# Clean up NO_PROXY if it contains IPv6 tokens that crash httpx url parsing
for _k in ["NO_PROXY", "no_proxy"]:
    if _k in os.environ:
        os.environ[_k] = ",".join([_p for _p in os.environ[_k].split(",") if not _p.strip().startswith(":")])

from fastapi.testclient import TestClient
from app.main import app, get_current_user

# 1. Mock the user authentication dependency so we don't need a live database
async def mock_get_current_user():
    return {
        "id": 999,
        "email": "test@example.com",
        "name": "Test User",
        "role": "employee"
    }

# Inject the mock user
app.dependency_overrides[get_current_user] = mock_get_current_user

client = TestClient(app)

def test_chat_empty_question():
    """Test that sending an empty question returns 400 Bad Request."""
    response = client.post("/api/chat", json={"question": "   "})
    assert response.status_code == 400
    assert response.json()["detail"] == "question is required"

def test_chat_guardrail_escalation_en():
    """Test that English sensitive topics trigger guardrail escalation."""
    response = client.post(
        "/api/chat", 
        json={"question": "I want to sue my manager for harassment."}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "escalated"
    assert "best handled" in data["answer"]
    assert len(data["sources"]) == 0

def test_chat_guardrail_escalation_id():
    """Test that Indonesian sensitive topics trigger guardrail escalation."""
    response = client.post(
        "/api/chat", 
        json={"question": "bagaimana cara melapor pelecehan seksual di kantor?"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "escalated"
    assert "ditangani langsung" in data["answer"]

def test_docs_list():
    """Test that /api/docs returns a list of document items with metadata."""
    response = client.get("/api/docs")
    assert response.status_code == 200
    docs = response.json()
    assert isinstance(docs, list)
    if len(docs) > 0:
        first = docs[0]
        assert "filename" in first
        assert "name" in first
        assert "file_type" in first
        assert "equipment" in first

def test_docs_preview():
    """Test previewing a document if documents exist."""
    response = client.get("/api/docs")
    docs = response.json()
    if len(docs) > 0:
        target_path = docs[0]["filename"]
        prev_res = client.get(f"/api/docs/{target_path}")
        assert prev_res.status_code == 200
        data = prev_res.json()
        assert "content" in data
        assert "file_type" in data

