from langchain_core.documents import Document

from services.ingestion import (
    load_uploaded_documents
)

from services.retrieval import (
    retrieve_documents,
    format_context,
    calculate_relevance_score,
    remove_duplicate_documents,
    rerank_documents,
    filter_irrelevant_documents,
    RetrievalWrapper,
)

from rag_engine import RAGService


class FakeUploadedFile:

    def __init__(self, name, data):
        self.name = name
        self.data = data

    def getvalue(self):
        return self.data


class FakeRetriever:

    def __init__(self, documents):
        self.documents = documents

    def invoke(self, query):
        return self.documents


class FailingRetriever:

    def invoke(self, query):
        raise Exception(
            "Test retrieval failure"
        )


def test_load_txt_document_has_document_id():

    file = FakeUploadedFile(
        "handbook.txt",
        b"Employees must arrive on time."
    )

    documents = load_uploaded_documents(
        [file]
    )

    assert len(documents) == 1

    metadata = documents[0].metadata

    assert "document_id" in metadata
    assert metadata["document_id"].startswith(
        "doc_"
    )
    assert metadata["source"] == "handbook.txt"
    assert metadata["page"] == 1


def test_each_uploaded_document_gets_unique_id():

    file_1 = FakeUploadedFile(
        "handbook.txt",
        b"Leave policy information."
    )

    file_2 = FakeUploadedFile(
        "support.txt",
        b"IT support information."
    )

    documents = load_uploaded_documents(
        [file_1, file_2]
    )

    assert len(documents) == 2

    document_id_1 = (
        documents[0].metadata["document_id"]
    )

    document_id_2 = (
        documents[1].metadata["document_id"]
    )

    assert document_id_1 != document_id_2


def test_retrieval_preserves_document_id():

    document = Document(
        page_content=(
            "Employees receive annual leave."
        ),
        metadata={
            "document_id": "doc_test123",
            "source": "handbook.txt",
            "page": 1,
        }
    )

    retriever = FakeRetriever(
        [document]
    )

    results = retrieve_documents(
        retrievers={
            "doc_test123": retriever
        },
        query="annual leave"
    )

    assert len(results) == 1

    assert (
        results[0].metadata["document_id"]
        == "doc_test123"
    )


def test_retrieval_adds_missing_document_id():

    document = Document(
        page_content="IT support information.",
        metadata={
            "source": "support.txt",
            "page": 1,
        }
    )

    retriever = FakeRetriever(
        [document]
    )

    results = retrieve_documents(
        retrievers={
            "doc_support123": retriever
        },
        query="IT support"
    )

    assert len(results) == 1

    assert (
        results[0].metadata["document_id"]
        == "doc_support123"
    )


def test_format_context_contains_document_id():

    document = Document(
        page_content="Late arrival policy.",
        metadata={
            "document_id": "doc_handbook123",
            "source": "Employee Handbook.pdf",
            "page": 3,
        }
    )

    context = format_context(
        [document]
    )

    assert "doc_handbook123" in context
    assert "Employee Handbook.pdf" in context
    assert "Page: 3" in context
    assert "Late arrival policy." in context


def test_format_context_contains_multiple_documents():

    documents = [

        Document(
            page_content="Leave policy.",
            metadata={
                "document_id": "doc_1",
                "source": "handbook.pdf",
                "page": 2,
            }
        ),

        Document(
            page_content="Password reset steps.",
            metadata={
                "document_id": "doc_2",
                "source": "support.pdf",
                "page": 5,
            }
        ),
    ]

    context = format_context(
        documents
    )

    assert "doc_1" in context
    assert "doc_2" in context
    assert "handbook.pdf" in context
    assert "support.pdf" in context


# --------------------------------------------------
# PHASE 6 TESTS
# --------------------------------------------------

def test_relevance_score_is_higher_for_better_match():

    relevant_document = Document(
        page_content=(
            "Employees must follow the "
            "late arrival policy."
        )
    )

    unrelated_document = Document(
        page_content=(
            "Employees can reset their "
            "password through IT support."
        )
    )

    relevant_score = calculate_relevance_score(
        "What is the late arrival policy?",
        relevant_document
    )

    unrelated_score = calculate_relevance_score(
        "What is the late arrival policy?",
        unrelated_document
    )

    assert relevant_score > unrelated_score


def test_reranking_places_relevant_document_first():

    documents = [

        Document(
            page_content=(
                "Employees can reset their "
                "password through IT support."
            ),
            metadata={
                "document_id": "doc_support",
                "source": "support.txt",
                "page": 1,
            }
        ),

        Document(
            page_content=(
                "Employees must follow the "
                "late arrival policy."
            ),
            metadata={
                "document_id": "doc_handbook",
                "source": "handbook.txt",
                "page": 2,
            }
        ),
    ]

    results = rerank_documents(
        query="What is the late arrival policy?",
        documents=documents,
        top_k=2
    )

    assert len(results) == 2

    assert (
        results[0].metadata["document_id"]
        == "doc_handbook"
    )

    assert (
        results[0].metadata["relevance_score"]
        >= results[1].metadata[
            "relevance_score"
        ]
    )


def test_reranking_limits_results_to_top_k():

    documents = [

        Document(
            page_content=(
                f"Leave policy information "
                f"for employees {index}."
            ),
            metadata={
                "document_id": f"doc_{index}",
                "source": "handbook.txt",
                "page": index,
            }
        )

        for index in range(6)
    ]

    results = rerank_documents(
        query="leave policy employees",
        documents=documents,
        top_k=3
    )

    assert len(results) == 3


