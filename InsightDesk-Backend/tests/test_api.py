from fastapi.testclient import TestClient
import uuid

import pytest

from main import app


client = TestClient(app)




@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from services.rate_limit import _buckets, _lock
    with _lock:
        _buckets.clear()
    yield
    with _lock:
        _buckets.clear()


def get_auth_headers():

    email = f"test_{uuid.uuid4().hex}@example.com"

    client.post(
        "/auth/signup",
        json={
            "email": email,
            "password": "test123",
        },
    )

    login_response = client.post(
        "/auth/login",
        json={"email": email, "password": "test123"},
    )

    token = login_response.json()["token"]

    return {"Authorization": f"Bearer {token}"}



def test_get_chats():

    headers = get_auth_headers()

    response = client.get("/chats", headers=headers)

    assert response.status_code == 200

    data = response.json()

    assert "current_chat_id" in data
    assert "chats" in data


def test_create_chat():

    headers = get_auth_headers()

    response = client.post(
        "/chats",
        json={"name": "Test Chat"},
        headers=headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert "chat_id" in data
    assert data["name"] == "Test Chat"


def test_get_documents():

    headers = get_auth_headers()

    response = client.get("/documents", headers=headers)

    assert response.status_code == 200

    data = response.json()

    assert "documents" in data
    assert "count" in data


def test_rag_status():

    headers = get_auth_headers()

    response = client.get("/rag/status", headers=headers)

    assert response.status_code == 200

    data = response.json()

    assert "documents" in data
    assert "document_count" in data
    assert "chat_count" in data
    assert "current_chat_id" in data
    assert "chunk_size" in data
    assert "chunk_overlap" in data
    assert "top_k" in data
    assert "llm_model" in data
    assert "embedding_model" in data


def test_delete_nonexistent_document_returns_404():

    headers = get_auth_headers()

    response = client.delete(
        "/documents/doc_does_not_exist",
        headers=headers,
    )

    assert response.status_code == 404

    data = response.json()

    assert "detail" in data


def test_delete_document_removes_it():

    headers = get_auth_headers()

    files = [
        (
            "files",
            (
                "delete_test.txt",
                b"This file is used to test document deletion.",
                "text/plain",
            ),
        )
    ]

    upload_response = client.post(
        "/documents",
        files=files,
        data={
            "chunk_size": 800,
            "chunk_overlap": 150,
            "top_k": 4,
        },
        headers=headers,
    )

    assert upload_response.status_code == 200

    upload_data = upload_response.json()

    document_ids = upload_data[
        "processing_info"
    ]["document_ids"]

    assert len(document_ids) == 1

    document_id = document_ids[0]

    before_response = client.get("/documents", headers=headers)

    before_ids = [
        document["document_id"]
        for document in before_response.json()["documents"]
    ]

    assert document_id in before_ids

    delete_response = client.delete(
        f"/documents/{document_id}",
        headers=headers,
    )

    assert delete_response.status_code == 200

    delete_data = delete_response.json()

    assert delete_data["document_id"] == document_id
    assert "message" in delete_data

    after_response = client.get("/documents", headers=headers)

    after_ids = [
        document["document_id"]
        for document in after_response.json()["documents"]
    ]

    assert document_id not in after_ids


def test_delete_same_document_twice_returns_404_second_time():

    headers = get_auth_headers()

    files = [
        (
            "files",
            (
                "delete_twice_test.txt",
                b"This file is used to test deleting the same document twice.",
                "text/plain",
            ),
        )
    ]

    upload_response = client.post(
        "/documents",
        files=files,
        data={
            "chunk_size": 800,
            "chunk_overlap": 150,
            "top_k": 4,
        },
        headers=headers,
    )

    document_id = upload_response.json()[
        "processing_info"
    ]["document_ids"][0]

    first_delete = client.delete(
        f"/documents/{document_id}",
        headers=headers,
    )

    assert first_delete.status_code == 200

    second_delete = client.delete(
        f"/documents/{document_id}",
        headers=headers,
    )

    assert second_delete.status_code == 404
    
