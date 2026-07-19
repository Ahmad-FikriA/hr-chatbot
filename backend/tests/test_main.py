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
    assert "best handled by a person directly" in data["answer"]
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
    assert "ditangani langsung oleh staf HR" in data["answer"]