def test_duplicate_documents_are_removed():

    document_1 = Document(
        page_content=(
            "Employees receive annual leave."
        ),
        metadata={
            "document_id": "doc_1",
            "source": "handbook.txt",
            "page": 1,
        }
    )

    document_2 = Document(
        page_content=(
            "Employees receive annual leave."
        ),
        metadata={
            "document_id": "doc_1",
            "source": "handbook.txt",
            "page": 1,
        }
    )

    results = remove_duplicate_documents(
        [document_1, document_2]
    )

    assert len(results) == 1


def test_reranking_adds_relevance_score():

    document = Document(
        page_content=(
            "Employees receive annual leave."
        ),
        metadata={
            "document_id": "doc_1",
            "source": "handbook.txt",
            "page": 1,
        }
    )

    results = rerank_documents(
        query="annual leave",
        documents=[document],
        top_k=1
    )

    assert len(results) == 1

    assert (
        "relevance_score"
        in results[0].metadata
    )


def test_filter_irrelevant_documents():

    documents = [

        Document(
            page_content=(
                "Annual leave is available "
                "to all employees."
            ),
            metadata={
                "document_id": "doc_leave",
                "source": "handbook.txt",
                "page": 1,
            }
        ),

        Document(
            page_content=(
                "The office printer "
                "requires a new cartridge."
            ),
            metadata={
                "document_id": "doc_printer",
                "source": "support.txt",
                "page": 2,
            }
        ),
    ]

    reranked_results = rerank_documents(
        query="annual leave policy",
        documents=documents,
        top_k=2
    )

    results = filter_irrelevant_documents(
        reranked_results
    )

    assert len(results) == 1

    assert (
        results[0].metadata["document_id"]
        == "doc_leave"
    )


# --------------------------------------------------
# PHASE 7 TESTS
# --------------------------------------------------

def test_retrieval_returns_empty_list_when_no_documents():

    retriever = FakeRetriever(
        []
    )

    results = retrieve_documents(
        retrievers={
            "doc_empty": retriever
        },
        query="annual leave"
    )

    assert results == []


def test_retrieval_rejects_empty_query():

    retriever = FakeRetriever(
        []
    )

    try:

        retrieve_documents(
            retrievers={
                "doc_test": retriever
            },
            query="   "
        )

        assert False

    except ValueError as error:

        assert (
            str(error)
            == "Search query cannot be empty"
        )


def test_retrieval_handles_retriever_error():

    try:

        retrieve_documents(
            retrievers={
                "doc_test": FailingRetriever()
            },
            query="annual leave"
        )

        assert False

    except RuntimeError as error:

        assert (
            "Failed to retrieve documents"
            in str(error)
        )


def test_retrieval_wrapper_handles_error():

    wrapper = RetrievalWrapper(
        retriever=FailingRetriever(),
        final_k=2
    )

    try:

        wrapper.invoke(
            "annual leave"
        )

        assert False

    except RuntimeError as error:

        assert (
            "Document retrieval failed"
            in str(error)
        )


def test_retrieval_wrapper_rejects_empty_query():

    wrapper = RetrievalWrapper(
        retriever=FakeRetriever([]),
        final_k=2
    )

    try:

        wrapper.invoke("   ")

        assert False

    except ValueError as error:

        assert (
            str(error)
            == "Search query cannot be empty"
        )
        

def create_test_rag_service():

    service = object.__new__(RAGService)

    service.retrievers = {
        "doc_1": "fake_retriever_1",
        "doc_2": "fake_retriever_2",
        "doc_3": "fake_retriever_3",
    }

    service.document_map = {
        "doc_1": "handbook.pdf",
        "doc_2": "support.pdf",
        "doc_3": "policy.pdf",
    }

    return service


# --------------------------------------------------
# PHASE 2 - DOCUMENT SELECTION TESTS
# --------------------------------------------------

def test_filter_documents_returns_all_when_none_given():

    service = create_test_rag_service()

    retrievers, document_map = service._filter_documents(
        None
    )

    assert retrievers == service.retrievers
    assert document_map == service.document_map


def test_filter_documents_returns_all_when_empty_list_given():

    service = create_test_rag_service()

    retrievers, document_map = service._filter_documents(
        []
    )

    assert retrievers == service.retrievers
    assert document_map == service.document_map


def test_filter_documents_filters_to_selected_ids():

    service = create_test_rag_service()

    retrievers, document_map = service._filter_documents(
        ["doc_1", "doc_3"]
    )

    assert set(retrievers.keys()) == {"doc_1", "doc_3"}
    assert set(document_map.keys()) == {"doc_1", "doc_3"}

    assert document_map["doc_1"] == "handbook.pdf"
    assert document_map["doc_3"] == "policy.pdf"


def test_filter_documents_ignores_invalid_ids():

    service = create_test_rag_service()

    retrievers, document_map = service._filter_documents(
        ["doc_1", "doc_does_not_exist"]
    )

    assert set(retrievers.keys()) == {"doc_1"}
    assert set(document_map.keys()) == {"doc_1"}


def test_filter_documents_falls_back_to_all_when_all_ids_invalid():

    service = create_test_rag_service()

    retrievers, document_map = service._filter_documents(
        ["doc_fake_a", "doc_fake_b"]
    )

    assert retrievers == service.retrievers
    assert document_map == service.document_map
